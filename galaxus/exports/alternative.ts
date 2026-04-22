import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import { ALTERNATIVE_PARTNER_KEY, isAlternativeProductsPartnerKey } from "@/app/lib/alternativeProducts";
import { accumulateBestCandidates } from "@/galaxus/exports/gtinSelection";
import { buildFeedMappingsWhere } from "@/galaxus/exports/trmExport";
import { PARTNER_KEY_SELECT, partnerKeysLowerSet } from "@/galaxus/exports/partnerPricing";

type ExportRow = Record<string, string>;

export type AlternativeProductRecord = {
  id: string;
  externalKey: string;
  gtin: string;
  providerKey: string;
  brand: string;
  title: string;
  variantName: string | null;
  description: string;
  category: string;
  size: string;
  mainImageUrl: string;
  extraImageUrls: string[];
  color: string | null;
  gender: string | null;
  material: string | null;
  stock: number;
  priceExVat: number;
  vatRate: number;
  currency: string;
  leadTimeDays: number | null;
  specsJson: Record<string, string> | null;
  decathlonLogisticClass: string | null;
  decathlonLeadTimeToShip: number | null;
};

type NormalPriceMaps = {
  byGtin: Map<string, number>;
  byProviderKey: Map<string, number>;
};

function parseDecimal(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function normalizeImageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function sanitizeText(value?: string | null): string {
  if (!value) return "";
  return value.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max).trim();
}

function buildManufacturerKey(base: string, gtin?: string | null, fallbackKey?: string | null): string {
  const cleanedBase = sanitizeText(base);
  const cleanedGtin = sanitizeText(gtin ?? "");
  const cleanedFallback = sanitizeText(fallbackKey ?? "");
  const suffix = cleanedGtin || cleanedFallback;
  if (!suffix) {
    return truncate(cleanedBase, 50);
  }
  const maxBaseLen = Math.max(0, 50 - suffix.length - 1);
  if (!cleanedBase || maxBaseLen <= 0) {
    return suffix;
  }
  return `${cleanedBase.slice(0, maxBaseLen)}-${suffix}`;
}

function cleanDescription(value?: string | null): string {
  if (!value) return "";
  let text = value.replace(/<[^>]*>/g, " ");
  text = text.replace(/https?:\/\/\S+/g, "");
  text = sanitizeText(text);
  return truncate(text, 4000);
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number) {
  const result = new Date(base);
  result.setDate(result.getDate() + days);
  return result;
}

export async function loadAlternativeProductsForExport(params?: {
  partnerKey?: string;
  providerKeys?: string[];
}): Promise<AlternativeProductRecord[]> {
  const partnerKey = params?.partnerKey ?? ALTERNATIVE_PARTNER_KEY;
  if (!isAlternativeProductsPartnerKey(partnerKey)) return [];

  const prismaAny = prisma as any;
  const partner = await prismaAny.partner.findUnique({
    where: { key: partnerKey },
    select: { id: true },
  });
  if (!partner) return [];

  const providerKeyFilter =
    params?.providerKeys && params.providerKeys.length > 0
      ? { providerKey: { in: params.providerKeys } }
      : null;

  const rows = await prismaAny.alternativeProduct.findMany({
    where: {
      partnerId: partner.id,
      exportEnabled: true,
      archivedAt: null,
      ...(providerKeyFilter ?? {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  return rows.map((row: any) => ({
    id: row.id,
    externalKey: String(row.externalKey ?? ""),
    gtin: String(row.gtin ?? ""),
    providerKey: String(row.providerKey ?? ""),
    brand: String(row.brand ?? ""),
    title: String(row.title ?? ""),
    variantName: row.variantName ? String(row.variantName) : null,
    description: String(row.description ?? ""),
    category: String(row.category ?? ""),
    size: String(row.size ?? ""),
    mainImageUrl: String(row.mainImageUrl ?? ""),
    extraImageUrls: normalizeImageList(row.extraImageUrls),
    color: row.color ? String(row.color) : null,
    gender: row.gender ? String(row.gender) : null,
    material: row.material ? String(row.material) : null,
    stock: Number.parseInt(String(row.stock ?? 0), 10) || 0,
    priceExVat: parseDecimal(row.priceExVat),
    vatRate: parseDecimal(row.vatRate),
    currency: String(row.currency ?? "CHF"),
    leadTimeDays: row.leadTimeDays ?? null,
    specsJson: row.specsJson && typeof row.specsJson === "object" ? row.specsJson : null,
    decathlonLogisticClass: row.decathlonLogisticClass ?? null,
    decathlonLeadTimeToShip: row.decathlonLeadTimeToShip ?? null,
  }));
}

export async function loadNormalExportCandidatePrices(params?: {
  gtins?: string[];
  providerKeys?: string[];
}): Promise<NormalPriceMaps> {
  const gtins = params?.gtins?.filter(Boolean) ?? [];
  const providerKeys = params?.providerKeys?.filter(Boolean) ?? [];
  if (gtins.length === 0 && providerKeys.length === 0) {
    return { byGtin: new Map(), byProviderKey: new Map() };
  }

  const prismaAny = prisma as any;
  const partners = await prismaAny.partner.findMany({ select: PARTNER_KEY_SELECT });
  const galaxusPartnerKeysLower = partnerKeysLowerSet(partners);

  const mappings = await prismaAny.variantMapping.findMany({
    where: {
      ...buildFeedMappingsWhere(null, false),
      ...(gtins.length > 0 ? { gtin: { in: gtins } } : {}),
      ...(providerKeys.length > 0 ? { providerKey: { in: providerKeys } } : {}),
    },
    include: {
      supplierVariant: true,
      kickdbVariant: { include: { product: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const bestByGtin = new Map<string, any>();
  accumulateBestCandidates(mappings, bestByGtin, {
    keyBy: "gtin",
    requireProductName: false,
    requireImage: false,
    galaxusPartnerKeysLower,
  });

  const byGtin = new Map<string, number>();
  const byProviderKey = new Map<string, number>();
  for (const candidate of bestByGtin.values()) {
    const gtin = String(candidate?.gtin ?? "").trim();
    const providerKey = String(candidate?.providerKey ?? "").trim();
    const price = Number(candidate?.sellPriceExVat);
    if (!gtin || !Number.isFinite(price)) continue;
    byGtin.set(gtin, price);
    if (providerKey) byProviderKey.set(providerKey, price);
  }

  return { byGtin, byProviderKey };
}

export function filterAlternativeProducts(params: {
  alternatives: AlternativeProductRecord[];
  normalByGtin: Map<string, number>;
  normalByProviderKey: Map<string, number>;
}) {
  const exportable: AlternativeProductRecord[] = [];
  const excluded: Array<{
    product: AlternativeProductRecord;
    reason: "MATCHING_PROVIDER_KEY" | "DUPLICATE_GTIN" | "PRICE_HIGHER";
    normalPrice?: number;
  }> = [];

  for (const product of params.alternatives) {
    if (!validateGtin(String(product.gtin ?? "").trim())) {
      continue;
    }
    const providerKeyMatch = params.normalByProviderKey.get(product.providerKey);
    if (providerKeyMatch !== undefined) {
      excluded.push({ product, reason: "MATCHING_PROVIDER_KEY", normalPrice: providerKeyMatch });
      continue;
    }
    const gtinMatch = params.normalByGtin.get(product.gtin);
    if (gtinMatch !== undefined) {
      if (Number.isFinite(product.priceExVat) && product.priceExVat > gtinMatch) {
        excluded.push({ product, reason: "PRICE_HIGHER", normalPrice: gtinMatch });
      } else {
        excluded.push({ product, reason: "DUPLICATE_GTIN", normalPrice: gtinMatch });
      }
      continue;
    }
    exportable.push(product);
  }

  return { exportable, excluded };
}

export function buildGalaxusAlternativeMasterRows(
  products: AlternativeProductRecord[],
  params: { minimal: boolean; includeWeight: boolean }
): ExportRow[] {
  if (params.minimal) {
    return products.map((product) => ({
      ProviderKey: product.providerKey,
      Gtin: product.gtin,
      BrandName: product.brand,
    }));
  }
  return products.map((product) => {
    const manufacturerBase = product.externalKey || product.title || product.brand;
    const row: ExportRow = {
      ProviderKey: product.providerKey,
      Gtin: product.gtin,
      ManufacturerKey: buildManufacturerKey(manufacturerBase, product.gtin, product.providerKey),
      BrandName: product.brand,
      ProductCategory: product.category || "Sneakers",
      ProductTitle_de: product.title,
      ProductTitle_en: product.title,
      ProductTitle_ch: product.title,
      VariantName: product.variantName || product.title,
      LongDescription_de: cleanDescription(product.description),
      MainImageUrl: product.mainImageUrl,
    };
    if (params.includeWeight) {
      row.ProductWeight = "1000";
    }
    return row;
  });
}

export function buildGalaxusAlternativeStockRows(products: AlternativeProductRecord[]): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const product of products) {
    const stock = Number.isFinite(product.stock) ? product.stock : 0;
    if (stock <= 0) continue;
    let restockTime = "";
    let restockDate = "";
    if (product.leadTimeDays !== null && Number.isFinite(product.leadTimeDays)) {
      restockTime = String(product.leadTimeDays);
      restockDate = toIsoDate(addDays(new Date(), product.leadTimeDays));
    }
    rows.push({
      ProviderKey: product.providerKey,
      QuantityOnStock: String(stock),
      RestockTime: restockTime,
      RestockDate: restockDate,
      MinimumOrderQuantity: "1",
      OrderQuantitySteps: "1",
      TradeUnit: "",
      LogisticUnit: "",
      WarehouseCountry: "Poland",
      DirectDeliverySupported: "no",
    });
  }
  return rows;
}

export function buildGalaxusAlternativeOfferRows(
  products: AlternativeProductRecord[],
  params: { priceHeader: string; isMerchant: boolean }
): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const product of products) {
    const priceValue = Number(product.priceExVat);
    if (!Number.isFinite(priceValue) || priceValue <= 0) continue;
    const price = priceValue.toFixed(2);
    const vatRate = Number.isFinite(product.vatRate) ? product.vatRate : 0.081;
    const vatRatePct = (vatRate * 100).toFixed(2);
    if (params.isMerchant) {
      rows.push({
        ProviderKey: product.providerKey,
        [params.priceHeader]: price,
        VatRatePercentage: vatRatePct,
      });
      continue;
    }
    const rrpAdjusted = (priceValue * (1 + vatRate)).toFixed(2);
    rows.push({
      ProviderKey: product.providerKey,
      [params.priceHeader]: price,
      SuggestedRetailPriceInclVat_CHF: rrpAdjusted,
      VatRatePercentage: vatRatePct,
    });
  }
  return rows;
}

export function buildGalaxusAlternativeSpecRows(products: AlternativeProductRecord[]): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const product of products) {
    const providerKey = product.providerKey;
    if (!providerKey) continue;
    if (product.size) {
      rows.push({
        ProviderKey: providerKey,
        SpecificationKey: "Schuhgrösse (EU)",
        SpecificationValue: product.size,
      });
      rows.push({
        ProviderKey: providerKey,
        SpecificationKey: "Bekleidungsgrösse",
        SpecificationValue: product.size,
      });
    }
    if (product.brand) {
      rows.push({
        ProviderKey: providerKey,
        SpecificationKey: "Brand",
        SpecificationValue: product.brand,
      });
    }
    if (product.color) {
      rows.push({
        ProviderKey: providerKey,
        SpecificationKey: "Color",
        SpecificationValue: product.color,
      });
    }
    if (product.gender) {
      rows.push({
        ProviderKey: providerKey,
        SpecificationKey: "Target group",
        SpecificationValue: product.gender,
      });
    }
    if (product.material) {
      rows.push({
        ProviderKey: providerKey,
        SpecificationKey: "Material",
        SpecificationValue: product.material,
      });
    }
    if (product.specsJson) {
      for (const [key, value] of Object.entries(product.specsJson)) {
        const cleanedKey = String(key ?? "").trim();
        const cleanedValue = String(value ?? "").trim();
        if (!cleanedKey || !cleanedValue) continue;
        rows.push({
          ProviderKey: providerKey,
          SpecificationKey: cleanedKey,
          SpecificationValue: cleanedValue,
        });
      }
    }
  }
  return rows;
}
