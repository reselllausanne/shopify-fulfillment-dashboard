/**
 * Shared extraction helpers for raw KicksDB product payloads.
 *
 * Single parsing implementation used by BOTH the marketplace enrichment flow
 * (galaxus/kickdb/enrichJob.ts) and the SSE buffer upsert route
 * (app/api/kickdb/upsert). Keeping one implementation guarantees the digested
 * columns on KickDBProduct/KickDBVariant stay consistent no matter which flow
 * wrote them.
 */

export function pickString(...values: Array<unknown>) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function extractBrand(productRecord: any): string | null {
  const direct = pickString(productRecord?.brand, productRecord?.manufacturer, productRecord?.make);
  if (direct) return direct;
  const traits = productRecord?.traits;
  if (Array.isArray(traits)) {
    for (const t of traits) {
      const key = pickString(t?.key, t?.name, t?.trait, t?.type)?.toLowerCase();
      if (key && ["brand", "manufacturer"].includes(key)) {
        const value = pickString(t?.value, t?.label, t?.text);
        if (value) return value;
      }
    }
  }
  if (traits && typeof traits === "object") {
    return pickString(traits.brand, traits.Brand, traits.manufacturer, traits.Manufacturer);
  }
  return null;
}

export function extractImageUrl(productRecord: any): string | null {
  return pickString(
    productRecord?.image,
    productRecord?.image_url,
    productRecord?.imageUrl,
    productRecord?.media?.image,
    productRecord?.media?.imageUrl
  );
}

export function pickTraitValue(traits: unknown, keys: string[]): string | null {
  if (!traits) return null;
  const list = Array.isArray(traits) ? traits : (traits as any)?.traits ?? traits;
  const traitArray = Array.isArray(list) ? list : [];
  const lowerKeys = keys.map((key) => key.toLowerCase());
  for (const entry of traitArray) {
    const entryKey = pickString(entry?.key, entry?.name, entry?.trait, entry?.type)?.toLowerCase() ?? "";
    if (!entryKey) continue;
    if (lowerKeys.some((key) => entryKey.includes(key))) {
      return pickString(entry?.value, entry?.label, entry?.text, entry?.displayValue);
    }
  }
  return null;
}

export function parseDateValue(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function collectVariantSizes(variant: any): Array<{ type: string; size: string }> {
  const sizes: Array<{ type: string; size: string }> = [];
  if (variant?.size_eu) sizes.push({ type: "eu", size: String(variant.size_eu) });
  if (variant?.size_us) sizes.push({ type: "us", size: String(variant.size_us) });
  if (variant?.size) sizes.push({ type: "raw", size: String(variant.size) });
  if (Array.isArray(variant?.sizes)) {
    for (const entry of variant.sizes) {
      if (entry?.size) {
        sizes.push({ type: String(entry?.type ?? "raw").toLowerCase(), size: String(entry.size) });
      }
    }
  }
  return sizes;
}

/** Fill `KickDBVariant.sizeEu` / `sizeUs` from API, including `sizes[]` when top-level fields are empty. */
export function pickPersistedKickdbSizes(matchedVariant: any): { sizeEu: string | null; sizeUs: string | null } {
  let sizeEu = pickString(matchedVariant?.size_eu);
  let sizeUs = pickString(matchedVariant?.size_us);
  if ((!sizeEu || !sizeUs) && matchedVariant && typeof matchedVariant === "object") {
    for (const { type, size } of collectVariantSizes(matchedVariant)) {
      const t = type.toLowerCase();
      if (!sizeEu && t === "eu") sizeEu = pickString(size);
      if (!sizeUs && (t === "us m" || t === "us w" || t === "us" || t === "usm" || t === "usw")) {
        sizeUs = pickString(size);
      }
    }
  }
  const st = String(matchedVariant?.size_type ?? "").toLowerCase();
  const rawSize = pickString(matchedVariant?.size);
  if (rawSize) {
    if (!sizeEu && st.includes("eu")) sizeEu = rawSize;
    if (!sizeUs && st.includes("us")) sizeUs = rawSize;
  }
  return { sizeEu, sizeUs };
}

/**
 * Digest the product-level columns persisted on KickDBProduct from a raw
 * KicksDB product record. Values are null when absent — callers must apply
 * COALESCE semantics (never overwrite an existing non-null column with null).
 */
export function digestProductFields(productRecord: any) {
  const traits = productRecord?.traits ?? null;
  const retailPriceRaw = pickTraitValue(traits, ["retail price", "rrp", "msrp"]);
  const retailPrice = retailPriceRaw ? Number(retailPriceRaw) : null;
  return {
    urlKey: pickString(productRecord?.slug, productRecord?.url_key, productRecord?.urlKey),
    styleId: pickString(productRecord?.sku, productRecord?.style_id, productRecord?.styleId),
    name: pickString(productRecord?.title, productRecord?.name),
    brand: extractBrand(productRecord),
    imageUrl: extractImageUrl(productRecord),
    traitsJson: traits,
    description: pickString(
      productRecord?.description,
      productRecord?.short_description,
      productRecord?.product_description
    ),
    gender:
      pickString(productRecord?.gender, productRecord?.sex) ?? pickTraitValue(traits, ["gender"]),
    colorway: pickTraitValue(traits, ["colorway", "colourway", "color"]),
    countryOfManufacture:
      pickString(productRecord?.country_of_manufacture, productRecord?.countryOfManufacture) ??
      pickTraitValue(traits, ["country of manufacture", "country"]),
    releaseDate: parseDateValue(pickTraitValue(traits, ["release date"])),
    retailPrice: Number.isFinite(retailPrice ?? NaN) ? retailPrice : null,
  };
}
