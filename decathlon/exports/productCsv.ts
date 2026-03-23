import type { DecathlonExclusionSummary, DecathlonExportCandidate, DecathlonExportFilePayload } from "./types";
import { recordDecathlonExclusion } from "./mapping";
import { PRODUCTS_HEADERS } from "./templates";

function createRow(): Record<string, string> {
  const row: Record<string, string> = {};
  for (const header of PRODUCTS_HEADERS) {
    row[header] = "";
  }
  return row;
}

function extractImageUrls(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((value) => typeof value === "string" && value.trim().length > 0) as string[];
  }
  return [];
}

export function buildProductCsv(
  candidates: DecathlonExportCandidate[],
  summary: DecathlonExclusionSummary
): DecathlonExportFilePayload {
  const rows = [];

  for (const candidate of candidates) {
    const variant = candidate.variant ?? {};
    const product = candidate.product ?? {};
    const productName = String(variant?.supplierProductName ?? product?.name ?? "").trim();
    if (!productName) {
      recordDecathlonExclusion(summary, {
        reason: "MISSING_PRODUCT_FIELDS",
        message: "Missing product name",
        fileType: "products",
        providerKey: candidate.providerKey,
        supplierVariantId: variant?.supplierVariantId ?? null,
        gtin: candidate.gtin,
      });
      continue;
    }

    const row = createRow();
    const brand = String(variant?.supplierBrand ?? product?.brand ?? "").trim();
    const description = String(product?.description ?? "").trim();
    const gender = String(product?.gender ?? "").trim();
    const colorway = String(product?.colorway ?? "").trim();
    const weightGrams =
      typeof variant?.weightGrams === "number" && Number.isFinite(variant.weightGrams)
        ? String(variant.weightGrams)
        : "";

    const imageUrls = [
      String(variant?.hostedImageUrl ?? "").trim(),
      String(variant?.sourceImageUrl ?? "").trim(),
      ...extractImageUrls(variant?.images),
      ...extractImageUrls(product?.images),
      String(product?.imageUrl ?? "").trim(),
    ].filter((value) => value.length > 0);
    const uniqueImages = Array.from(new Set(imageUrls));

    row["Product Identifier"] = candidate.providerKey;
    row["Main Title"] = productName;
    row["Product Title fr-CH"] = productName;
    row["Main Image"] = uniqueImages[0] ?? "";
    row["Image 2"] = uniqueImages[1] ?? "";
    row["Image 3"] = uniqueImages[2] ?? "";
    row["Image 4"] = uniqueImages[3] ?? "";
    row["Image 5"] = uniqueImages[4] ?? "";
    row["Image 6"] = uniqueImages[5] ?? "";
    row["Image 7"] = uniqueImages[6] ?? "";
    row["codes EAN"] = candidate.gtin;
    row["Brand"] = brand;
    row["Description fr-CH"] = description;
    row["Genre"] = gender;
    row["Couleur"] = colorway;
    row["poids (en g)"] = weightGrams;

    rows.push(row);
  }

  return { type: "products", headers: PRODUCTS_HEADERS, rows };
}
