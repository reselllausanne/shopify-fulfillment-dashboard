/**
 * Force a real WebP payload before Shopify staged upload.
 * Filename `.webp` is not enough — StockX/imgix URLs often return JPEG bytes.
 */

import sharp from "sharp";

import { GOOGLE_IMAGE_MIN_PX, type ProductMediaImage } from "@/scripts/lib/shopifyImageHeroRepair";

export const HERO_WEBP_QUALITY = 80;
export const HERO_WEBP_MAX_BYTES = 8_000_000;

export type EncodedHeroWebp = {
  buffer: Buffer;
  width: number;
  height: number;
  sourceFormat: string;
  bytes: number;
};

export function buildImageAlt(title: string, brand?: string | null): string {
  const clean = title.trim();
  const vendor = (brand || "resell").trim() || "resell";
  const hay = `${clean} ${vendor}`.toLowerCase();
  let category = "product";
  if (/hoodie|t-shirt|tshirt|shirt|jacket|jersey|pants|shorts|apparel/.test(hay)) category = "apparel";
  if (/sneaker|shoe|jordan|dunk|yeezy|samba|gazelle|air max|new balance/.test(hay)) category = "sneakers";
  return `${clean} - authentic ${vendor} ${category}`.slice(0, 125);
}

export function smallMediaIdsToDelete(
  media: ProductMediaImage[],
  keepMediaId: string,
  minimumPx = GOOGLE_IMAGE_MIN_PX
): string[] {
  return media
    .filter((item) => {
      if (!item.id || item.id === keepMediaId) return false;
      const width = Number(item.image?.width ?? 0);
      const height = Number(item.image?.height ?? 0);
      if (!item.image?.url) return false;
      return width < minimumPx || height < minimumPx;
    })
    .map((item) => item.id);
}

export async function encodeHeroWebp(
  input: Buffer,
  minimumPx = GOOGLE_IMAGE_MIN_PX
): Promise<EncodedHeroWebp> {
  const source = await sharp(input, { failOn: "none" }).metadata();
  const sourceFormat = source.format ?? "unknown";
  const buffer = await sharp(input, { failOn: "none" }).webp({ quality: HERO_WEBP_QUALITY }).toBuffer();
  const out = await sharp(buffer, { failOn: "none" }).metadata();
  if (out.format !== "webp") {
    throw new Error(`encode_not_webp:${out.format ?? "unknown"}`);
  }
  const width = out.width ?? 0;
  const height = out.height ?? 0;
  if (width < minimumPx || height < minimumPx) {
    throw new Error(`webp_below_${minimumPx}:${width}x${height}`);
  }
  if (buffer.byteLength > HERO_WEBP_MAX_BYTES) {
    throw new Error(`webp_too_large:${buffer.byteLength}`);
  }
  return { buffer, width, height, sourceFormat, bytes: buffer.byteLength };
}
