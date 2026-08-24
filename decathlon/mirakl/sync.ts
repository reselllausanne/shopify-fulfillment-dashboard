import { prisma } from "@/app/lib/prisma";
import type { MiraklImportFlow, MiraklImportMode } from "./types";
import {
  refreshImportStatus,
  runOf01Import,
  runP41Import,
  runPhysicalLiquidationOf01Import,
  runPhysicalLiquidationP41Import,
  runPri01Import,
  runSto01Import,
} from "./imports";

function decathlonSalesSyncBlocked(flow: MiraklImportFlow) {
  return {
    ok: true,
    skipped: true,
    reason: "decathlon_sales_permanently_disabled",
    flow,
    importId: null,
    rowCount: 0,
  };
}

function shouldBlockDecathlonSalesSync(): boolean {
  // Hard business lock: Decathlon sell lane disabled. Keep blocked even if env toggles.
  return true;
}

export async function runDecathlonOfferSync(params?: {
  limit?: number;
  mode?: MiraklImportMode;
  includeAll?: boolean;
  providerKeys?: string[];
}) {
  if (shouldBlockDecathlonSalesSync()) return decathlonSalesSyncBlocked("OF01");
  return runOf01Import({
    limit: params?.limit,
    mode: params?.mode,
    includeAll: params?.includeAll,
    providerKeys: params?.providerKeys,
  });
}

/** Daily: physical location stock only, list = liquidation sell / 0.75. NORMAL mode. */
export async function runDecathlonPhysicalLiquidationOfferSync(params?: {
  limit?: number;
  mode?: MiraklImportMode;
}) {
  if (shouldBlockDecathlonSalesSync()) return decathlonSalesSyncBlocked("OF01");
  return runPhysicalLiquidationOf01Import({
    limit: params?.limit,
    mode: params?.mode,
  });
}

/** P41 for Bussigny + Lab + Rare (COLD BIEN) in-stock GTINs only. */
export async function runDecathlonPhysicalLiquidationProductSync(params?: {
  limit?: number;
  useAiEnrichment?: boolean;
}) {
  if (shouldBlockDecathlonSalesSync()) return decathlonSalesSyncBlocked("P41");
  return runPhysicalLiquidationP41Import({
    limit: params?.limit,
    useAiEnrichment: params?.useAiEnrichment,
  });
}

export async function runDecathlonOfferOnlySync(params?: {
  limit?: number;
  mode?: MiraklImportMode;
  includeAll?: boolean;
  providerKeys?: string[];
}) {
  if (shouldBlockDecathlonSalesSync()) return decathlonSalesSyncBlocked("OF01");
  return runOf01Import({
    limit: params?.limit,
    mode: params?.mode,
    includeAll: params?.includeAll,
    providerKeys: params?.providerKeys,
    offersOnly: true,
  });
}

export async function runDecathlonStockSync(params?: {
  limit?: number;
  providerKeys?: string[];
  /** Always include these offer SKUs in STO01 at current stock (full sync + sold-out THE). */
  ensureProviderKeys?: string[];
}) {
  if (shouldBlockDecathlonSalesSync()) return decathlonSalesSyncBlocked("STO01");
  return runSto01Import({
    limit: params?.limit,
    providerKeys: params?.providerKeys,
    ensureProviderKeys: params?.ensureProviderKeys,
  });
}

export async function runDecathlonPriceSync(params?: { limit?: number }) {
  if (shouldBlockDecathlonSalesSync()) return decathlonSalesSyncBlocked("PRI01");
  return runPri01Import({ limit: params?.limit });
}

export async function runDecathlonProductSync(params?: {
  limit?: number;
  offset?: number;
  useAiEnrichment?: boolean;
}) {
  if (shouldBlockDecathlonSalesSync()) return decathlonSalesSyncBlocked("P41");
  return runP41Import({ limit: params?.limit, offset: params?.offset, useAiEnrichment: params?.useAiEnrichment });
}

export async function checkLatestImportStatus(flow: MiraklImportFlow) {
  const prismaAny = prisma as any;
  const latest = await prismaAny.decathlonImportRun.findFirst({
    where: { flow, importId: { not: null } },
    orderBy: { startedAt: "desc" },
  });
  if (!latest?.importId) {
    return { ok: false, error: "No importId found for latest run." };
  }
  const status = await refreshImportStatus({
    flow,
    importId: latest.importId,
    runId: latest.runId,
  });
  return { ok: true, runId: latest.runId, importId: latest.importId, ...status };
}
