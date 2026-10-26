/**
 * Post-conversion image compaction for embedded markdown data URIs.
 * Decodes each embedded raster, downscales to a bounded long edge, and
 * re-encodes as WebP (quality 0.8, JPEG fallback) when the result is
 * actually smaller than the source. Runs inside the conversion worker via
 * OffscreenCanvas — no DOM and no extra dependencies.
 * @category worker
 */

import type { DoclingImageStats } from '../types/docling';

/** Cap for the long image edge after downscaling. */
const MAX_IMG_DIM = 1600;

/** WebP encode quality (visually lossless-ish, large savings on PNG crops). */
const WEBP_QUALITY = 0.8;

/** JPEG fallback quality used when WebP encoding is unavailable. */
const JPEG_QUALITY = 0.85;

/**
 * Matches every embedded raster data URI in the markdown output (markdown
 * image targets, HTML img src, references). Base64 payloads contain only
 * [A-Za-z0-9+/=], so the payload match stops at the first whitespace or
 * closing paren.
 */
const DATA_URI_RE = /data:image\/(?:png|jpeg|jpg);base64,[A-Za-z0-9+/=]+/g;

interface DecodedUri {
  mime: string;
  bytes: Uint8Array;
}

function dataUriToBytes(uri: string): DecodedUri {
  const match = /^data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/=]+)$/.exec(uri);
  if (!match) throw new Error('Unrecognized data URI');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { mime: match[1], bytes };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Re-encode one embedded image. Returns the replacement data URI plus the
 * before/after string lengths, or null when re-encoding would grow the
 * payload (tiny/simple images) or decoding fails.
 */
async function compactDataImage(uri: string): Promise<{ uri: string; before: number; after: number } | null> {
  let decoded: DecodedUri;
  let bitmap: ImageBitmap;
  try {
    decoded = dataUriToBytes(uri);
    const blobPart = decoded.bytes.buffer.slice(
      decoded.bytes.byteOffset,
      decoded.bytes.byteOffset + decoded.bytes.byteLength,
    ) as ArrayBuffer;
    bitmap = await createImageBitmap(new Blob([blobPart], { type: decoded.mime }));
  } catch {
    return null;
  }
  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, MAX_IMG_DIM / longEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);

    // Chrome/Firefox encode WebP on canvas; Safari may silently fall back to
    // PNG — the blob type is checked and JPEG is used as the universal fallback.
    let blob = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
    if (blob.type !== 'image/webp') {
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const next = `data:${blob.type};base64,${bytesToBase64(bytes)}`;
    if (next.length >= uri.length) return null;
    return { uri: next, before: uri.length, after: next.length };
  } finally {
    bitmap.close();
  }
}

/**
 * Replace every embedded raster data URI in the markdown with a compacted
 * version. Returns the rewritten markdown and aggregate stats; `images` is
 * null when no image was re-encoded (either none present or none shrank).
 */
export async function compactEmbeddedImages(
  markdown: string,
): Promise<{ markdown: string; images: DoclingImageStats | null }> {
  const matches = markdown.match(DATA_URI_RE);
  if (!matches || matches.length === 0) return { markdown, images: null };

  let output = markdown;
  let count = 0;
  let before = 0;
  let after = 0;
  let format = '';
  // Cache identical payloads (repeat crops) to decode/encode only once.
  const cache = new Map<string, string>();
  // Serial promise chain (airbnb forbids for-of): each image is decoded,
  // re-encoded, and substituted before the next one starts, keeping peak
  // memory bounded to one bitmap.
  await matches.reduce(async (chain, uri) => {
    await chain;
    let replacement: string | null = null;
    const cached = cache.get(uri);
    if (cached !== undefined) {
      replacement = cached;
    } else {
      const result = await compactDataImage(uri);
      replacement = result?.uri ?? null;
      cache.set(uri, replacement ?? '');
    }
    if (!replacement) return undefined;
    output = output.replace(uri, replacement);
    count += 1;
    before += uri.length;
    after += replacement.length;
    format = replacement.slice(5, replacement.indexOf(';'));
    return undefined;
  }, Promise.resolve<void>(undefined));
  if (count === 0) return { markdown, images: null };
  return {
    markdown: output,
    images: {
      count, before, after, format,
    },
  };
}
