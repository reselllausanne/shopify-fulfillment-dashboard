import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { runJob } from "@/galaxus/jobs/jobRunner";
import { withAdvisoryLock } from "@/galaxus/jobs/advisoryLock";
import { pollIncomingEdi } from "@/galaxus/edi/service";
import { runStockPriceSync } from "@/galaxus/jobs/stockSync";
import { runTrmStockSync } from "@/galaxus/jobs/trmSync";
import { runPartnerSync } from "@/galaxus/jobs/partnerSync";
import { createLimiter } from "@/galaxus/jobs/bulkSql";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";

type TickJobStatus =
  | { due: false; ran: false; skipped: "not_due" | "missing_dependency"; nextAt: string | null }
  | { due: true; ran: false; skipped: "locked"; nextAt: string | null }
  | { due: true; ran: true; nextAt: string | null; result: any };

type PipelineTickResult = {
  ok: boolean;
  now: string;
  origin: string;
  jobs: {
    ediIn: TickJobStatus;
    syncOfferStock: TickJobStatus;
    enrichNew: TickJobStatus;
    reenrichUnmatched: TickJobStatus;
  };
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * ONE_HOUR_MS;
const TWO_DAYS_MS = 2 * 24 * ONE_HOUR_MS;

function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

async function getLastSuccessfulJob(jobName: string) {
  return (prisma as any).galaxusJobRun.findFirst({
    where: { jobName, success: true },
    orderBy: { finishedAt: "desc" },
    select: { id: true, jobName: true, startedAt: true, finishedAt: true },
  });
}

function nextFrom(lastFinishedAt: Date | null, intervalMs: number): Date | null {
  if (!lastFinishedAt) return new Date(0);
  return new Date(lastFinishedAt.getTime() + intervalMs);
}

function isDue(nextAt: Date | null, nowMs: number): boolean {
  if (!nextAt) return false;
  return nowMs >= nextAt.getTime();
}

async function runOfferStockUpload(origin: string) {
  const res = await fetch(`${origin}/api/galaxus/feeds/upload?type=offer-stock`, {
    method: "POST",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error ?? `Upload failed (HTTP ${res.status})`);
  }
  return data;
}

async function runPartnerSyncAll() {
  const batchSize = 1000;
  let offset = 0;
  let lastProcessed = 0;
  let totals = {
    processed: 0,
    created: 0,
    updated: 0,
    skippedInvalid: 0,
    removedZeroStock: 0,
    mappingInserted: 0,
    mappingUpdated: 0,
  };

  do {
    const res = await runPartnerSync({ limit: batchSize, offset });
    lastProcessed = res.processed ?? 0;
    totals = {
      processed: totals.processed + (res.processed ?? 0),
      created: totals.created + (res.created ?? 0),
      updated: totals.updated + (res.updated ?? 0),
      skippedInvalid: totals.skippedInvalid + (res.skippedInvalid ?? 0),
      removedZeroStock: totals.removedZeroStock + (res.removedZeroStock ?? 0),
      mappingInserted: totals.mappingInserted + (res.mappingInserted ?? 0),
      mappingUpdated: totals.mappingUpdated + (res.mappingUpdated ?? 0),
    };
    offset += batchSize;
  } while (lastProcessed === batchSize);

  return totals;
}

async function runKickdbEnrichCandidates(params: {
  supplierVariantIds: string[];
  concurrency: number;
  force: boolean;
}) {
  const { supplierVariantIds, concurrency, force } = params;
  const startedAt = Date.now();
  const limit = createLimiter(concurrency);

  let processed = 0;
  let enrichedRows = 0;
  let errors = 0;

  await Promise.all(
    supplierVariantIds.map((supplierVariantId) =>
      limit(async () => {
        processed += 1;
        try {
          const { results } = await runKickdbEnrich({ supplierVariantId, force });
          enrichedRows += results.length;
        } catch {
          errors += 1;
        }
      })
    )
  );

  const durationMs = Date.now() - startedAt;
  return { candidates: supplierVariantIds.length, processed, enrichedRows, errors, durationMs };
}

async function fetchNewCandidatesSince(since: Date, limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ supplierVariantId: string }>>(
    Prisma.sql`
      SELECT sv."supplierVariantId"
      FROM "public"."SupplierVariant" sv
      LEFT JOIN "public"."VariantMapping" vm
        ON vm."supplierVariantId" = sv."supplierVariantId"
      WHERE sv."createdAt" >= ${since}
        AND (
          vm."supplierVariantId" IS NULL
          OR vm."gtin" IS NULL
          OR vm."status" IN ('PENDING_GTIN','AMBIGUOUS_GTIN','NOT_FOUND')
        )
      ORDER BY sv."createdAt" DESC, sv."updatedAt" DESC
      LIMIT ${limit}
    `
  );
  return (rows ?? []).map((r) => r.supplierVariantId);
}

async function fetchUnmatchedCandidates(limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ supplierVariantId: string }>>(
    Prisma.sql`
      SELECT sv."supplierVariantId"
      FROM "public"."SupplierVariant" sv
      LEFT JOIN "public"."VariantMapping" vm
        ON vm."supplierVariantId" = sv."supplierVariantId"
      WHERE vm."supplierVariantId" IS NULL
         OR vm."gtin" IS NULL
         OR vm."status" IN ('PENDING_GTIN','AMBIGUOUS_GTIN','NOT_FOUND')
      ORDER BY sv."updatedAt" DESC, sv."createdAt" DESC
      LIMIT ${limit}
    `
  );
  return (rows ?? []).map((r) => r.supplierVariantId);
}

export async function runGalaxusPipelineTick(
  origin: string,
  options?: { onlyJobs?: string[]; force?: boolean }
): Promise<PipelineTickResult> {
  const now = new Date();
  const nowMs = now.getTime();
  const only = new Set((options?.onlyJobs ?? []).map((s) => s.trim()).filter(Boolean));
  const isOnlyMode = only.size > 0;
  const force = Boolean(options?.force);
  const shouldConsider = (key: string) => (isOnlyMode ? only.has(key) : true);

  // EDI IN (hourly)
  const lastEdi = await getLastSuccessfulJob("edi-in");
  const nextEdiAt = nextFrom(lastEdi?.finishedAt ? new Date(lastEdi.finishedAt) : null, ONE_HOUR_MS);
  const ediDue = force ? shouldConsider("edi-in") : shouldConsider("edi-in") && isDue(nextEdiAt, nowMs);
  let ediIn: TickJobStatus = { due: false, ran: false, skipped: "not_due", nextAt: toIso(nextEdiAt) };
  if (shouldConsider("edi-in") && ediDue) {
    const locked = await withAdvisoryLock("galaxus:edi-in", async () =>
      runJob("edi-in", async () => pollIncomingEdi())
    );
    ediIn =
      locked.locked
        ? { due: true, ran: true, nextAt: toIso(nextFrom(new Date(), ONE_HOUR_MS)), result: locked.result }
        : { due: true, ran: false, skipped: "locked", nextAt: toIso(nextEdiAt) };
  }

  // 2h supplier+partner delta sync + offer/stock upload (single locked pipeline job)
  const lastSync = await getLastSuccessfulJob("pipeline-offer-stock");
  const nextSyncAt = nextFrom(lastSync?.finishedAt ? new Date(lastSync.finishedAt) : null, TWO_HOURS_MS);
  const syncDue = force ? shouldConsider("sync-offer-stock") : shouldConsider("sync-offer-stock") && isDue(nextSyncAt, nowMs);
  let syncOfferStock: TickJobStatus = { due: false, ran: false, skipped: "not_due", nextAt: toIso(nextSyncAt) };
  if (shouldConsider("sync-offer-stock") && syncDue) {
    const locked = await withAdvisoryLock("galaxus:pipeline:offer-stock", async () =>
      runJob("pipeline-offer-stock", async () => {
        const supplier = await runJob("pipeline-supplier-delta", async () => {
          const [gld, trm] = await Promise.all([
            runStockPriceSync({ limit: undefined, offset: 0 }),
            runTrmStockSync({ limit: undefined, offset: 0, enrichMissingGtin: false }),
          ]);
          return { gld, trm };
        });
        if (!supplier.success) {
          throw new Error(supplier.error ?? "Supplier delta sync failed");
        }

        const partner = await runJob("pipeline-partner-sync", async () => runPartnerSyncAll());
        if (!partner.success) {
          throw new Error(partner.error ?? "Partner sync failed");
        }

        const upload = await runJob("pipeline-upload-offer-stock", async () => runOfferStockUpload(origin));
        if (!upload.success) {
          throw new Error(upload.error ?? "Offer/stock upload failed");
        }

        return { supplier: supplier.result, partner: partner.result, upload: upload.result };
      })
    );
    syncOfferStock =
      locked.locked
        ? { due: true, ran: true, nextAt: toIso(nextFrom(new Date(), TWO_HOURS_MS)), result: locked.result }
        : { due: true, ran: false, skipped: "locked", nextAt: toIso(nextSyncAt) };
  }

  // Enrich NEW: 1h after the last successful 2h sync finished, and only for newly created rows.
  const lastSyncAfter = await getLastSuccessfulJob("pipeline-offer-stock");
  const syncFinishedAt = lastSyncAfter?.finishedAt ? new Date(lastSyncAfter.finishedAt) : null;
  const enrichScheduledAt = syncFinishedAt ? new Date(syncFinishedAt.getTime() + ONE_HOUR_MS) : null;
  const lastEnrichNew = await getLastSuccessfulJob("kickdb-enrich-new");
  const enrichNewDue = Boolean(
    enrichScheduledAt &&
      (force ? shouldConsider("enrich-new") : nowMs >= enrichScheduledAt.getTime()) &&
      (!lastEnrichNew?.startedAt || new Date(lastEnrichNew.startedAt).getTime() < enrichScheduledAt.getTime())
  );
  let enrichNew: TickJobStatus = {
    due: false,
    ran: false,
    skipped: syncFinishedAt ? "not_due" : "missing_dependency",
    nextAt: toIso(enrichScheduledAt),
  };
  if (shouldConsider("enrich-new") && enrichNewDue && syncFinishedAt && lastSyncAfter?.startedAt) {
    const since = new Date(lastSyncAfter.startedAt);
    const locked = await withAdvisoryLock("galaxus:kickdb:enrich-new", async () =>
      runJob("kickdb-enrich-new", async () => {
        const candidateLimit = 500;
        const concurrency = 4;
        const candidates = await fetchNewCandidatesSince(since, candidateLimit);
        const res = await runKickdbEnrichCandidates({
          supplierVariantIds: candidates,
          concurrency,
          force: true,
        });
        return { since: since.toISOString(), candidateLimit, concurrency, ...res };
      })
    );
    enrichNew =
      locked.locked
        ? { due: true, ran: true, nextAt: toIso(enrichScheduledAt), result: locked.result }
        : { due: true, ran: false, skipped: "locked", nextAt: toIso(enrichScheduledAt) };
  }

  // Re-enrich UNMATCHED: every 2 days, for rows still unmatched (no GTIN/mapping).
  const lastRe = await getLastSuccessfulJob("kickdb-reenrich-unmatched");
  const nextReAt = nextFrom(lastRe?.finishedAt ? new Date(lastRe.finishedAt) : null, TWO_DAYS_MS);
  const reDue = force ? shouldConsider("reenrich-unmatched") : shouldConsider("reenrich-unmatched") && isDue(nextReAt, nowMs);
  let reenrichUnmatched: TickJobStatus = { due: false, ran: false, skipped: "not_due", nextAt: toIso(nextReAt) };
  if (shouldConsider("reenrich-unmatched") && reDue) {
    const locked = await withAdvisoryLock("galaxus:kickdb:reenrich-unmatched", async () =>
      runJob("kickdb-reenrich-unmatched", async () => {
        const candidateLimit = 200;
        const concurrency = 3;
        const candidates = await fetchUnmatchedCandidates(candidateLimit);
        const res = await runKickdbEnrichCandidates({
          supplierVariantIds: candidates,
          concurrency,
          force: false,
        });
        return { candidateLimit, concurrency, ...res };
      })
    );
    reenrichUnmatched =
      locked.locked
        ? { due: true, ran: true, nextAt: toIso(nextFrom(new Date(), TWO_DAYS_MS)), result: locked.result }
        : { due: true, ran: false, skipped: "locked", nextAt: toIso(nextReAt) };
  }

  return {
    ok: true,
    now: now.toISOString(),
    origin,
    jobs: { ediIn, syncOfferStock, enrichNew, reenrichUnmatched },
  };
}

