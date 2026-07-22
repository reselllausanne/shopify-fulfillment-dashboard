import { toCsv } from "@/galaxus/exports/csv";
import {
  buildGalaxusAlternativeMasterRows,
  buildGalaxusAlternativeSpecRows,
  filterAlternativeProducts,
  loadAlternativeProductsForExport,
} from "@/galaxus/exports/alternative";
import { loadMasterAndSpecsExportCandidates, type FeedExportCandidate } from "@/galaxus/exports/feedMappingLoader";
import {
  buildMasterSpecsValidationReport,
  countCriticalGtinIssues,
} from "@/galaxus/exports/feedValidation";
import { pickGalaxusProductImageList } from "@/galaxus/exports/productImages";
import { publishStxStockFromAsks } from "@/galaxus/stx/stockPublish";
import {
  resolveGalaxusDescription,
  resolveGalaxusProductCategoryPath,
} from "@/galaxus/exports/productClassification";
import { buildGalaxusSizeSpecRow } from "@/galaxus/exports/sizeSpecifications";
import { extractKickdbClassificationSignals } from "@/galaxus/kickdb/classificationSignals";
import { attachAvailableStock } from "@/inventory/availableStock";

type ExportRow = Record<string, string>;

type KickDbPayload = {
  title?: string;
  brand?: string;
  sku?: string;
  description?: string;
  category?: string;
  secondary_category?: string;
  product_type?: string;
  breadcrumbs?: Array<{ value?: string }>;
};

function sanitizeText(value?: string | null): string {
  if (!value) return "";
  return value.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeBrand(value?: string | null): string {
  const trimmed = sanitizeText(value);
  if (!trimmed) return "";
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max).trim();
}

function buildManufacturerKey(base: string, gtin: string | null, fallbackKey?: string | null): string {
  const cleanedBase = sanitizeText(base);
  const cleanedGtin = sanitizeText(gtin ?? "");
  const cleanedFallback = sanitizeText(fallbackKey ?? "");
  const suffix = cleanedGtin || cleanedFallback;
  if (!suffix) return truncate(cleanedBase, 50);
  const maxBaseLen = Math.max(0, 50 - suffix.length - 1);
  if (!cleanedBase || maxBaseLen <= 0) return suffix;
  return `${cleanedBase.slice(0, maxBaseLen)}-${suffix}`;
}

function buildProductCategory(
  payload: KickDbPayload | null,
  fallbackTitle?: string | null,
  brand?: string | null,
  rawJson?: unknown,
  sizeRaw?: string | null
): string {
  const signals = extractKickdbClassificationSignals(rawJson);
  return resolveGalaxusProductCategoryPath({
    title: fallbackTitle ?? payload?.title ?? null,
    description: payload?.description ?? null,
    category: signals.category ?? payload?.category ?? null,
    secondaryCategory: signals.secondaryCategory ?? payload?.secondary_category ?? null,
    productType: signals.productType ?? payload?.product_type ?? null,
    breadcrumbs:
      signals.breadcrumbValues.length > 0
        ? signals.breadcrumbValues
        : payload?.breadcrumbs?.map((item) => item.value ?? "").filter(Boolean) ?? null,
    breadcrumbAliases: signals.breadcrumbAliases.length > 0 ? signals.breadcrumbAliases : null,
    brand: brand ?? payload?.brand ?? null,
    sizeRaw: sizeRaw ?? null,
  });
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickTrait(traits: any, keys: string[]) {
  if (!traits) return null;
  const list = Array.isArray(traits) ? traits : traits.traits ?? traits;
  const traitArray = Array.isArray(list) ? list : [];
  const lowerKeys = keys.map((key) => key.toLowerCase());
  for (const entry of traitArray) {
    const entryKey = String(entry?.name ?? entry?.key ?? entry?.attribute ?? "").toLowerCase();
    if (!entryKey) continue;
    if (lowerKeys.some((key) => entryKey.includes(key))) {
      const value = entry?.value ?? entry?.values ?? entry?.displayValue ?? entry?.text;
      if (Array.isArray(value)) return String(value[0] ?? "");
      if (value !== null && value !== undefined) return String(value);
    }
  }
  return null;
}

function buildMasterRowsFromCandidates(
  exportCandidates: FeedExportCandidate[],
  stockBySupplierVariantId: Map<string, number>,
  includeWeight: boolean
): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const candidate of exportCandidates) {
    const mapping = candidate.mapping;
    const supplierVariant = candidate.variant as any;
    const product = candidate.product as any;
    const providerKey = candidate.providerKey ?? "";
    const sellPrice = Number(candidate.sellPriceExVat);
    if (!Number.isFinite(sellPrice) || sellPrice <= 0) continue;

    const manualLock = Boolean(supplierVariant?.manualLock);
    if (manualLock) {
      const manualPrice = parseNumber(supplierVariant?.manualPrice);
      if (!manualPrice || manualPrice <= 0) continue;
    }

    const manualStockRaw = supplierVariant?.manualStock;
    const manualStock =
      manualStockRaw === null || manualStockRaw === undefined
        ? null
        : Number.parseInt(String(manualStockRaw), 10);
    const supplierVariantId = String(supplierVariant?.supplierVariantId ?? "");
    const availableStock = supplierVariantId ? stockBySupplierVariantId.get(supplierVariantId) : undefined;
    const baseStock = Number.parseInt(String(supplierVariant?.stock ?? 0), 10);
    const rawStock =
      availableStock !== undefined
        ? availableStock
        : manualLock && manualStock !== null
          ? manualStock
          : baseStock;
    const isStx = supplierVariantId.startsWith("stx_") || providerKey.startsWith("STX_");
    const deliveryType = String(supplierVariant?.deliveryType ?? "");
    const effectiveStock =
      isStx && deliveryType.startsWith("express_")
        ? publishStxStockFromAsks(rawStock)
        : isStx
          ? 0
          : rawStock;
    if (!Number.isFinite(effectiveStock) || effectiveStock <= 0) continue;

    const images = pickGalaxusProductImageList(supplierVariant ?? {});
    if (!images.length) continue;

    const supplierName = sanitizeText(supplierVariant?.supplierProductName ?? "");
    const fallbackTitle = sanitizeText(
      supplierName ||
        supplierVariant?.supplierSku ||
        mapping.gtin ||
        providerKey ||
        supplierVariantId ||
        ""
    );
    const supplierBrand = normalizeBrand(
      supplierVariant?.supplierBrand ?? product?.brand ?? ""
    );
    const resolvedGtin = String(candidate.gtin ?? mapping.gtin ?? supplierVariant?.gtin ?? "").trim();
    const payload =
      product?.name || product?.brand || product?.description
        ? ({
            title: product?.name ?? undefined,
            brand: product?.brand ?? undefined,
            sku: product?.styleId ?? supplierVariant?.supplierSku ?? undefined,
            description: product?.description ?? undefined,
          } as KickDbPayload)
        : null;
    const title = fallbackTitle;
    const rawKickdbJson = (product as any)?.rawJson ?? null;
    const category = buildProductCategory(
      payload,
      fallbackTitle,
      supplierBrand || payload?.brand || product?.brand || null,
      rawKickdbJson,
      supplierVariant?.sizeRaw ?? null
    );
    const signals = extractKickdbClassificationSignals(rawKickdbJson);
    const description = resolveGalaxusDescription({
      description: payload?.description ?? null,
      title: fallbackTitle,
      brand: supplierBrand || payload?.brand || product?.brand || null,
      category: signals.category ?? payload?.category ?? null,
      secondaryCategory: signals.secondaryCategory ?? payload?.secondary_category ?? null,
      productType: signals.productType ?? payload?.product_type ?? null,
      breadcrumbs:
        signals.breadcrumbValues.length > 0
          ? signals.breadcrumbValues
          : payload?.breadcrumbs?.map((item) => item.value ?? "").filter(Boolean) ?? null,
      breadcrumbAliases: signals.breadcrumbAliases.length > 0 ? signals.breadcrumbAliases : null,
      sizeRaw: supplierVariant?.sizeRaw ?? null,
    });
    const manufacturerBase = payload?.sku ?? product?.styleId ?? supplierVariant?.supplierSku ?? "";
    const manufacturerKey = buildManufacturerKey(
      manufacturerBase,
      resolvedGtin || null,
      mapping.providerKey ?? null
    );

    const row: ExportRow = {
      ProviderKey: providerKey,
      Gtin: resolvedGtin,
      ManufacturerKey: manufacturerKey,
      BrandName: supplierBrand || normalizeBrand(payload?.brand ?? product?.brand ?? ""),
      ProductCategory: category,
      ProductTitle_de: title,
      ProductTitle_en: title,
      ProductTitle_ch: title,
      VariantName: title,
      LongDescription_de: description,
      MainImageUrl: images[0] ?? "",
      ImageUrl_1: images[1] ?? "",
      ImageUrl_2: images[2] ?? "",
    };
    if (includeWeight) {
      const weightValue = supplierVariant?.weightGrams ?? 1000;
      row.ProductWeight = Number.isFinite(weightValue) ? String(weightValue) : "1000";
    }
    rows.push(row);
  }
  return rows;
}

function buildSpecsRowsFromCandidates(exportCandidates: FeedExportCandidate[]): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const candidate of exportCandidates) {
    const variant = candidate.variant as any;
    const product = candidate.product as any;
    const providerKey = candidate.providerKey;
    if (!providerKey) continue;
    const traits = product?.traitsJson ?? null;
    const specSignals = extractKickdbClassificationSignals((product as any)?.rawJson ?? null);
    const sizeSpecRow = buildGalaxusSizeSpecRow({
      providerKey,
      sizeRaw: variant?.sizeRaw ?? null,
      sizeNormalized: variant?.sizeNormalized ?? null,
      supplierTitle: variant?.supplierProductName ?? null,
      supplierSku: variant?.supplierSku ?? null,
      kickdbTitle: product?.name ?? null,
      kickdbDescription: product?.description ?? null,
      breadcrumbAliases: specSignals.breadcrumbAliases,
      productType: specSignals.productType,
      brand: variant?.supplierBrand ?? product?.brand ?? null,
    });
    if (sizeSpecRow) {
      rows.push(sizeSpecRow);
    }
    const supplierBrand = variant?.supplierBrand ?? null;
    if (supplierBrand || product?.brand) {
      rows.push({
        ProviderKey: providerKey,
        SpecificationKey: "Brand",
        SpecificationValue: supplierBrand || product.brand,
      });
    }
    const color =
      pickTrait(traits, ["color", "colour"]) || String(variant?.supplierColorway ?? "").trim() || null;
    const gender =
      pickTrait(traits, ["gender", "sex", "target"]) || String(variant?.supplierGender ?? "").trim() || null;
    const material = pickTrait(traits, ["material"]);
    if (color) {
      rows.push({ ProviderKey: providerKey, SpecificationKey: "Color", SpecificationValue: color });
    }
    if (gender) {
      rows.push({ ProviderKey: providerKey, SpecificationKey: "Target group", SpecificationValue: gender });
    }
    if (material) {
      rows.push({ ProviderKey: providerKey, SpecificationKey: "Material", SpecificationValue: material });
    }
  }
  rows.sort((a, b) => a.ProviderKey.localeCompare(b.ProviderKey));
  return rows;
}

export type MasterSpecsFeedExportResult = {
  masterCsv: string;
  specsCsv: string;
  masterRows: ExportRow[];
  specsRows: ExportRow[];
  masterCount: number;
  specsCount: number;
  report: ReturnType<typeof buildMasterSpecsValidationReport>;
  criticalGtinIssues: number;
  invalidSupplierVariantIds: string[];
};

export async function buildMasterSpecsFeedExport(params: {
  supplier?: string | null;
  limit?: number | null;
  providerKeys?: string[];
  includeWeight?: boolean;
}): Promise<MasterSpecsFeedExportResult> {
  const { supplier, limit, providerKeys = [], includeWeight = false } = params;
  const all = !limit;
  const loaded = await loadMasterAndSpecsExportCandidates({
    supplier,
    all,
    limit: limit ?? undefined,
    providerKeys,
  });

  if (loaded.invalidSupplierVariantIds.length > 0) {
    throw new Error(
      `ProviderKey/GTIN invariant failed (${loaded.invalidSupplierVariantIds.slice(0, 5).join(", ")})`
    );
  }

  const stockBySupplierVariantId = await attachAvailableStock(
    loaded.masterExportCandidates.map((candidate) => candidate.variant).filter(Boolean)
  );

  let masterRows = buildMasterRowsFromCandidates(
    loaded.masterExportCandidates,
    stockBySupplierVariantId,
    includeWeight
  );
  let specsRows = buildSpecsRowsFromCandidates(loaded.specsExportCandidates);

  const allowAlternatives = !supplier || supplier.toLowerCase() === "ner";
  if (allowAlternatives) {
    const normalByGtin = new Map<string, number>();
    const normalByProviderKey = new Map<string, number>();
    for (const candidate of loaded.specsExportCandidates) {
      const gtin = String(candidate?.gtin ?? "").trim();
      const providerKey = String(candidate?.providerKey ?? "").trim();
      const price = Number(candidate?.sellPriceExVat);
      if (gtin && Number.isFinite(price)) normalByGtin.set(gtin, price);
      if (providerKey && Number.isFinite(price)) normalByProviderKey.set(providerKey, price);
    }
    const alternatives = await loadAlternativeProductsForExport({
      providerKeys: providerKeys.length > 0 ? providerKeys : undefined,
    });
    const { exportable } = filterAlternativeProducts({
      alternatives,
      normalByGtin,
      normalByProviderKey,
    });
    masterRows = [...masterRows, ...buildGalaxusAlternativeMasterRows(exportable, { minimal: false, includeWeight })];
    specsRows = [...specsRows, ...buildGalaxusAlternativeSpecRows(exportable)];
    specsRows.sort((a, b) => a.ProviderKey.localeCompare(b.ProviderKey));
  }

  const masterHeaders = includeWeight
    ? [
        "ProviderKey",
        "Gtin",
        "ManufacturerKey",
        "BrandName",
        "ProductCategory",
        "ProductTitle_de",
        "ProductTitle_en",
        "ProductTitle_ch",
        "VariantName",
        "LongDescription_de",
        "MainImageUrl",
        "ImageUrl_1",
        "ImageUrl_2",
        "ProductWeight",
      ]
    : [
        "ProviderKey",
        "Gtin",
        "ManufacturerKey",
        "BrandName",
        "ProductCategory",
        "ProductTitle_de",
        "ProductTitle_en",
        "ProductTitle_ch",
        "VariantName",
        "LongDescription_de",
        "MainImageUrl",
        "ImageUrl_1",
        "ImageUrl_2",
      ];
  const specsHeaders = ["ProviderKey", "SpecificationKey", "SpecificationValue"];
  const report = buildMasterSpecsValidationReport(masterRows, specsRows);

  return {
    masterCsv: toCsv(masterHeaders, masterRows),
    specsCsv: toCsv(specsHeaders, specsRows),
    masterRows,
    specsRows,
    masterCount: masterRows.length,
    specsCount: specsRows.length,
    report,
    criticalGtinIssues: countCriticalGtinIssues(report),
    invalidSupplierVariantIds: loaded.invalidSupplierVariantIds,
  };
}
