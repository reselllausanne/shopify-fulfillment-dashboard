import { Prisma } from "@prisma/client";
import { prisma, prismaDirect } from "@/app/lib/prisma";
import { pickGalaxusProductImageList } from "@/galaxus/exports/productImages";

/** Synthetic flag set by feed loaders — presence without shipping `images` JSONB. */
export type WithImageSignal = {
  hasImageSignal?: boolean;
  images?: unknown;
  sourceImageUrl?: string | null;
  hostedImageUrl?: string | null;
  imageSyncStatus?: string | null;
};

function isAbsoluteHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const t = value.trim();
  if (!t) return false;
  try {
    const parsed = new URL(t);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Cheap URL-only presence (no JSONB). Same absolute http(s) rule as pickGalaxusProductImageList. */
export function hasAbsoluteImageUrl(variant: WithImageSignal | null | undefined): boolean {
  if (!variant) return false;
  return isAbsoluteHttpUrl(variant.hostedImageUrl) || isAbsoluteHttpUrl(variant.sourceImageUrl);
}

/**
 * True iff pickGalaxusProductImageList would return ≥1 URL.
 * Prefer precomputed `hasImageSignal` (slim stock/offer path) when set.
 */
export function hasGalaxusPrimaryImage(variant: WithImageSignal | null | undefined): boolean {
  if (!variant) return false;
  if (typeof variant.hasImageSignal === "boolean") return variant.hasImageSignal;
  return pickGalaxusProductImageList(variant).length > 0;
}

/**
 * Exact presence rule for rows missing absolute source/hosted URLs:
 * load images (+ urls/status) server-side, evaluate pickGalaxusProductImageList,
 * return boolean only — never leave JSONB on the variant object.
 */
export async function loadPickGalaxusImagePresenceBySupplierVariantId(
  supplierVariantIds: string[]
): Promise<Map<string, boolean>> {
  const ids = Array.from(
    new Set(supplierVariantIds.map((id) => String(id ?? "").trim()).filter(Boolean))
  );
  const out = new Map<string, boolean>();
  if (ids.length === 0) return out;

  const client = (prismaDirect ?? prisma) as { $queryRaw: typeof prisma.$queryRaw };
  const chunkSize = 5000;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const rows = await client.$queryRaw<
      Array<{
        supplierVariantId: string;
        images: unknown;
        sourceImageUrl: string | null;
        hostedImageUrl: string | null;
        imageSyncStatus: string | null;
      }>
    >(
      Prisma.sql`
        SELECT
          sv."supplierVariantId",
          sv."images",
          sv."sourceImageUrl",
          sv."hostedImageUrl",
          sv."imageSyncStatus"
        FROM "public"."SupplierVariant" sv
        WHERE sv."supplierVariantId" IN (${Prisma.join(chunk)})
      `
    );
    for (const row of rows) {
      const has = pickGalaxusProductImageList({
        images: row.images,
        sourceImageUrl: row.sourceImageUrl,
        hostedImageUrl: row.hostedImageUrl,
        imageSyncStatus: row.imageSyncStatus,
      }).length > 0;
      out.set(String(row.supplierVariantId), has);
    }
  }
  return out;
}

/** @deprecated Use loadPickGalaxusImagePresenceBySupplierVariantId */
export const loadImagesJsonbPresenceBySupplierVariantId =
  loadPickGalaxusImagePresenceBySupplierVariantId;

/**
 * Attach `hasImageSignal` on each mapping.supplierVariant.
 * URL absolute http(s) short-circuits (no images TOAST).
 * Else presence = pickGalaxusProductImageList would find ≥1 URL (boolean only on wire after eval).
 */
export async function attachHasImageSignalToMappings(mappings: any[]): Promise<void> {
  const needsPickCheck: string[] = [];
  for (const mapping of mappings) {
    const variant = mapping?.supplierVariant;
    if (!variant) continue;
    if (hasAbsoluteImageUrl(variant)) {
      variant.hasImageSignal = true;
      continue;
    }
    // If images already on the object (tests / compare), evaluate in-process — no extra round-trip.
    if (Object.prototype.hasOwnProperty.call(variant, "images")) {
      variant.hasImageSignal = pickGalaxusProductImageList(variant).length > 0;
      delete variant.images;
      continue;
    }
    const id = String(variant.supplierVariantId ?? mapping?.supplierVariantId ?? "").trim();
    if (id) needsPickCheck.push(id);
    else variant.hasImageSignal = false;
  }
  if (needsPickCheck.length === 0) return;
  const presence = await loadPickGalaxusImagePresenceBySupplierVariantId(needsPickCheck);
  for (const mapping of mappings) {
    const variant = mapping?.supplierVariant;
    if (!variant || typeof variant.hasImageSignal === "boolean") continue;
    const id = String(variant.supplierVariantId ?? mapping?.supplierVariantId ?? "").trim();
    variant.hasImageSignal = presence.get(id) === true;
  }
}

/** Prisma select for stock/offer gates — no `images` JSONB. */
export const FEED_VARIANT_SELECT_GATE_NO_IMAGES = {
  supplierVariantId: true,
  price: true,
  stock: true,
  manualPrice: true,
  manualStock: true,
  manualLock: true,
  manualNote: true,
  leadTimeDays: true,
  deliveryType: true,
  suggestedRetailPriceInclVat: true,
  supplierProductName: true,
  supplierBrand: true,
  supplierSku: true,
  hostedImageUrl: true,
  sourceImageUrl: true,
  imageSyncStatus: true,
} as const;
