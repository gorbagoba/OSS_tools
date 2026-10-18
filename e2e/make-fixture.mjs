/**
 * Generates e2e/fixtures/gradient.png — a 32x32 opaque RGB horizontal
 * gradient (red → blue). No dependencies: node:zlib deflate for the IDAT
 * chunk, manual CRC32, hand-assembled PNG structure.
 *
 * Usage: node e2e/make-fixture.mjs
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const W = 32;
const H = 32;

// ---------------------------------------------------------------------------
// CRC32 (IEEE 802.3, reflected, poly 0xEDB88320)
// ---------------------------------------------------------------------------
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// ---------------------------------------------------------------------------
// Pixel data: horizontal gradient, red (x=0) → blue (x=31), fully opaque
// ---------------------------------------------------------------------------
const stride = 1 + W * 3; // per-row filter byte + RGB
const raw = Buffer.alloc(H * stride);
for (let y = 0; y < H; y += 1) {
  const rowStart = y * stride;
  raw[rowStart] = 0; // scanline filter: None
  for (let x = 0; x < W; x += 1) {
    const t = x / (W - 1);
    const off = rowStart + 1 + x * 3;
    raw[off] = Math.round(255 * (1 - t)); // R: 255 → 0
    raw[off + 1] = 0; // G: 0
    raw[off + 2] = Math.round(255 * t); // B: 0 → 255
  }
}

// ---------------------------------------------------------------------------
// Assemble PNG: signature + IHDR + IDAT (deflate) + IEND
// ---------------------------------------------------------------------------
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type: truecolor RGB
ihdr[10] = 0; // compression method
ihdr[11] = 0; // filter method
ihdr[12] = 0; // interlace: none

const idat = deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  signature,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

// ---------------------------------------------------------------------------
// Self-check: re-parse the file, verify CRCs, inflate, verify pixels
// ---------------------------------------------------------------------------
function verify(buf) {
  if (!buf.subarray(0, 8).equals(signature)) throw new Error('bad PNG signature');
  let off = 8;
  let idatData = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('ascii');
    const data = buf.subarray(off + 8, off + 8 + len);
    const storedCrc = buf.readUInt32BE(off + 8 + len);
    const actualCrc = crc32(Buffer.concat([buf.subarray(off + 4, off + 8), data]));
    if (storedCrc !== actualCrc) throw new Error(`CRC mismatch in ${type}`);
    if (type === 'IHDR') {
      if (data.readUInt32BE(0) !== W || data.readUInt32BE(4) !== H) {
        throw new Error('IHDR dimensions wrong');
      }
      if (data[8] !== 8 || data[9] !== 2) throw new Error('IHDR format wrong');
    }
    if (type === 'IDAT') idatData = data;
    off += 12 + len;
  }
  if (!idatData) throw new Error('missing IDAT');
  const inflated = inflateSync(idatData);
  if (inflated.length !== raw.length) throw new Error('IDAT payload length wrong');
  if (!inflated.equals(raw)) throw new Error('IDAT payload content mismatch');
  // spot check: first px red, last px of row blue, alpha-less RGB opaque row
  if (inflated[1] !== 255 || inflated[2] !== 0 || inflated[3] !== 0) throw new Error('px(0,0) not red');
  const lastOff = 1 + (W - 1) * 3;
  if (inflated[lastOff] !== 0 || inflated[lastOff + 2] !== 255) throw new Error('px(31,0) not blue');
}
verify(png);

const outDir = join(here, 'fixtures');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'gradient.png');
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes) — verified`);
