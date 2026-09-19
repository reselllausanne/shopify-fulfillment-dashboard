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

/** Cheap URL-only presence (no JSONB). */
export function hasAbsoluteImageUrl(variant: WithImageSignal | null | undefined): boolean {
  if (!variant) return false;
  return isAbsoluteHttpUrl(variant.hostedImageUrl) || isAbsoluteHttpUrl(variant.sourceImageUrl);
}

/**
 * Catalog / GTIN-winner image gate.
 * Prefer `hasImageSignal` when loaders set it (stock/offer slim path).
 * Else fall back to full `pickGalaxusProductImageList` (master path with JSONB).
 */
export function hasGalaxusPrimaryImage(variant: WithImageSignal | null | undefined): boolean {
  if (!variant) return false;
  if (typeof variant.hasImageSignal === "boolean") return variant.hasImageSignal;
  return pickGalaxusProductImageList(variant).length > 0;
}

/**
 * For ids that lack source/hosted absolute URLs, check whether `images` JSONB
 * is non-empty on the server — returns boolean only (no JSONB over the wire).
 */
export async function loadImagesJsonbPresenceBySupplierVariantId(
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
    const rows = await client.$queryRaw<Array<{ supplierVariantId: string; hasImages: boolean }>>(
      Prisma.sql`
        SELECT
          sv."supplierVariantId",
          (
            sv."images" IS NOT NULL
            AND sv."images"::text NOT IN ('null', '[]', '{}')
          ) AS "hasImages"
        FROM "public"."SupplierVariant" sv
        WHERE sv."supplierVariantId" IN (${Prisma.join(chunk)})
      `
    );
    for (const row of rows) {
      out.set(String(row.supplierVariantId), Boolean(row.hasImages));
    }
  }
  return out;
}

/**
 * Attach `hasImageSignal` on each mapping.supplierVariant.
 * URL hits short-circuit (no images TOAST). JSONB-only rows get a boolean-only lookup.
 */
export async function attachHasImageSignalToMappings(mappings: any[]): Promise<void> {
  const needsJsonbCheck: string[] = [];
  for (const mapping of mappings) {
    const variant = mapping?.supplierVariant;
    if (!variant) continue;
    if (hasAbsoluteImageUrl(variant)) {
      variant.hasImageSignal = true;
      continue;
    }
    const id = String(variant.supplierVariantId ?? mapping?.supplierVariantId ?? "").trim();
    if (id) needsJsonbCheck.push(id);
    else variant.hasImageSignal = false;
  }
  if (needsJsonbCheck.length === 0) return;
  const presence = await loadImagesJsonbPresenceBySupplierVariantId(needsJsonbCheck);
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
