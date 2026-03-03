import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

async function lastJob(jobName: string) {
  return (prisma as any).galaxusJobRun.findFirst({
    where: { jobName },
    orderBy: { finishedAt: "desc" },
  });
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
    const [ediIn, offerStock, master, stxSync, stxAwbResync, enrichNew, reenrich, partnerSync] =
      await Promise.all([
      lastJob("edi-in"),
      lastJob("pipeline-offer-stock"),
      lastJob("pipeline-master"),
      lastJob("pipeline-stx-sync"),
      lastJob("pipeline-stx-awb-resync"),
      lastJob("kickdb-enrich-new"),
      lastJob("kickdb-reenrich-unmatched"),
      lastJob("pipeline-partner-sync"),
      ]);

    const [lastMasterManifest, lastOfferManifest, lastStockManifest, lastEdiManifest] = await Promise.all([
      (prisma as any).galaxusExportManifest.findFirst({
        where: { exportType: "master" },
        orderBy: { createdAt: "desc" },
      }),
      (prisma as any).galaxusExportManifest.findFirst({
        where: { exportType: "offer" },
        orderBy: { createdAt: "desc" },
      }),
      (prisma as any).galaxusExportManifest.findFirst({
        where: { exportType: "stock" },
        orderBy: { createdAt: "desc" },
      }),
      (prisma as any).galaxusExportManifest.findFirst({
        where: { exportType: "edi-out" },
        orderBy: { createdAt: "desc" },
      }),
    ]);

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

    return NextResponse.json({ ok: true, status: payload });
  } catch (error: any) {
    console.error("[GALAXUS][PIPELINE][STATUS] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Status failed" }, { status: 500 });
  }
}

