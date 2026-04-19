import { prisma } from "@/app/lib/prisma";
import { recordDecathlonExclusion } from "@/decathlon/exports/mapping";
import {
  resolveOfferDescription,
  resolveOfferDiscountEndDate,
  resolveOfferDiscountPrice,
  resolveOfferDiscountStartDate,
  resolveOfferLeadTimeToShip,
  resolveOfferLogisticClass,
  resolveOfferMaxOrderQuantity,
  resolveOfferMinOrderQuantity,
} from "@/decathlon/exports/offerCsv";
import type { DecathlonExclusionSummary } from "@/decathlon/exports/types";
import { randomUUID, createHash } from "crypto";
import { getStorageAdapter } from "@/galaxus/storage/storage";
import {
  DECATHLON_MIRAKL_P41_POLL_INTERVAL_MS,
  DECATHLON_MIRAKL_P41_POLL_MAX_MS,
  DECATHLON_MIRAKL_TEST_LIMIT,
  DECATHLON_MIRAKL_TEST_MODE,
  DECATHLON_MIRAKL_WAREHOUSE_CODE,
} from "./config";
import { buildMiraklClient } from "@/decathlon/mirakl/client";
import { detectDelimiter, parseDelimitedCsv } from "./csvParse";
import { buildOf01Csv, buildPri01Csv, buildSto01Csv } from "./csv";
import { buildDecathlonDeltas, DecathlonSyncRow, miraklOfferSku } from "./deltas";
import { prepareProductOnboarding, resolveProductStatus, type ProductStatusLookup } from "./products";
import type {
  MiraklErrorReport,
  MiraklImportFlow,
  MiraklImportMode,
  MiraklImportStatus,
  MiraklImportSummary,
} from "./types";

type ImportRunResult = {
  runId: string;
  flow: MiraklImportFlow;
  mode: MiraklImportMode;
  rowsSent: number;
  importId: string | null;
  status: MiraklImportStatus;
  linesInError: number;
  summary: MiraklImportSummary | null;
  errorSummary?: MiraklErrorReport["summary"] | null;
  precheckSummary?: Record<string, unknown> | null;
  /** True if P51 polling stopped before Mirakl returned a terminal status (still RUNNING). */
  p51PollTimedOut?: boolean;
};

type ProductSyncRow = {
  providerKey: string;
  gtin: string;
  supplierVariantId: string | null;
  productIdentifier: string;
};

const DEFAULT_OFFER_STATE = "11";

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractImportId(payload: any): string | null {
  const raw =
    payload?.import_id ??
    payload?.importId ??
    payload?.import_id?.toString?.() ??
    payload?.importId?.toString?.() ??
    null;
  if (!raw) return null;
  return String(raw);
}

function extractStatus(payload: any): string | null {
  const raw = payload?.status ?? payload?.import_status ?? payload?.importStatus ?? null;
  if (!raw) return null;
  return String(raw);
}

function extractLinesInError(payload: any): number {
  const raw =
    payload?.lines_in_error ??
    payload?.linesInError ??
    payload?.transform_lines_in_error ??
    payload?.transformLinesInError ??
    payload?.lines_error ??
    payload?.lines_error_count ??
    null;
  const parsed = parseNumber(raw);
  return parsed !== null ? parsed : 0;
}

function extractLinesRead(payload: any): number | null {
  const raw =
    payload?.lines_read ??
    payload?.linesRead ??
    payload?.lines_imported ??
    payload?.transform_lines_read ??
    payload?.transformLinesRead ??
    null;
  return parseNumber(raw);
}

function extractLinesSuccess(payload: any): number | null {
  const raw =
    payload?.lines_in_success ??
    payload?.linesInSuccess ??
    payload?.lines_success ??
    payload?.transform_lines_in_success ??
    payload?.transformLinesInSuccess ??
    null;
  return parseNumber(raw);
}

function mapImportStatus(statusRaw: string | null, linesInError: number): MiraklImportStatus {
  if (!statusRaw) return linesInError > 0 ? "PARTIAL" : "RUNNING";
  const status = statusRaw.toUpperCase();
  if (status.includes("FAIL") || status.includes("ERROR") || status.includes("REJECT")) {
    return "FAILED";
  }
  if (
    status.includes("COMPLETE") ||
    status.includes("SUCCESS") ||
    status.includes("DONE") ||
    status === "SENT" ||
    status.includes("IMPORT_COMPLETE")
  ) {
    return linesInError > 0 ? "PARTIAL" : "SUCCESS";
  }
  return "RUNNING";
}

function parseErrorReport(csvText: string): MiraklErrorReport {
  const delimiter = detectDelimiter(csvText);
  const rows = parseDelimitedCsv(csvText, delimiter);
  const header = rows[0]?.map((col) => col.trim()) ?? [];
  const lower = header.map((col) => col.toLowerCase());
  const skuIndex = lower.findIndex((col) =>
    /offer[-_ ]?sku|sku|product identifier|product[-_ ]?id|productid|ean|gtin|codes?\s*ean/.test(col)
  );
  const messageIndex = lower.findIndex((col) => /error|message|reason/.test(col));

  const errorMap = new Map<string, { count: number; sampleSkus: Set<string> }>();
  const sampleRows: MiraklErrorReport["summary"]["sampleRows"] = [];
  const failedSkus = new Set<string>();

  for (const row of rows.slice(1)) {
    if (!row || row.length === 0) continue;
    const raw: Record<string, string> = {};
    header.forEach((key, idx) => {
      raw[key] = row[idx] ?? "";
    });
    const sku = skuIndex >= 0 ? String(row[skuIndex] ?? "").trim() : "";
    const message =
      messageIndex >= 0
        ? String(row[messageIndex] ?? "").trim()
        : String(raw["message"] ?? raw["error"] ?? "").trim();

    if (sku) failedSkus.add(sku);

    const reason = message || "Unknown error";
    const bucket = errorMap.get(reason) ?? { count: 0, sampleSkus: new Set<string>() };
    bucket.count += 1;
    if (sku && bucket.sampleSkus.size < 5) bucket.sampleSkus.add(sku);
    errorMap.set(reason, bucket);

    if (sampleRows.length < 10) {
      sampleRows.push({ sku: sku || undefined, message: message || undefined, raw });
    }
  }

  const topReasons = Array.from(errorMap.entries())
    .map(([reason, bucket]) => ({
      reason,
      count: bucket.count,
      sampleSkus: Array.from(bucket.sampleSkus),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    summary: {
      totalErrors: Array.from(errorMap.values()).reduce((acc, bucket) => acc + bucket.count, 0),
      topReasons,
      sampleRows,
    },
    failedSkus,
    csvText,
    delimiter,
  };
}

async function storeErrorReport(runId: string, csvText: string) {
  const storage = getStorageAdapter();
  const buffer = Buffer.from(csvText, "utf8");
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const key = `decathlon/mirakl/errors/${runId}/error-report.csv`;
  const stored = storage.uploadBinary
    ? await storage.uploadBinary(key, buffer, "text/csv")
    : await storage.uploadPdf(key, buffer);
  return {
    checksum,
    sizeBytes: buffer.length,
    storageUrl: stored.storageUrl ?? null,
    publicUrl: stored.publicUrl ?? null,
  };
}

async function updateImportRun(runId: string, data: Record<string, unknown>) {
  await (prisma as any).decathlonImportRun.update({
    where: { runId },
    data,
  });
}

async function upsertOfferSyncRows(
  rows: DecathlonSyncRow[],
  flow: MiraklImportFlow,
  options: { failedSkus?: Set<string>; errorBySku?: Map<string, string> } = {}
) {
  const now = new Date();
  const failedSet = options.failedSkus ?? new Set<string>();
  const successRows = rows.filter((row) => !failedSet.has(row.providerKey));
  const failedRows = rows.filter((row) => failedSet.has(row.providerKey));

  for (const row of successRows) {
    await (prisma as any).decathlonOfferSync.upsert({
      where: { providerKey: row.providerKey },
      create: {
        providerKey: row.providerKey,
        supplierVariantId: row.supplierVariantId,
        gtin: row.gtin,
        lastStock: row.stock ?? null,
        lastPrice: row.price ?? null,
        lastStockSyncedAt: flow === "STO01" || flow === "OF01" ? now : null,
        lastPriceSyncedAt: flow === "PRI01" || flow === "OF01" ? now : null,
        offerCreatedAt: flow === "OF01" ? now : null,
        lastOfferSyncAt: flow === "OF01" ? now : null,
        lastError: null,
      },
      update: {
        supplierVariantId: row.supplierVariantId,
        gtin: row.gtin,
        lastStock: flow === "STO01" || flow === "OF01" ? row.stock ?? null : undefined,
        lastPrice: flow === "PRI01" || flow === "OF01" ? row.price ?? null : undefined,
        lastStockSyncedAt: flow === "STO01" || flow === "OF01" ? now : undefined,
        lastPriceSyncedAt: flow === "PRI01" || flow === "OF01" ? now : undefined,
        lastOfferSyncAt: flow === "OF01" ? now : undefined,
        lastError: null,
      },
    });
  }

  for (const row of failedRows) {
    await (prisma as any).decathlonOfferSync.upsert({
      where: { providerKey: row.providerKey },
      create: {
        providerKey: row.providerKey,
        supplierVariantId: row.supplierVariantId,
        gtin: row.gtin,
        lastError: options.errorBySku?.get(row.providerKey) ?? "Import error",
      },
      update: {
        lastError: options.errorBySku?.get(row.providerKey) ?? "Import error",
      },
    });
  }
}

async function upsertProductSyncRows(rows: ProductSyncRow[], failedProviderKeys: Set<string>) {
  const prismaAny = prisma as any;
  const now = new Date();
  const successRows = rows.filter((row) => !failedProviderKeys.has(row.providerKey));
  for (const row of successRows) {
    await prismaAny.decathlonOfferSync.upsert({
      where: { providerKey: row.providerKey },
      create: {
        providerKey: row.providerKey,
        supplierVariantId: row.supplierVariantId,
        gtin: row.gtin,
        lastProductSyncAt: now,
      },
      update: {
        supplierVariantId: row.supplierVariantId,
        gtin: row.gtin,
        lastProductSyncAt: now,
      },
    });
  }
}

function buildSummary(payload: any): MiraklImportSummary {
  return {
    importId: extractImportId(payload),
    status: extractStatus(payload),
    reasonStatus:
      payload?.reason_status != null
        ? String(payload.reason_status)
        : payload?.reasonStatus != null
          ? String(payload.reasonStatus)
          : null,
    integrationDetails: payload?.integration_details ?? payload?.integrationDetails ?? null,
    linesInError: extractLinesInError(payload),
    linesRead: extractLinesRead(payload),
    linesInSuccess: extractLinesSuccess(payload),
    raw: payload ?? null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createImportRun(flow: MiraklImportFlow, mode: MiraklImportMode, rowsSent: number, summary: any) {
  const runId = randomUUID();
  await (prisma as any).decathlonImportRun.create({
    data: {
      runId,
      flow,
      mode,
      status: "CREATED",
      rowsSent,
      summaryJson: summary ?? null,
    },
  });
  return runId;
}

async function finalizeImportRun(
  runId: string,
  payload: MiraklImportSummary | null,
  status: MiraklImportStatus,
  errorReport?: MiraklErrorReport | null,
  errorStorage?: {
    checksum: string;
    sizeBytes: number;
    storageUrl: string | null;
    publicUrl: string | null;
  }
) {
  const linesInError = payload?.linesInError ?? 0;
  await updateImportRun(runId, {
    status,
    finishedAt: ["SUCCESS", "FAILED", "PARTIAL"].includes(status) ? new Date() : null,
    linesInError,
    summaryJson: payload ?? null,
    errorSummaryJson: errorReport?.summary ?? null,
    errorSampleJson: errorReport?.summary?.sampleRows ?? null,
    errorChecksum: errorStorage?.checksum ?? null,
    errorSizeBytes: errorStorage?.sizeBytes ?? null,
    errorStorageUrl: errorStorage?.storageUrl ?? null,
    errorPublicUrl: errorStorage?.publicUrl ?? null,
  });
}

async function runImportFlow(params: {
  flow: MiraklImportFlow;
  mode: MiraklImportMode;
  rows: DecathlonSyncRow[];
  csv: string;
  withProducts?: boolean;
  summary?: Record<string, unknown>;
}): Promise<ImportRunResult> {
  const offerSkuToProviderKey = new Map<string, string>(
    params.rows.map((row) => [row.offerSku, row.providerKey])
  );
  const runId = await createImportRun(params.flow, params.mode, params.rows.length, {
    rowsSent: params.rows.length,
    withProducts: params.withProducts ?? false,
    ...params.summary,
  });

  if (params.rows.length === 0) {
    await finalizeImportRun(
      runId,
      { status: "NO_CHANGES", linesInError: 0, raw: { info: "No rows to send" } },
      "SUCCESS"
    );
    return {
      runId,
      flow: params.flow,
      mode: params.mode,
      rowsSent: 0,
      importId: null,
      status: "SUCCESS",
      linesInError: 0,
      summary: { status: "NO_CHANGES", linesInError: 0 },
    };
  }

  const client = buildMiraklClient();
  let importResponse: any = null;
  try {
    const queryParams: Record<string, string> = {};
    if (params.flow === "OF01") {
      queryParams.with_products = String(Boolean(params.withProducts));
      if (params.withProducts) {
        queryParams.operator_format = "true";
      }
      queryParams.import_mode = params.mode === "REPLACE" ? "REPLACE" : "NORMAL";
      importResponse = await client.importOffers(params.csv, queryParams);
    } else if (params.flow === "STO01") {
      importResponse = await client.importStock(params.csv);
    } else {
      importResponse = await client.importPricing(params.csv);
    }
  } catch (error: any) {
    const message = error?.message ?? "Mirakl import failed";
    await finalizeImportRun(
      runId,
      { status: "IMPORT_FAILED", linesInError: params.rows.length, raw: { error: message } },
      "FAILED"
    );
    return {
      runId,
      flow: params.flow,
      mode: params.mode,
      rowsSent: params.rows.length,
      importId: null,
      status: "FAILED",
      linesInError: params.rows.length,
      summary: { status: "IMPORT_FAILED", linesInError: params.rows.length, raw: { error: message } },
    };
  }

  const importId = extractImportId(importResponse);
  const initialSummary = buildSummary(importResponse);
  await updateImportRun(runId, {
    status: "RUNNING",
    importId,
    summaryJson: initialSummary,
  });

  if (!importId) {
    await finalizeImportRun(runId, initialSummary, "FAILED");
    return {
      runId,
      flow: params.flow,
      mode: params.mode,
      rowsSent: params.rows.length,
      importId: null,
      status: "FAILED",
      linesInError: initialSummary.linesInError ?? 0,
      summary: initialSummary,
    };
  }

  const statusPayload = await checkImportStatus({ flow: params.flow, importId, runId });
  const status = statusPayload.status;
  const linesInError = statusPayload.linesInError;

  let errorReport: MiraklErrorReport | null = null;
  let errorStorage: Awaited<ReturnType<typeof storeErrorReport>> | null = null;
  let errorBySku = new Map<string, string>();
  let failedSkus = new Set<string>();

  if (linesInError > 0 && importId) {
    const reportPayload = await downloadErrorReport({ flow: params.flow, importId, runId });
    if (reportPayload) {
      errorReport = reportPayload.report;
      errorStorage = reportPayload.storage;
      for (const offerSku of errorReport.failedSkus) {
        const providerKey = offerSkuToProviderKey.get(offerSku);
        if (providerKey) {
          failedSkus.add(providerKey);
        }
      }
      for (const sample of errorReport.summary.sampleRows) {
        if (sample.sku && sample.message) {
          const providerKey = offerSkuToProviderKey.get(sample.sku);
          if (providerKey) {
            errorBySku.set(providerKey, sample.message);
          }
        }
      }
    }
  }

  if (["SUCCESS", "PARTIAL"].includes(status)) {
    await upsertOfferSyncRows(params.rows, params.flow, { failedSkus, errorBySku });
  }

  await finalizeImportRun(runId, statusPayload.summary, status, errorReport, errorStorage ?? undefined);

  return {
    runId,
    flow: params.flow,
    mode: params.mode,
    rowsSent: params.rows.length,
    importId,
    status,
    linesInError,
    summary: statusPayload.summary,
    errorSummary: errorReport?.summary ?? null,
  };
}

async function runProductImportFlow(params: {
  rows: ProductSyncRow[];
  csv: string;
  mode: MiraklImportMode;
  summary?: Record<string, unknown>;
  aiEnrichmentWanted?: boolean;
}): Promise<ImportRunResult> {
  const identifierToProviderKey = new Map(params.rows.map((row) => [row.productIdentifier, row.providerKey]));
  const gtinToProviderKey = new Map(params.rows.map((row) => [row.gtin, row.providerKey]));
  const runId = await createImportRun("P41", params.mode, params.rows.length, {
    rowsSent: params.rows.length,
    ...params.summary,
  });

  if (params.rows.length === 0) {
    await finalizeImportRun(
      runId,
      { status: "NO_CHANGES", linesInError: 0, raw: { info: "No rows to send" } },
      "SUCCESS"
    );
    return {
      runId,
      flow: "P41",
      mode: params.mode,
      rowsSent: 0,
      importId: null,
      status: "SUCCESS",
      linesInError: 0,
      summary: { status: "NO_CHANGES", linesInError: 0 },
      precheckSummary: params.summary ?? null,
    };
  }

  const client = buildMiraklClient();
  let importResponse: any = null;
  try {
    const conversionFormFields =
      params.aiEnrichmentWanted === true
      ? {
          conversion_type: "AI_CONVERTER",
          "conversion_options.ai_enrichment.status": "ENABLED",
          "conversion_options.ai_rewrite.status": "ENABLED",
        }
      : undefined;

    importResponse = await client.importProducts(
      params.csv,
      { operator_format: true },
      conversionFormFields
    );
  } catch (error: any) {
    const message = error?.message ?? "Mirakl import failed";
    await finalizeImportRun(
      runId,
      { status: "IMPORT_FAILED", linesInError: params.rows.length, raw: { error: message } },
      "FAILED"
    );
    return {
      runId,
      flow: "P41",
      mode: params.mode,
      rowsSent: params.rows.length,
      importId: null,
      status: "FAILED",
      linesInError: params.rows.length,
      summary: { status: "IMPORT_FAILED", linesInError: params.rows.length, raw: { error: message } },
      precheckSummary: params.summary ?? null,
    };
  }

  const importId = extractImportId(importResponse);
  const initialSummary = buildSummary(importResponse);
  await updateImportRun(runId, {
    status: "RUNNING",
    importId,
    summaryJson: initialSummary,
  });

  if (!importId) {
    await finalizeImportRun(runId, initialSummary, "FAILED");
    return {
      runId,
      flow: "P41",
      mode: params.mode,
      rowsSent: params.rows.length,
      importId: null,
      status: "FAILED",
      linesInError: initialSummary.linesInError ?? 0,
      summary: initialSummary,
      precheckSummary: params.summary ?? null,
    };
  }

  const polled = await pollProductImportStatusUntilTerminal({ importId, runId });
  const statusPayload = { summary: polled.summary, status: polled.status, linesInError: polled.linesInError };
  const status = statusPayload.status;
  const linesInError = statusPayload.linesInError;

  let errorReport: MiraklErrorReport | null = null;
  let errorStorage: Awaited<ReturnType<typeof storeErrorReport>> | null = null;
  const failedProviderKeys = new Set<string>();

  if (linesInError > 0) {
    const reportPayload = await downloadErrorReport({ flow: "P41", importId, runId });
    if (reportPayload) {
      errorReport = reportPayload.report;
      errorStorage = reportPayload.storage;
      for (const identifier of errorReport.failedSkus) {
        const providerKey = identifierToProviderKey.get(identifier) ?? gtinToProviderKey.get(identifier);
        if (providerKey) failedProviderKeys.add(providerKey);
      }
    }
  }

  if (["SUCCESS", "PARTIAL"].includes(status)) {
    await upsertProductSyncRows(params.rows, failedProviderKeys);
  }

  await finalizeImportRun(runId, statusPayload.summary, status, errorReport, errorStorage ?? undefined);

  return {
    runId,
    flow: "P41",
    mode: params.mode,
    rowsSent: params.rows.length,
    importId,
    status,
    linesInError,
    summary: statusPayload.summary,
    errorSummary: errorReport?.summary ?? null,
    precheckSummary: params.summary ?? null,
    p51PollTimedOut: polled.timedOut,
  };
}

function filterOffersByCm11Policy(
  offers: DecathlonSyncRow[],
  lookup: ProductStatusLookup,
  exclusions: DecathlonExclusionSummary,
  policy: "LIVE" | "KNOWN" | "OFF"
): { eligible: DecathlonSyncRow[]; blockedCm11Unknown: number; blockedNotLive: number } {
  if (policy === "OFF") {
    return { eligible: offers, blockedCm11Unknown: 0, blockedNotLive: 0 };
  }

  const eligible: DecathlonSyncRow[] = [];
  let blockedCm11Unknown = 0;
  let blockedNotLive = 0;

  for (const row of offers) {
    const status = resolveProductStatus(lookup, row.providerKey, row.gtin);
    if (status.classification === "UNKNOWN") {
      blockedCm11Unknown += 1;
      recordDecathlonExclusion(exclusions, {
        reason: "PRODUCT_NOT_LIVE",
        message: "CM11: no source product status row for this EAN / product identifier",
        fileType: "offers",
        providerKey: row.providerKey,
        supplierVariantId: row.supplierVariantId,
        gtin: row.gtin,
      });
      continue;
    }
    if (policy === "LIVE" && status.classification !== "LIVE") {
      blockedNotLive += 1;
      recordDecathlonExclusion(exclusions, {
        reason: "PRODUCT_NOT_LIVE",
        message: `CM11 status: ${status.raw ?? "NOT_LIVE"}`,
        fileType: "offers",
        providerKey: row.providerKey,
        supplierVariantId: row.supplierVariantId,
        gtin: row.gtin,
      });
      continue;
    }
    eligible.push(row);
  }

  return { eligible, blockedCm11Unknown, blockedNotLive };
}

async function filterOffersBySuccessfulP41(
  offers: DecathlonSyncRow[],
  exclusions: DecathlonExclusionSummary
) {
  if (offers.length === 0) return { eligible: offers, blockedMissingP41: 0 };
  const prismaAny = prisma as any;
  const providerKeys = Array.from(new Set(offers.map((row) => row.providerKey).filter(Boolean)));
  const syncedSet = new Set<string>();
  const chunkSize = 500;
  for (let i = 0; i < providerKeys.length; i += chunkSize) {
    const chunk = providerKeys.slice(i, i + chunkSize);
    const rows: Array<{ providerKey: string }> = await prismaAny.decathlonOfferSync.findMany({
      where: {
        providerKey: { in: chunk },
        lastProductSyncAt: { not: null },
      },
      select: { providerKey: true },
    });
    for (const row of rows) syncedSet.add(String(row.providerKey));
  }
  const eligible: DecathlonSyncRow[] = [];
  let blockedMissingP41 = 0;
  for (const row of offers) {
    if (!syncedSet.has(row.providerKey)) {
      blockedMissingP41 += 1;
      recordDecathlonExclusion(exclusions, {
        reason: "PRODUCT_NOT_LIVE",
        message: "No successful P41 sync recorded yet for this providerKey",
        fileType: "offers",
        providerKey: row.providerKey,
        supplierVariantId: row.supplierVariantId,
        gtin: row.gtin,
      });
      continue;
    }
    eligible.push(row);
  }
  return { eligible, blockedMissingP41 };
}

export async function runOf01Import(params?: {
  limit?: number;
  mode?: MiraklImportMode;
  includeAll?: boolean;
  /** If true, skip P41 upload and send all eligible offer delta rows directly. */
  offersOnly?: boolean;
}) {
  // OF01 should default to full eligible dataset unless a limit is explicitly passed.
  const limit = params?.limit;
  // Ensure product creation runs through P41 endpoint first (unless explicitly disabled).
  const productRun = params?.offersOnly ? null : await runP41Import({ limit, offset: 0, useAiEnrichment: true });
  const delta = await buildDecathlonDeltas({ limit, includeAll: params?.includeAll });
  let eligibleOffers = delta.newOffers;
  let blockedMissingP41 = 0;
  if (!params?.offersOnly) {
    const byP41 = await filterOffersBySuccessfulP41(delta.newOffers, delta.exclusions);
    eligibleOffers = byP41.eligible;
    blockedMissingP41 = byP41.blockedMissingP41;
  }

  const offerCandidates = new Map<string, (typeof delta.candidates)[number]>();
  for (const candidate of delta.candidates) {
    const supplierVariantId = String(candidate?.variant?.supplierVariantId ?? "").trim() || null;
    const offerSku = miraklOfferSku({
      providerKey: candidate.providerKey,
      gtin: candidate.gtin,
      supplierVariantId,
    });
    if (offerSku) offerCandidates.set(offerSku, candidate);
  }
  const rows = eligibleOffers.map((row) => {
    const candidate = offerCandidates.get(row.offerSku) ?? offerCandidates.get(row.providerKey);
    return {
      offerSku: row.offerSku,
      productId: row.gtin,
      productIdType: "EAN",
      price: row.price ?? "0.00",
      quantity: row.stock ?? 0,
      state: DEFAULT_OFFER_STATE,
      logisticClass: candidate ? resolveOfferLogisticClass(candidate) : "",
      leadtimeToShip: candidate ? resolveOfferLeadTimeToShip(candidate) : "",
      minOrderQuantity: candidate ? resolveOfferMinOrderQuantity() : "",
      maxOrderQuantity: candidate ? resolveOfferMaxOrderQuantity() : "",
      discountPrice: candidate ? resolveOfferDiscountPrice() : "",
      discountStartDate: candidate ? resolveOfferDiscountStartDate() : "",
      discountEndDate: candidate ? resolveOfferDiscountEndDate() : "",
      description: candidate ? resolveOfferDescription() : "",
    };
  });

  const { csv } = buildOf01Csv(rows as any);
  const summary = {
    ...delta.summary,
    p41RunId: productRun?.runId ?? null,
    p41Status: productRun?.status ?? null,
    p41LinesInError: productRun?.linesInError ?? null,
    newOffers: eligibleOffers.length,
    offerBlockedMissingP41: blockedMissingP41,
    offersOnly: Boolean(params?.offersOnly),
  };
  const mode: MiraklImportMode =
    params?.mode === "TEST" || DECATHLON_MIRAKL_TEST_MODE ? "TEST" : "REPLACE";
  return runImportFlow({
    flow: "OF01",
    mode,
    rows: eligibleOffers,
    csv,
    withProducts: false,
    summary: {
      delta: summary,
      exclusions: delta.exclusions?.totals ?? null,
      testMode: DECATHLON_MIRAKL_TEST_MODE,
    },
  });
}

export async function runSto01Import(params?: { limit?: number }) {
  const limit = params?.limit ?? (DECATHLON_MIRAKL_TEST_MODE ? DECATHLON_MIRAKL_TEST_LIMIT : undefined);
  const delta = await buildDecathlonDeltas({ limit });
  const rows = delta.stockUpdates.map((row) => ({
    offerSku: row.offerSku,
    quantity: row.stock ?? 0,
    warehouseCode: DECATHLON_MIRAKL_WAREHOUSE_CODE,
  }));
  const { csv } = buildSto01Csv(rows);
  return runImportFlow({
    flow: "STO01",
    mode: DECATHLON_MIRAKL_TEST_MODE ? "TEST" : "NORMAL",
    rows: delta.stockUpdates,
    csv,
    summary: {
      delta: delta.summary,
      exclusions: delta.exclusions?.totals ?? null,
      testMode: DECATHLON_MIRAKL_TEST_MODE,
    },
  });
}

export async function runPri01Import(params?: { limit?: number }) {
  const limit = params?.limit ?? (DECATHLON_MIRAKL_TEST_MODE ? DECATHLON_MIRAKL_TEST_LIMIT : undefined);
  const delta = await buildDecathlonDeltas({ limit });
  const rows = delta.priceUpdates.map((row) => ({
    offerSku: row.offerSku,
    price: row.price ?? "0.00",
  }));
  const { csv } = buildPri01Csv(rows);
  return runImportFlow({
    flow: "PRI01",
    mode: DECATHLON_MIRAKL_TEST_MODE ? "TEST" : "NORMAL",
    rows: delta.priceUpdates,
    csv,
    summary: {
      delta: delta.summary,
      exclusions: delta.exclusions?.totals ?? null,
      testMode: DECATHLON_MIRAKL_TEST_MODE,
    },
  });
}

export async function runP41Import(params?: { limit?: number; offset?: number; useAiEnrichment?: boolean }) {
  const limit = params?.limit ?? (DECATHLON_MIRAKL_TEST_MODE ? DECATHLON_MIRAKL_TEST_LIMIT : undefined);
  const offset = params?.offset ?? 0;
  // Always enabled by default: Mirakl AI_CONVERTER can fill missing required fields.
  const useAiEnrichment = params?.useAiEnrichment ?? true;
  const payload = await prepareProductOnboarding({ limit, offset, useAiEnrichment });
  const rows: ProductSyncRow[] = payload.rows.map((row) => ({
    providerKey: row.providerKey,
    gtin: row.gtin,
    supplierVariantId: row.supplierVariantId,
    productIdentifier: row.providerKey,
  }));
  return runProductImportFlow({
    rows,
    csv: payload.csv,
    mode: DECATHLON_MIRAKL_TEST_MODE ? "TEST" : "NORMAL",
    summary: payload.summary,
    aiEnrichmentWanted: useAiEnrichment,
  });
}

export async function checkImportStatus(params: {
  flow: MiraklImportFlow;
  importId: string;
  runId?: string;
}): Promise<{
  summary: MiraklImportSummary;
  status: MiraklImportStatus;
  linesInError: number;
}> {
  const client = buildMiraklClient();
  let payload: any;
  if (params.flow === "OF01") {
    payload = await client.getOfferImportStatus(params.importId);
  } else if (params.flow === "STO01") {
    payload = await client.getStockImportStatus(params.importId);
  } else if (params.flow === "P41") {
    payload = await client.getProductImportStatus(params.importId);
  } else {
    payload = await client.getPricingImportStatus(params.importId);
  }
  const summary = buildSummary(payload);
  const linesInError = summary.linesInError ?? 0;
  const status = mapImportStatus(summary.status ?? null, linesInError);
  if (params.runId) {
    await updateImportRun(params.runId, {
      status,
      linesInError,
      summaryJson: summary,
      finishedAt: ["SUCCESS", "FAILED", "PARTIAL"].includes(status) ? new Date() : null,
    });
  }
  return { summary, status, linesInError };
}

/**
 * P51 (GET /api/products/imports/{import_id}): poll until terminal status or max wait.
 * AI_CONVERTER flows often report TRANSFORMATION_WAITING / RUNNING for a long time.
 */
async function pollProductImportStatusUntilTerminal(params: {
  importId: string;
  runId: string;
}): Promise<{
  summary: MiraklImportSummary;
  status: MiraklImportStatus;
  linesInError: number;
  timedOut: boolean;
}> {
  const deadline = Date.now() + DECATHLON_MIRAKL_P41_POLL_MAX_MS;
  let last = await checkImportStatus({ flow: "P41", importId: params.importId, runId: params.runId });
  while (last.status === "RUNNING" && Date.now() < deadline) {
    await sleep(DECATHLON_MIRAKL_P41_POLL_INTERVAL_MS);
    last = await checkImportStatus({ flow: "P41", importId: params.importId, runId: params.runId });
  }
  return { ...last, timedOut: last.status === "RUNNING" };
}

export async function refreshImportStatus(params: {
  flow: MiraklImportFlow;
  importId: string;
  runId: string;
}): Promise<{
  summary: MiraklImportSummary;
  status: MiraklImportStatus;
  linesInError: number;
  errorSummary?: MiraklErrorReport["summary"] | null;
}> {
  const statusPayload = await checkImportStatus({
    flow: params.flow,
    importId: params.importId,
    runId: params.runId,
  });
  let errorReport: MiraklErrorReport | null = null;
  let errorStorage: Awaited<ReturnType<typeof storeErrorReport>> | null = null;

  if (statusPayload.linesInError > 0) {
    const reportPayload = await downloadErrorReport({
      flow: params.flow,
      importId: params.importId,
      runId: params.runId,
    });
    if (reportPayload) {
      errorReport = reportPayload.report;
      errorStorage = reportPayload.storage;
    }
  }

  if (errorReport || errorStorage) {
    await finalizeImportRun(params.runId, statusPayload.summary, statusPayload.status, errorReport, errorStorage ?? undefined);
  }

  return {
    ...statusPayload,
    errorSummary: errorReport?.summary ?? null,
  };
}

export async function downloadErrorReport(params: {
  flow: MiraklImportFlow;
  importId: string;
  runId: string;
}): Promise<{
  report: MiraklErrorReport;
  storage: Awaited<ReturnType<typeof storeErrorReport>>;
} | null> {
  const client = buildMiraklClient();
  let payload: { buffer: Buffer; contentType: string | null };
  try {
    if (params.flow === "OF01") {
      payload = await client.downloadOfferErrorReport(params.importId);
    } else if (params.flow === "STO01") {
      payload = await client.downloadStockErrorReport(params.importId);
    } else if (params.flow === "P41") {
      payload = await client.downloadProductErrorReport(params.importId);
    } else {
      payload = await client.downloadPricingErrorReport(params.importId);
    }
  } catch (error: any) {
    const message = String(error?.message ?? "");
    if (message.includes("404") && message.toLowerCase().includes("no error report")) {
      return null;
    }
    throw error;
  }
  const csvText = payload.buffer.toString("utf8");
  const report = parseErrorReport(csvText);
  const storage = await storeErrorReport(params.runId, csvText);
  return { report, storage };
}

export async function getLatestImportRuns(limit = 20) {
  const prismaAny = prisma as any;
  const runs = await prismaAny.decathlonImportRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
  });
  return runs;
}

export const __test__ = {
  detectDelimiter,
  parseDelimitedCsv,
  parseErrorReport,
  mapImportStatus,
  filterOffersByCm11Policy,
};
