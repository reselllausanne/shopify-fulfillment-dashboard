import { prisma } from "@/app/lib/prisma";
import { toCsv } from "@/galaxus/exports/csv";
import {
  createDecathlonExclusionSummary,
  loadDecathlonCandidates,
  recordDecathlonExclusion,
} from "@/decathlon/exports/mapping";
import { BASE_REQUIRED_COLUMNS, buildProductRow } from "@/decathlon/exports/productCsv";
import { PRODUCTS_HEADERS } from "@/decathlon/exports/templates";
import type { DecathlonExportCandidate } from "@/decathlon/exports/types";
import { buildMiraklClient } from "@/decathlon/mirakl/client";
import { DECATHLON_MIRAKL_TEST_LIMIT, DECATHLON_MIRAKL_TEST_MODE } from "./config";
import { detectDelimiter, parseDelimitedCsv } from "./csvParse";

export type ProductStatusClassification = "LIVE" | "NOT_LIVE" | "UNKNOWN";

export type ProductStatusLookup = {
  byProductId: Map<string, string>;
  byEan: Map<string, string>;
};

export type ProductOnboardingRow = {
  providerKey: string;
  gtin: string;
  supplierVariantId: string | null;
  hierarchy: string;
  row: Record<string, string>;
};

type RequiredAttributesCache = Map<string, { required: string[]; error?: string }>;

/** PM11 / API attribute codes → exact column in PRODUCTS_HEADERS (when labels differ). */
const PM11_CODE_TO_HEADER: Record<string, string> = (() => {
  const m: Record<string, string> = {
    material: "matière principale",
    "main material": "matière principale",
    main_material: "matière principale",
    matiere_principale: "matière principale",
    color: "Couleur",
    colour: "Couleur",
    couleur: "Couleur",
    gender: "Genre",
    brand: "Brand",
    marque: "Brand",
    category: "Catégorie",
    categorie: "Catégorie",
    sport: "Sports",
    sports: "Sports",
    ean: "codes EAN",
    gtin: "codes EAN",
    state: "état",
    etat: "état",
    "product identifier": "Product Identifier",
    productidentifier: "Product Identifier",
    "sizes for footwear": "Sizes for Footwear",
    size_footwear: "Sizes for Footwear",
    "product natures shoes": "Product Natures - Shoes",
    product_natures_shoes: "Product Natures - Shoes",
    "main image": "Main Image",
    main_image: "Main Image",
  };
  for (const [k, v] of Object.entries({ ...m })) {
    m[normalizeKey(k).replace(/\s+/g, "_")] = v;
  }
  return m;
})();

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[_\s-]+/g, " ").trim();
}

function foldForCompare(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function normalizeRecord(input: Record<string, unknown>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    record[String(key)] = value === null || value === undefined ? "" : String(value);
  }
  return record;
}

function parseStatusRecords(raw: string): Record<string, string>[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const payload = JSON.parse(trimmed);
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.results)
              ? payload.results
              : Array.isArray(payload?.rows)
                ? payload.rows
                : [];
      return list.map((entry: any) => normalizeRecord(entry ?? {}));
    } catch {
      // fall through to CSV parsing
    }
  }

  const delimiter = detectDelimiter(raw);
  const rows = parseDelimitedCsv(raw, delimiter);
  const header = rows[0]?.map((col) => col.trim()) ?? [];
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((key, idx) => {
      record[key] = row[idx] ?? "";
    });
    return record;
  });
}

function pickRecordValue(record: Record<string, string>, matcher: RegExp): string {
  for (const [key, value] of Object.entries(record)) {
    if (matcher.test(normalizeKey(key))) return String(value ?? "");
  }
  return "";
}

function extractStatusEntries(raw: string): Array<{ productId: string; ean: string; status: string }> {
  const records = parseStatusRecords(raw);
  return records.map((record) => ({
    productId: pickRecordValue(record, /product identifier|product id|productid|product code|sku/),
    ean: pickRecordValue(record, /ean|gtin|codes? ean/),
    status: pickRecordValue(record, /status|state|lifecycle|live/),
  }));
}

export function classifyProductStatus(status: string | null | undefined): ProductStatusClassification {
  if (!status) return "UNKNOWN";
  const normalized = status.trim().toUpperCase();
  if (normalized.includes("NOT_LIVE") || normalized.includes("NOT LIVE")) return "NOT_LIVE";
  if (normalized.includes("ERROR") || normalized.includes("KO") || normalized.includes("INVALID")) return "NOT_LIVE";
  if (normalized.includes("REJECT")) return "NOT_LIVE";
  if (normalized.includes("LIVE") || normalized === "OK" || normalized === "VALID") return "LIVE";
  return "UNKNOWN";
}

export function resolveProductStatus(
  lookup: ProductStatusLookup,
  providerKey: string,
  gtin: string
): { raw: string | null; classification: ProductStatusClassification } {
  const raw = lookup.byProductId.get(providerKey) ?? lookup.byEan.get(gtin) ?? null;
  return { raw, classification: classifyProductStatus(raw) };
}

export async function fetchProductStatusLookup(): Promise<ProductStatusLookup> {
  const client = buildMiraklClient();
  const exportText = await client.getProductStatusExport();
  const entries = extractStatusEntries(exportText);
  const byProductId = new Map<string, string>();
  const byEan = new Map<string, string>();
  for (const entry of entries) {
    const productId = String(entry.productId ?? "").trim();
    const ean = String(entry.ean ?? "").trim();
    const status = String(entry.status ?? "").trim();
    if (productId) byProductId.set(productId, status);
    if (ean) byEan.set(ean, status);
  }
  return { byProductId, byEan };
}

async function persistProductStatuses(
  candidates: DecathlonExportCandidate[],
  lookup: ProductStatusLookup
): Promise<void> {
  const prismaAny = prisma as any;
  const now = new Date();
  for (const candidate of candidates) {
    const providerKey = String(candidate.providerKey ?? "").trim();
    const gtin = String(candidate.gtin ?? "").trim();
    if (!providerKey || !gtin) continue;
    const status = resolveProductStatus(lookup, providerKey, gtin);
    const statusValue =
      status.raw ?? (status.classification === "UNKNOWN" ? null : status.classification);
    if (!statusValue) continue;
    const supplierVariantId = String(candidate?.variant?.supplierVariantId ?? "").trim() || null;
    await prismaAny.decathlonOfferSync.upsert({
      where: { providerKey },
      create: {
        providerKey,
        supplierVariantId,
        gtin,
        productStatus: statusValue,
        productStatusCheckedAt: now,
      },
      update: {
        supplierVariantId,
        gtin,
        productStatus: statusValue,
        productStatusCheckedAt: now,
      },
    });
  }
}

function extractRequiredAttributes(payload: any): string[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.attributes)
      ? payload.attributes
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.results)
          ? payload.results
          : [];
  const required: string[] = [];
  for (const entry of list) {
    if (!entry) continue;
    const merged =
      entry?.attribute && typeof entry.attribute === "object"
        ? { ...entry.attribute, ...entry }
        : entry;
    const level =
      merged?.requirement_level ??
      merged?.requirementLevel ??
      merged?.requirement ??
      merged?.level ??
      merged?.operator_requirement ??
      merged?.operatorRequirement ??
      merged?.operator_required ??
      merged?.operatorRequired ??
      entry?.requirement_level ??
      entry?.requirementLevel ??
      entry?.requirement ??
      entry?.level ??
      entry?.operator_requirement ??
      entry?.operatorRequirement ??
      entry?.operator_required ??
      entry?.operatorRequired ??
      null;
    const requiredFlag =
      merged?.required === true ||
      merged?.is_required === true ||
      merged?.isRequired === true ||
      entry?.required === true ||
      entry?.is_required === true ||
      entry?.isRequired === true;
    const levelStr = level ? String(level).toUpperCase() : "";
    const isRequired =
      requiredFlag || levelStr.includes("REQUIRED") || levelStr.includes("MANDATORY");
    if (!isRequired) continue;
    const code =
      merged?.code ??
      merged?.attribute_code ??
      merged?.attributeCode ??
      merged?.name ??
      merged?.label ??
      entry?.code ??
      entry?.attribute?.code ??
      entry?.attribute_code ??
      entry?.attributeCode ??
      entry?.name ??
      entry?.label ??
      null;
    if (code) required.push(String(code));
  }
  return Array.from(new Set(required));
}

/** PM11 can require dozens of category-specific columns we do not fill; only enforce overlap with our export template. */
const BASE_REQUIRED_SET = new Set(BASE_REQUIRED_COLUMNS);

function pm11MissingBaseColumns(row: Record<string, string>, pm11RequiredCodes: string[]): string[] {
  return pm11RequiredCodes.filter((attribute) => {
    const key = resolveHeaderKey(row, attribute);
    if (!key || !BASE_REQUIRED_SET.has(key)) return false;
    return !String(row[key] ?? "").trim();
  });
}

async function loadRequiredAttributes(
  hierarchy: string,
  cache: RequiredAttributesCache
): Promise<{ required: string[]; error?: string }> {
  if (cache.has(hierarchy)) {
    return cache.get(hierarchy)!;
  }
  const client = buildMiraklClient();
  try {
    const payload = await client.getProductAttributes(hierarchy);
    const required = extractRequiredAttributes(payload);
    const result = { required };
    cache.set(hierarchy, result);
    return result;
  } catch (error: any) {
    const result = { required: [] as string[], error: error?.message ?? "PM11 lookup failed" };
    cache.set(hierarchy, result);
    return result;
  }
}

function resolveHeaderKey(row: Record<string, string>, attributeCode: string): string | null {
  const normalized = normalizeKey(attributeCode);
  for (const key of Object.keys(row)) {
    if (normalizeKey(key) === normalized) return key;
  }
  if (row[attributeCode] !== undefined) return attributeCode;

  const underscored = normalizeKey(attributeCode.replace(/_/g, " "));
  for (const key of Object.keys(row)) {
    if (normalizeKey(key) === underscored) return key;
  }

  const foldAttr = foldForCompare(normalized);
  for (const key of Object.keys(row)) {
    if (foldForCompare(normalizeKey(key)) === foldAttr) return key;
  }

  const aliasHeader =
    PM11_CODE_TO_HEADER[foldAttr] ??
    PM11_CODE_TO_HEADER[normalized] ??
    PM11_CODE_TO_HEADER[underscored.replace(/\s+/g, "_")];
  if (aliasHeader && row[aliasHeader] !== undefined) return aliasHeader;

  return null;
}

/** True only when the attribute maps to a CSV column we export and that cell is empty. */
function isMissingAttribute(row: Record<string, string>, attributeCode: string): boolean {
  const key = resolveHeaderKey(row, attributeCode);
  if (!key) return false;
  return !String(row[key] ?? "").trim();
}

export async function prepareProductOnboarding(params?: {
  limit?: number;
  offset?: number;
  /**
   * If true, rows failing the PM11 required-attribute precheck are still included in the CSV.
   * The Mirakl import call can then enable AI_CONVERTER to enrich missing fields server-side.
   */
  useAiEnrichment?: boolean;
}) {
  const summary = createDecathlonExclusionSummary();
  const { candidates, scanned } = await loadDecathlonCandidates(summary);
  const limit = params?.limit ?? (DECATHLON_MIRAKL_TEST_MODE ? DECATHLON_MIRAKL_TEST_LIMIT : undefined);
  const useAiEnrichment = params?.useAiEnrichment ?? false;
  const offsetRaw = params?.offset ?? 0;
  const offset = Math.max(0, Math.floor(Number(offsetRaw)) || 0);
  const totalCandidates = candidates.length;
  const sliceStart = Math.min(offset, totalCandidates);
  let limited: DecathlonExportCandidate[];
  if (limit && Number.isFinite(limit) && limit > 0) {
    limited = candidates.slice(sliceStart, sliceStart + Math.floor(limit));
  } else {
    limited = candidates.slice(sliceStart);
  }

  const statusLookup = await fetchProductStatusLookup();
  await persistProductStatuses(limited, statusLookup);

  const cache: RequiredAttributesCache = new Map();
  const rows: ProductOnboardingRow[] = [];
  let skippedLive = 0;
  let missingRequiredAttributes = 0;
  let unknownStatus = 0;
  let notLive = 0;

  for (const candidate of limited) {
    const row = buildProductRow(candidate, summary);
    if (!row) continue;

    const providerKey = String(candidate.providerKey ?? "").trim();
    const gtin = String(candidate.gtin ?? "").trim();
    if (!providerKey || !gtin) continue;

    const supplierVariantId = String(candidate?.variant?.supplierVariantId ?? "").trim() || null;
    const status = resolveProductStatus(statusLookup, providerKey, gtin);
    if (status.classification === "LIVE") {
      skippedLive += 1;
      recordDecathlonExclusion(summary, {
        reason: "PRODUCT_ALREADY_LIVE",
        message: `CM11 status: ${status.raw ?? "LIVE"}`,
        fileType: "products",
        providerKey,
        supplierVariantId,
        gtin,
      });
      continue;
    }
    if (status.classification === "UNKNOWN") {
      unknownStatus += 1;
    } else {
      notLive += 1;
    }

    const hierarchy = row["Catégorie"] ?? "";
    const attrs = await loadRequiredAttributes(hierarchy, cache);
    if (attrs.error) {
      missingRequiredAttributes += 1;
      recordDecathlonExclusion(summary, {
        reason: "MISSING_REQUIRED_ATTRIBUTE",
        message: `PM11 failed for hierarchy ${hierarchy}: ${attrs.error}`,
        fileType: "products",
        providerKey,
        supplierVariantId,
        gtin,
      });
      // If we enable Mirakl AI enrichment, we can still import even without a PM11 payload.
      // Mirakl will infer missing required attributes from the provided CSV data.
      if (!useAiEnrichment) continue;
      // Treat as "no known required attributes" so we don't block the row.
      attrs.required = [];
    }

    const missing = pm11MissingBaseColumns(row, attrs.required);
    if (missing.length > 0) {
      missingRequiredAttributes += 1;
      recordDecathlonExclusion(summary, {
        reason: "MISSING_REQUIRED_ATTRIBUTE",
        message: `Missing required attributes (base export columns): ${missing.join(", ")}`,
        fileType: "products",
        providerKey,
        supplierVariantId,
        gtin,
      });
      if (!useAiEnrichment) {
        continue;
      }
    }

    rows.push({ providerKey, gtin, supplierVariantId, hierarchy, row });
  }

  const csv = toCsv(PRODUCTS_HEADERS, rows.map((entry) => entry.row));
  const counts: Record<string, number> = {
    scanned,
    eligible: limited.length,
    sent: rows.length,
    skippedLive,
    missingRequiredAttributes,
    unknownStatus,
    notLive,
    candidatesTotal: totalCandidates,
    candidateOffset: sliceStart,
    candidateWindowEnd: sliceStart + limited.length,
  };
  if (limit && Number.isFinite(limit) && limit > 0) {
    counts.limitApplied = Math.floor(limit);
  }

  return {
    rows,
    csv,
    summary: {
      counts,
      exclusions: summary.totals,
      testMode: DECATHLON_MIRAKL_TEST_MODE,
      testLimit: DECATHLON_MIRAKL_TEST_LIMIT,
    },
  };
}

export const __test__ = {
  classifyProductStatus,
  resolveProductStatus,
  extractRequiredAttributes,
  parseStatusRecords,
  extractStatusEntries,
  resolveHeaderKey,
  isMissingAttribute,
  pm11MissingBaseColumns,
};
