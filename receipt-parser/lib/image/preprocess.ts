import sharp from "sharp";

const TARGET_LONG_EDGE = 1800;

export async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.5, m1: 1.5, m2: 3.0 })
    .resize(TARGET_LONG_EDGE, TARGET_LONG_EDGE, {
      fit: "inside",
      withoutEnlargement: false, // upscale small receipts too
      kernel: "lanczos3",
    })
    .png({ compressionLevel: 6 })
    .toBuffer();
}
