import { pipeline, RawImage } from '@huggingface/transformers';

type SegmentationPipeline = (input: RawImage | Blob | string) => Promise<{ mask: RawImage }[]>;

let segmenter: SegmentationPipeline | null = null;

// Model paths - ModNet for browser compatibility
const MODEL = 'Xenova/modnet';

// Load & cache the model once. Call warmup() to pre-load the model.
export async function warmup(): Promise<SegmentationPipeline> {
  try {
    if (!segmenter) {
      segmenter = (await pipeline('image-segmentation', MODEL, { dtype: 'fp16' })) as unknown as SegmentationPipeline;
    }
    return segmenter;
  } catch (error) {
    throw new Error(`Failed to load ModNet model: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Remove background from a Blob, return transparent PNG Blob
export async function removeBackground(imageBlob: Blob): Promise<Blob> {
  const seg = await warmup();

  // Load the original image
  const image = await RawImage.fromBlob(imageBlob);

  // Run the model - image-segmentation returns [{ mask: RawImage }]
  const result = await seg(image);
  const output = Array.isArray(result) ? result[0] : (result as unknown as { mask: RawImage });

  if (!output || !output.mask) {
    throw new Error('Model did not return a valid mask');
  }

  // Resize mask to match original image dimensions
  const mask = await output.mask.resize(image.width, image.height);

  // Apply mask as alpha channel to create cutout
  const cutout = image.clone();
  cutout.putAlpha(mask);

  // Convert to transparent PNG blob
  const blob = await cutout.toBlob('image/png');
  if (!blob) {
    throw new Error('Failed to convert result to PNG blob');
  }
  return blob;
}
