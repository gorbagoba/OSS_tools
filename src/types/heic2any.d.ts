/**
 * Minimal ambient types for `heic2any` (package ships no .d.ts).
 * API: heic2any({ blob, toType?, quality? }) → Blob or Blob[] (multi-page HEIC).
 */
declare module 'heic2any' {
  export interface Heic2AnyOptions {
    blob: Blob;
    toType?: string;
    quality?: number;
    gifAnimationInterval?: number;
  }
  export default function heic2any(options: Heic2AnyOptions): Promise<Blob | Blob[]>;
}
