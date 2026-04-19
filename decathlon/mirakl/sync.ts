import { prisma } from "@/app/lib/prisma";
import type { MiraklImportFlow, MiraklImportMode } from "./types";
import { refreshImportStatus, runOf01Import, runP41Import, runPri01Import, runSto01Import } from "./imports";

export async function runDecathlonOfferSync(params?: {
  limit?: number;
  mode?: MiraklImportMode;
  includeAll?: boolean;
}) {
  return runOf01Import({ limit: params?.limit, mode: params?.mode, includeAll: params?.includeAll });
}

export async function runDecathlonOfferOnlySync(params?: {
  limit?: number;
  mode?: MiraklImportMode;
  includeAll?: boolean;
}) {
  return runOf01Import({
    limit: params?.limit,
    mode: params?.mode,
    includeAll: params?.includeAll,
    offersOnly: true,
  });
}

export async function runDecathlonStockSync(params?: { limit?: number }) {
  return runSto01Import({ limit: params?.limit });
}

export async function runDecathlonPriceSync(params?: { limit?: number }) {
  return runPri01Import({ limit: params?.limit });
}

export async function runDecathlonProductSync(params?: {
  limit?: number;
  offset?: number;
  useAiEnrichment?: boolean;
}) {
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
