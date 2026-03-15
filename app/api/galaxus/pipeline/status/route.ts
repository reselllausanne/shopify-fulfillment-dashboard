import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_CACHE_TTL_MS = 15000;
let cachedStatusPayload: any | null = null;
let cachedStatusAt = 0;

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * ONE_HOUR_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const TWO_DAYS_MS = 2 * 24 * ONE_HOUR_MS;
const TEN_HOURS_MS = 10 * ONE_HOUR_MS;

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function nextFrom(lastFinishedAt: Date | null, intervalMs: number) {
  if (!lastFinishedAt) return new Date(0);
  return new Date(lastFinishedAt.getTime() + intervalMs);
}

function toResult(run: any | null) {
  if (!run) return null;
  return {
    ok: Boolean(run.success),
    status: run.success ? 200 : 500,
    error: run.errorMessage ?? undefined,
    resultJson: run.resultJson ?? undefined,
  };
}

export async function GET() {
  try {
    if (cachedStatusPayload && Date.now() - cachedStatusAt < STATUS_CACHE_TTL_MS) {
      return NextResponse.json({ ok: true, status: cachedStatusPayload, cached: true });
    }
    const prismaAny = prisma as any;
    const jobNames = [
      "edi-in",
      "pipeline-offer-stock",
      "pipeline-master",
      "pipeline-stx-price-stock-nightly",
      "pipeline-stx-sync",
      "pipeline-stx-awb-resync",
      "kickdb-enrich-new",
      "kickdb-reenrich-unmatched",
      "pipeline-partner-sync",
    ];
    const runs = await prismaAny.galaxusJobRun.findMany({
      where: { jobName: { in: jobNames } },
      orderBy: { finishedAt: "desc" },
      select: {
        jobName: true,
        finishedAt: true,
        success: true,
        errorMessage: true,
        resultJson: true,
      },
    });
    const latestByJob = new Map<string, any>();
    for (const run of runs) {
      const key = String(run?.jobName ?? "");
      if (!key || latestByJob.has(key)) continue;
      latestByJob.set(key, run);
    }

    const [ediIn, offerStock, master, stxSync, stxAwbResync, enrichNew, reenrich, partnerSync] = [
      latestByJob.get("edi-in") ?? null,
      latestByJob.get("pipeline-offer-stock") ?? null,
      latestByJob.get("pipeline-master") ?? null,
      latestByJob.get("pipeline-stx-price-stock-nightly") ?? latestByJob.get("pipeline-stx-sync") ?? null,
      latestByJob.get("pipeline-stx-awb-resync") ?? null,
      latestByJob.get("kickdb-enrich-new") ?? null,
      latestByJob.get("kickdb-reenrich-unmatched") ?? null,
      latestByJob.get("pipeline-partner-sync") ?? null,
    ];

    const manifests = await prismaAny.galaxusExportManifest.findMany({
      where: { exportType: { in: ["master", "offer", "stock", "edi-out"] } },
      orderBy: { createdAt: "desc" },
    });
    const latestManifestByType = new Map<string, any>();
    for (const row of manifests) {
      const key = String(row?.exportType ?? "");
      if (!key || latestManifestByType.has(key)) continue;
      latestManifestByType.set(key, row);
    }
    const lastMasterManifest = latestManifestByType.get("master") ?? null;
    const lastOfferManifest = latestManifestByType.get("offer") ?? null;
    const lastStockManifest = latestManifestByType.get("stock") ?? null;
    const lastEdiManifest = latestManifestByType.get("edi-out") ?? null;

    const payload = {
      running: true,
      startedAt: null,
      lastEdiInRunAt: toIso(ediIn?.finishedAt ?? null),
      lastOfferStockRunAt: toIso(offerStock?.finishedAt ?? null),
      lastMasterRunAt: toIso(master?.finishedAt ?? null),
      lastStxSyncRunAt: toIso(stxSync?.finishedAt ?? null),
      lastStxAwbResyncRunAt: toIso(stxAwbResync?.finishedAt ?? null),
      lastPartnerSyncRunAt: toIso(partnerSync?.finishedAt ?? null),
      lastEdiInResult: toResult(ediIn),
      lastOfferStockResult: toResult(offerStock),
      lastMasterResult: toResult(master),
      lastStxSyncResult: toResult(stxSync),
      lastStxAwbResyncResult: toResult(stxAwbResync),
      lastPartnerSyncResult: toResult(partnerSync),
      lastEnrichNewRunAt: toIso(enrichNew?.finishedAt ?? null),
      lastEnrichNewResult: toResult(enrichNew),
      lastReenrichUnmatchedRunAt: toIso(reenrich?.finishedAt ?? null),
      lastReenrichUnmatchedResult: toResult(reenrich),
      ediInIntervalMs: ONE_HOUR_MS,
      offerStockIntervalMs: TWO_HOURS_MS,
      masterIntervalMs: TEN_HOURS_MS,
      stxSyncIntervalMs: ONE_DAY_MS,
      stxAwbResyncIntervalMs: ONE_DAY_MS,
      reenrichIntervalMs: TWO_DAYS_MS,
      nextEdiInAt: toIso(nextFrom(ediIn?.finishedAt ? new Date(ediIn.finishedAt) : null, ONE_HOUR_MS)),
      nextOfferStockAt: toIso(nextFrom(offerStock?.finishedAt ? new Date(offerStock.finishedAt) : null, TWO_HOURS_MS)),
      nextMasterAt: toIso(nextFrom(master?.finishedAt ? new Date(master.finishedAt) : null, TEN_HOURS_MS)),
      nextStxSyncAt: toIso(nextFrom(stxSync?.finishedAt ? new Date(stxSync.finishedAt) : null, ONE_DAY_MS)),
      nextStxAwbResyncAt: toIso(
        nextFrom(stxAwbResync?.finishedAt ? new Date(stxAwbResync.finishedAt) : null, ONE_DAY_MS)
      ),
      nextReenrichUnmatchedAt: toIso(nextFrom(reenrich?.finishedAt ? new Date(reenrich.finishedAt) : null, TWO_DAYS_MS)),
      lastManifests: {
        master: lastMasterManifest ?? null,
        offer: lastOfferManifest ?? null,
        stock: lastStockManifest ?? null,
        ediOut: lastEdiManifest ?? null,
      },
    };

    cachedStatusPayload = payload;
    cachedStatusAt = Date.now();
    return NextResponse.json({ ok: true, status: payload });
  } catch (error: any) {
    console.error("[GALAXUS][PIPELINE][STATUS] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Status failed" }, { status: 500 });
  }
}

