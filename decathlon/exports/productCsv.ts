import type { DecathlonExclusionSummary, DecathlonExportCandidate, DecathlonExportFilePayload } from "./types";
import { recordDecathlonExclusion } from "./mapping";
import { PRODUCTS_HEADERS } from "./templates";
import { isBasketballTitle } from "./basketballTitles";
import { normalizeDecathlonImageUrl } from "./imageUrl";

const DEFAULT_CONDITION_CODE = "6336";
const DEFAULT_PRODUCT_NATURE_SHOES_CODE = "25126";
const DEFAULT_SPORTS_VALUE = "sport walking";
const DEFAULT_CATEGORY_CODE = "134500";

const COLOR_CODE_BY_TOKEN: Array<{ token: string; code: string }> = [
  { token: "black", code: "1" },
  { token: "grey", code: "2" },
  { token: "gray", code: "2" },
  { token: "white", code: "4" },
  { token: "blue", code: "5" },
  { token: "green", code: "9" },
  { token: "red", code: "14" },
  { token: "purple", code: "16" },
  { token: "pink", code: "24" },
  { token: "brown", code: "27" },
  { token: "khaki", code: "29" },
  { token: "beige", code: "30" },
  { token: "tan", code: "30" },
  { token: "orange", code: "20" },
  { token: "yellow", code: "22" },
];

/** Columns we always fill for Decathlon operator product CSV; PM11 pre-check only gates these. */
export const BASE_REQUIRED_COLUMNS = [
  "Catégorie",
  "Product Identifier",
  "Product Title en-GB/IE",
  "Product Title it-IT",
  "Product Title fr-CH",
  "Product Title de-CH",
  "Webcatchline en-GB/IE",
  "Description en-GB/IE",
  "Webcatchline it-IT",
  "Description it-IT",
  "Webcatchline fr-CH",
  "Description fr-CH",
  "Webcatchline de-CH",
  "Description de-CH",
  "Main Image",
  "codes EAN",
  "Brand",
  "état",
  "Sports",
  "Genre",
  "Couleur",
  "Sizes for Footwear",
  "Product Natures - Shoes",
];

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

function pickTrait(traits: any, keys: string[]): string | null {
  if (!traits) return null;
  const list = Array.isArray(traits) ? traits : traits.traits ?? traits;
  const traitArray = Array.isArray(list) ? list : [];
  const lowerKeys = keys.map((key) => key.toLowerCase());
  for (const entry of traitArray) {
    const entryKey = String(
      entry?.name ?? entry?.trait ?? entry?.key ?? entry?.attribute ?? ""
    ).toLowerCase();
    if (!entryKey) continue;
    if (lowerKeys.some((key) => entryKey.includes(key))) {
      const value = entry?.value ?? entry?.values ?? entry?.displayValue ?? entry?.text;
      if (Array.isArray(value)) return String(value[0] ?? "");
      if (value !== null && value !== undefined) return String(value);
    }
  }
  return null;
}

function resolveSportFromTitle(title: string): string {
  if (isBasketballTitle(title)) return "basketball";
  return DEFAULT_SPORTS_VALUE;
}

function sanitizeDescription(text: string): string {
  if (!text) return text;
  // Mirakl rejects this keyword (error 2031) on Description en-GB/IE.
  return text
    .replace(/\bsustainability\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function resolveMainColorCode(rawColor: string): string {
  const normalized = String(rawColor ?? "").toLowerCase();
  if (!normalized) return "";
  for (const candidate of COLOR_CODE_BY_TOKEN) {
    if (normalized.includes(candidate.token)) return candidate.code;
  }
  return "";
}

function resolveRequiredMissing(row: Record<string, string>) {
  return BASE_REQUIRED_COLUMNS.filter((column) => !row[column]);
}

export function buildProductRow(
  candidate: DecathlonExportCandidate,
  summary: DecathlonExclusionSummary
): Record<string, string> | null {
  const variant = candidate.variant ?? {};
  const product = candidate.product ?? {};
  const traits = product?.traitsJson ?? null;
  const genderFromSupplier = String(variant?.supplierGender ?? "").trim();
  const colorwayFromSupplier = String(variant?.supplierColorway ?? "").trim();
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
    return null;
  }

  const row = createRow();
  const brand = String(variant?.supplierBrand ?? product?.brand ?? "").trim();
  const description = String(product?.description ?? "").trim();
  const gender = String(product?.gender ?? "").trim() || genderFromSupplier;
  const colorway = String(product?.colorway ?? "").trim() || colorwayFromSupplier;
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
  const uniqueImages = Array.from(new Set(imageUrls)).map(normalizeDecathlonImageUrl);

  row["Product Identifier"] = candidate.providerKey;
  row["Main Title"] = productName;
  row["Catégorie"] = DEFAULT_CATEGORY_CODE;
  row["Product Title en-GB/IE"] = productName;
  row["Product Title it-IT"] = productName;
  row["Product Title fr-CH"] = productName;
  row["Product Title de-CH"] = productName;
  const baseDescription = sanitizeDescription(description || productName);
  row["Webcatchline en-GB/IE"] = productName;
  row["Description en-GB/IE"] = baseDescription;
  row["Webcatchline it-IT"] = productName;
  row["Description it-IT"] = baseDescription;
  row["Webcatchline fr-CH"] = productName;
  row["Description fr-CH"] = baseDescription;
  row["Webcatchline de-CH"] = productName;
  row["Description de-CH"] = baseDescription;
  row["Main Image"] = uniqueImages[0] ?? "";
  row["Image 2"] = uniqueImages[1] ?? "";
  row["Image 3"] = uniqueImages[2] ?? "";
  row["Image 4"] = uniqueImages[3] ?? "";
  row["Image 5"] = uniqueImages[4] ?? "";
  row["Image 6"] = uniqueImages[5] ?? "";
  row["Image 7"] = uniqueImages[6] ?? "";
  row["codes EAN"] = candidate.gtin;
  row["Brand"] = brand;
  row["état"] = DEFAULT_CONDITION_CODE;
  row["Sports"] = resolveSportFromTitle(productName);
  row["Genre"] = gender || pickTrait(traits, ["gender", "sex", "target"]) || "";
  row["Couleur"] = resolveMainColorCode(
    colorway || pickTrait(traits, ["color", "colour", "colorway"]) || ""
  );
  row["poids (en g)"] = weightGrams;
  row["Sizes for Footwear"] = String(variant?.sizeRaw ?? candidate?.kickdbVariant?.sizeEu ?? "").trim();
  row["Product Natures - Shoes"] = DEFAULT_PRODUCT_NATURE_SHOES_CODE;

  const missingRequired = resolveRequiredMissing(row);
  if (missingRequired.length > 0) {
    recordDecathlonExclusion(summary, {
      reason: "MISSING_PRODUCT_FIELDS",
      message: `Missing required columns: ${missingRequired.join(", ")}`,
      fileType: "products",
      providerKey: candidate.providerKey,
      supplierVariantId: variant?.supplierVariantId ?? null,
      gtin: candidate.gtin,
    });
    return null;
  }

  return row;
}

export function buildProductCsv(
  candidates: DecathlonExportCandidate[],
  summary: DecathlonExclusionSummary
): DecathlonExportFilePayload {
  const rows = [];

  for (const candidate of candidates) {
    const row = buildProductRow(candidate, summary);
    if (!row) continue;
    rows.push(row);
  }

  return { type: "products", headers: PRODUCTS_HEADERS, rows };
}
