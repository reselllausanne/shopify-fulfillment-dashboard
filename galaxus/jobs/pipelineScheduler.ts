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
import { runStxPriceStockRefresh } from "@/galaxus/jobs/stxSync";
import { runStxAwbResync } from "@/galaxus/jobs/stxAwbResync";
import { runImageSync } from "@/galaxus/jobs/imageSync";

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
    masterRefresh: TickJobStatus;
    stxDailySync: TickJobStatus;
    stxAwbResync: TickJobStatus;
    imageSync: TickJobStatus;
    enrichNew: TickJobStatus;
    reenrichUnmatched: TickJobStatus;
  };
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * ONE_HOUR_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const TWO_DAYS_MS = 2 * 24 * ONE_HOUR_MS;
const TEN_HOURS_MS = 10 * ONE_HOUR_MS;

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

async function getLastJob(jobName: string) {
  return (prisma as any).galaxusJobRun.findFirst({
    where: { jobName },
    orderBy: { finishedAt: "desc" },
    select: { id: true, jobName: true, startedAt: true, finishedAt: true, success: true },
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

function nextServerMidnightAfter(base: Date): Date {
  const next = new Date(base);
  next.setHours(24, 0, 0, 0);
  return next;
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

async function runAllFeedsUpload(origin: string) {
  const res = await fetch(`${origin}/api/galaxus/feeds/upload?type=all`, {
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

async function fetchNewCandidatesSince(
  since: Date,
  limit: number,
  offset = 0
): Promise<string[]> {
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
      ORDER BY sv."createdAt" ASC, sv."supplierVariantId" ASC
      LIMIT ${limit}
      OFFSET ${offset}
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
  const lastEdi = await getLastJob("edi-in");
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
  const lastSync = await getLastJob("pipeline-offer-stock");
  const nextSyncAt = nextFrom(lastSync?.finishedAt ? new Date(lastSync.finishedAt) : null, TWO_HOURS_MS);
  const syncDue = force ? shouldConsider("sync-offer-stock") : shouldConsider("sync-offer-stock") && isDue(nextSyncAt, nowMs);
  let syncOfferStock: TickJobStatus = { due: false, ran: false, skipped: "not_due", nextAt: toIso(nextSyncAt) };
  if (shouldConsider("sync-offer-stock") && syncDue) {
    const locked = await withAdvisoryLock("galaxus:pipeline:offer-stock", async () =>
      runJob("pipeline-offer-stock", async () => {
        const supplier = await runJob("pipeline-supplier-delta", async () => {
          const gld = await runStockPriceSync({ limit: undefined, offset: 0 });
          const trm = await runTrmStockSync({ limit: undefined, offset: 0, enrichMissingGtin: false });
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

  // Master refresh: every 10h (supplier full + partner + upload master/stock/offer together).
  const lastMaster = await getLastJob("pipeline-master");
  const nextMasterAt = nextFrom(lastMaster?.finishedAt ? new Date(lastMaster.finishedAt) : null, TEN_HOURS_MS);
  const masterDue = force ? shouldConsider("master") : shouldConsider("master") && isDue(nextMasterAt, nowMs);
  let masterRefresh: TickJobStatus = { due: false, ran: false, skipped: "not_due", nextAt: toIso(nextMasterAt) };
  if (shouldConsider("master") && masterDue) {
    const locked = await withAdvisoryLock("galaxus:pipeline:master", async () =>
      runJob("pipeline-master", async () => {
        const supplier = await runJob("pipeline-supplier-full", async () => {
          // Use the existing supplier sync API route to ensure we mirror prod behavior.
          const res = await fetch(`${origin}/api/galaxus/supplier/sync?all=1&mode=full`, {
            method: "POST",
            cache: "no-store",
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data?.ok) throw new Error(data?.error ?? `Supplier full sync failed (HTTP ${res.status})`);
          return data;
        });
        if (!supplier.success) throw new Error(supplier.error ?? "Supplier full sync failed");

        const partner = await runJob("pipeline-partner-sync", async () => runPartnerSyncAll());
        if (!partner.success) throw new Error(partner.error ?? "Partner sync failed");

        const upload = await runJob("pipeline-upload-all", async () => runAllFeedsUpload(origin));
        if (!upload.success) throw new Error(upload.error ?? "Feed upload (all) failed");

        return { supplier: supplier.result, partner: partner.result, upload: upload.result };
      })
    );
    masterRefresh =
      locked.locked
        ? { due: true, ran: true, nextAt: toIso(nextFrom(new Date(), TEN_HOURS_MS)), result: locked.result }
        : { due: true, ran: false, skipped: "locked", nextAt: toIso(nextMasterAt) };
  }

  // STX daily refresh at server midnight: update price/stock only for STX variants.
  const lastStx = await getLastJob("pipeline-stx-price-stock-nightly");
  const nextStxAt = lastStx?.finishedAt
    ? nextServerMidnightAfter(new Date(lastStx.finishedAt))
    : nextServerMidnightAfter(now);
  const stxDue = force ? shouldConsider("stx-sync") : shouldConsider("stx-sync") && isDue(nextStxAt, nowMs);
  let stxDailySync: TickJobStatus = { due: false, ran: false, skipped: "not_due", nextAt: toIso(nextStxAt) };
  if (shouldConsider("stx-sync") && stxDue) {
    const locked = await withAdvisoryLock("galaxus:pipeline:stx-price-stock-nightly", async () =>
      runJob("pipeline-stx-price-stock-nightly", async () => runStxPriceStockRefresh())
    );
    stxDailySync =
      locked.locked
        ? { due: true, ran: true, nextAt: toIso(nextServerMidnightAfter(new Date())), result: locked.result }
        : { due: true, ran: false, skipped: "locked", nextAt: toIso(nextStxAt) };
  }

  // STX AWB re-sync (rows linked without AWB for >=48h)
  const lastStxAwb = await getLastJob("pipeline-stx-awb-resync");
  const nextStxAwbAt = nextFrom(lastStxAwb?.finishedAt ? new Date(lastStxAwb.finishedAt) : null, ONE_DAY_MS);
  const stxAwbDue =
    force
      ? shouldConsider("stx-awb-resync")
      : shouldConsider("stx-awb-resync") && isDue(nextStxAwbAt, nowMs);
  let stxAwbResync: TickJobStatus = {
    due: false,
    ran: false,
    skipped: "not_due",
    nextAt: toIso(nextStxAwbAt),
  };
  if (shouldConsider("stx-awb-resync") && stxAwbDue) {
    const locked = await withAdvisoryLock("galaxus:pipeline:stx-awb-resync", async () =>
      runJob("pipeline-stx-awb-resync", async () => runStxAwbResync())
    );
    stxAwbResync =
      locked.locked
        ? { due: true, ran: true, nextAt: toIso(nextFrom(new Date(), ONE_DAY_MS)), result: locked.result }
        : { due: true, ran: false, skipped: "locked", nextAt: toIso(nextStxAwbAt) };
  }

  // Hosted image sync (hourly)
  const lastImage = await getLastJob("pipeline-image-sync");
  const nextImageAt = nextFrom(lastImage?.finishedAt ? new Date(lastImage.finishedAt) : null, ONE_HOUR_MS);
  const imageDue =
    force
      ? shouldConsider("image-sync")
      : shouldConsider("image-sync") && isDue(nextImageAt, nowMs);
  let imageSync: TickJobStatus = { due: false, ran: false, skipped: "not_due", nextAt: toIso(nextImageAt) };
  if (shouldConsider("image-sync") && imageDue) {
    const locked = await withAdvisoryLock("galaxus:pipeline:image-sync", async () =>
      runJob("pipeline-image-sync", async () => runImageSync({ limit: 50, concurrency: 5 }))
    );
    imageSync =
      locked.locked
        ? { due: true, ran: true, nextAt: toIso(nextFrom(new Date(), ONE_HOUR_MS)), result: locked.result }
        : { due: true, ran: false, skipped: "locked", nextAt: toIso(nextImageAt) };
  }

  // Enrich NEW: 1h after the last successful 2h sync finished, and only for newly created rows.
  const lastSyncAfter = await getLastSuccessfulJob("pipeline-offer-stock");
  const syncFinishedAt = lastSyncAfter?.finishedAt ? new Date(lastSyncAfter.finishedAt) : null;
  const enrichScheduledAt = syncFinishedAt ? new Date(syncFinishedAt.getTime() + ONE_HOUR_MS) : null;
  const lastEnrichNew = await getLastJob("kickdb-enrich-new");
  const ranEnrichNewForCycle = Boolean(
    enrichScheduledAt &&
      lastEnrichNew?.startedAt &&
      new Date(lastEnrichNew.startedAt).getTime() >= enrichScheduledAt.getTime()
  );
  const nextEnrichNewAt =
    syncFinishedAt && enrichScheduledAt
      ? ranEnrichNewForCycle
        ? new Date(syncFinishedAt.getTime() + TWO_HOURS_MS + ONE_HOUR_MS) // next 2h cycle + 1h offset
        : enrichScheduledAt
      : null;
  const enrichNewDue = Boolean(
    enrichScheduledAt &&
      (force ? shouldConsider("enrich-new") : nowMs >= enrichScheduledAt.getTime()) &&
      !ranEnrichNewForCycle
  );
  let enrichNew: TickJobStatus = {
    due: false,
    ran: false,
    skipped: syncFinishedAt ? "not_due" : "missing_dependency",
    nextAt: toIso(nextEnrichNewAt),
  };
  if (shouldConsider("enrich-new") && enrichNewDue && syncFinishedAt && lastSyncAfter?.startedAt) {
    const since = new Date(lastSyncAfter.startedAt);
    const locked = await withAdvisoryLock("galaxus:kickdb:enrich-new", async () =>
      runJob("kickdb-enrich-new", async () => {
        const candidatePageSize = 500;
        const maxCandidates = 5000;
        const concurrency = 2;
        const candidates: string[] = [];
        let offset = 0;
        // Scan new rows in pages so bursty syncs don't leave untouched "new" rows.
        // Hard cap keeps calls bounded in pathological cases.
        while (candidates.length < maxCandidates) {
          const page = await fetchNewCandidatesSince(
            since,
            Math.min(candidatePageSize, maxCandidates - candidates.length),
            offset
          );
          if (page.length === 0) break;
          candidates.push(...page);
          if (page.length < candidatePageSize) break;
          offset += candidatePageSize;
        }
        const res = await runKickdbEnrichCandidates({
          supplierVariantIds: candidates,
          concurrency,
          force: true,
        });
        return {
          since: since.toISOString(),
          candidatePageSize,
          maxCandidates,
          truncated: candidates.length >= maxCandidates,
          concurrency,
          ...res,
        };
      })
    );
    enrichNew =
      locked.locked
        ? { due: true, ran: true, nextAt: toIso(enrichScheduledAt), result: locked.result }
        : { due: true, ran: false, skipped: "locked", nextAt: toIso(enrichScheduledAt) };
  }

  // Re-enrich UNMATCHED: every 2 days, for rows still unmatched (no GTIN/mapping).
  const lastRe = await getLastJob("kickdb-reenrich-unmatched");
  const nextReAt = nextFrom(lastRe?.finishedAt ? new Date(lastRe.finishedAt) : null, TWO_DAYS_MS);
  const reDue = force ? shouldConsider("reenrich-unmatched") : shouldConsider("reenrich-unmatched") && isDue(nextReAt, nowMs);
  let reenrichUnmatched: TickJobStatus = { due: false, ran: false, skipped: "not_due", nextAt: toIso(nextReAt) };
  if (shouldConsider("reenrich-unmatched") && reDue) {
    const locked = await withAdvisoryLock("galaxus:kickdb:reenrich-unmatched", async () =>
      runJob("kickdb-reenrich-unmatched", async () => {
        const candidateLimit = 200;
        const concurrency = 2;
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
    jobs: {
      ediIn,
      syncOfferStock,
      masterRefresh,
      stxDailySync,
      stxAwbResync,
      imageSync,
      enrichNew,
      reenrichUnmatched,
    },
  };
}

