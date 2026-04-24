import sharp from "sharp";

const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 90;

export async function preprocessImage(buffer: Buffer): Promise<Buffer> {
  const image = sharp(buffer).toColorspace("srgb");

  const metadata = await image.metadata();
  const { width = 0, height = 0 } = metadata;

  const longest = Math.max(width, height);
  const needsResize = longest > MAX_DIMENSION;

  const pipeline = needsResize
    ? image.resize(
        width >= height ? MAX_DIMENSION : null,
        height > width ? MAX_DIMENSION : null,
        { fit: "inside", withoutEnlargement: true }
      )
    : image;

  return pipeline
    .sharpen({ sigma: 0.8, m1: 0.5, m2: 0.5 })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}
