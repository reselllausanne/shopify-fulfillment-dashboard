import { PRODUCTS_HEADERS, OFFERS_HEADERS } from "./templates";
import { BASE_REQUIRED_COLUMNS } from "./productCsv";
import { resolveDecathlonCategory } from "./categories";
import { isBasketballTitle } from "./basketballTitles";
import { recordDecathlonExclusion } from "./mapping";
import type { DecathlonExclusionSummary, DecathlonExportFilePayload } from "./types";
import type { AlternativeProductRecord } from "@/galaxus/exports/alternative";

const DEFAULT_CONDITION = "11";
const DEFAULT_PRODUCT_NATURE_SHOES = "Shoes";
const DEFAULT_SPORTS_VALUE = "sport walking";

function createRow(headers: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (const header of headers) {
    row[header] = "";
  }
  return row;
}

function resolveSportFromTitle(title: string): string {
  if (isBasketballTitle(title)) return "basketball";
  return DEFAULT_SPORTS_VALUE;
}

function extractImageUrls(product: AlternativeProductRecord): string[] {
  const images = [product.mainImageUrl, ...product.extraImageUrls].filter(Boolean);
  const unique = Array.from(new Set(images));
  return unique.slice(0, 7);
}

function resolveRequiredMissing(row: Record<string, string>) {
  return BASE_REQUIRED_COLUMNS.filter((column) => !row[column]);
}

export function buildDecathlonAlternativeProductRow(
  product: AlternativeProductRecord,
  summary: DecathlonExclusionSummary
): Record<string, string> | null {
  const productName = String(product.title ?? "").trim();
  if (!productName) {
    recordDecathlonExclusion(summary, {
      reason: "MISSING_PRODUCT_FIELDS",
      message: "Missing product name",
      fileType: "products",
      providerKey: product.providerKey,
      gtin: product.gtin,
    });
    return null;
  }

  const row = createRow(PRODUCTS_HEADERS);
  const images = extractImageUrls(product);
  const description = String(product.description ?? "").trim() || productName;
  const category = String(product.category ?? "").trim();

  row["Product Identifier"] = product.providerKey;
  row["Main Title"] = productName;
  row["Catégorie"] =
    category ||
    resolveDecathlonCategory({
      name: productName,
      description,
      brand: product.brand,
    });
  row["Product Title en-GB/IE"] = productName;
  row["Product Title it-IT"] = productName;
  row["Product Title fr-CH"] = productName;
  row["Product Title de-CH"] = productName;
  row["Webcatchline en-GB/IE"] = productName;
  row["Description en-GB/IE"] = description;
  row["Webcatchline it-IT"] = productName;
  row["Description it-IT"] = description;
  row["Webcatchline fr-CH"] = productName;
  row["Description fr-CH"] = description;
  row["Webcatchline de-CH"] = productName;
  row["Description de-CH"] = description;
  row["Main Image"] = images[0] ?? "";
  row["Image 2"] = images[1] ?? "";
  row["Image 3"] = images[2] ?? "";
  row["Image 4"] = images[3] ?? "";
  row["Image 5"] = images[4] ?? "";
  row["Image 6"] = images[5] ?? "";
  row["Image 7"] = images[6] ?? "";
  row["codes EAN"] = product.gtin;
  row["Brand"] = product.brand;
  row["état"] = DEFAULT_CONDITION;
  row["Sports"] = resolveSportFromTitle(productName);
  row["Genre"] = product.gender ?? "";
  row["Couleur"] = product.color ?? "";
  row["Sizes for Footwear"] = product.size ?? "";
  row["Product Natures - Shoes"] = DEFAULT_PRODUCT_NATURE_SHOES;

  const missingRequired = resolveRequiredMissing(row);
  if (missingRequired.length > 0) {
    recordDecathlonExclusion(summary, {
      reason: "MISSING_PRODUCT_FIELDS",
      message: `Missing required columns: ${missingRequired.join(", ")}`,
      fileType: "products",
      providerKey: product.providerKey,
      gtin: product.gtin,
    });
    return null;
  }

  return row;
}

export function buildDecathlonAlternativeOfferRow(
  product: AlternativeProductRecord,
  summary: DecathlonExclusionSummary
): Record<string, string> | null {
  const priceValue = Number(product.priceExVat);
  if (!Number.isFinite(priceValue) || priceValue <= 0) {
    recordDecathlonExclusion(summary, {
      reason: "MISSING_PRICE",
      message: "Missing offer price",
      fileType: "offers",
      providerKey: product.providerKey,
      gtin: product.gtin,
    });
    return null;
  }
  const stock = Number(product.stock);
  if (!Number.isFinite(stock) || stock <= 0) {
    recordDecathlonExclusion(summary, {
      reason: "MISSING_STOCK",
      message: "No exportable stock",
      fileType: "offers",
      providerKey: product.providerKey,
      gtin: product.gtin,
    });
    return null;
  }

  const row = createRow(OFFERS_HEADERS);
  row["sku"] = product.providerKey;
  row["product-id"] = product.gtin;
  row["product-id-type"] = "EAN";
  row["price"] = priceValue.toFixed(2);
  row["quantity"] = String(stock);
  row["state"] = DEFAULT_CONDITION;
  row["logistic-class"] = product.decathlonLogisticClass ?? "";
  row["leadtime-to-ship"] =
    product.decathlonLeadTimeToShip !== null && product.decathlonLeadTimeToShip !== undefined
      ? String(product.decathlonLeadTimeToShip)
      : "";
  row["min-order-quantity"] = "";
  row["max-order-quantity"] = "";
  row["discount-price"] = "";
  row["discount-start-date"] = "";
  row["discount-end-date"] = "";
  row["description"] = "";

  return row;
}

export function buildDecathlonAlternativeFiles(
  products: AlternativeProductRecord[],
  summary: DecathlonExclusionSummary
): { products: DecathlonExportFilePayload; offers: DecathlonExportFilePayload } {
  const productRows = [];
  const offerRows = [];

  for (const product of products) {
    const productRow = buildDecathlonAlternativeProductRow(product, summary);
    if (productRow) productRows.push(productRow);
    const offerRow = buildDecathlonAlternativeOfferRow(product, summary);
    if (offerRow) offerRows.push(offerRow);
  }

  return {
    products: { type: "products", headers: PRODUCTS_HEADERS, rows: productRows },
    offers: { type: "offers", headers: OFFERS_HEADERS, rows: offerRows },
  };
}
