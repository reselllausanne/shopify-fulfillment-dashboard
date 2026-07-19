import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { avg, percentile } from "@/lib/fulfillmentTiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function round(value: number | null, digits = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarizeSeconds(values: number[]) {
  return {
    count: values.length,
    avgSec: round(avg(values)),
    p50Sec: round(percentile(values, 0.5)),
    p90Sec: round(percentile(values, 0.9)),
  };
}

function summarizeMinutes(values: number[]) {
  return {
    count: values.length,
    avgMin: round(avg(values)),
    p50Min: round(percentile(values, 0.5)),
    p90Min: round(percentile(values, 0.9)),
  };
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const daysRaw = Number(req.nextUrl.searchParams.get("days") || 7);
    const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, Math.floor(daysRaw))) : 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await prisma.shopifyFulfillmentRecord.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        createdAt: true,
        shopifyOrderName: true,
        sourceAwb: true,
        actorRole: true,
        scanStartedAt: true,
        scanToLabelSeconds: true,
        scanToFulfillmentSeconds: true,
        stockxDeliveredToScanMinutes: true,
        stockxDeliveredToFulfillmentMinutes: true,
        requestDurationMs: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const scanToFulfill = rows
      .map((r) => r.scanToFulfillmentSeconds)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const scanToLabel = rows
      .map((r) => r.scanToLabelSeconds)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const stxToFulfill = rows
      .map((r) => r.stockxDeliveredToFulfillmentMinutes)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const stxToScan = rows
      .map((r) => r.stockxDeliveredToScanMinutes)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const requestMs = rows
      .map((r) => r.requestDurationMs)
      .filter((v): v is number => v != null && Number.isFinite(v));

    const byDayMap = new Map<
      string,
      { date: string; fulfills: number; withScanTiming: number; scanToFulfillSecs: number[] }
    >();
    for (const row of rows) {
      const key = dayKey(row.createdAt);
      let bucket = byDayMap.get(key);
      if (!bucket) {
        bucket = { date: key, fulfills: 0, withScanTiming: 0, scanToFulfillSecs: [] };
        byDayMap.set(key, bucket);
      }
      bucket.fulfills += 1;
      if (row.scanToFulfillmentSeconds != null) {
        bucket.withScanTiming += 1;
        bucket.scanToFulfillSecs.push(row.scanToFulfillmentSeconds);
      }
    }

    const byDay = [...byDayMap.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((b) => ({
        date: b.date,
        fulfills: b.fulfills,
        withScanTiming: b.withScanTiming,
        p50ScanToFulfillSec: round(percentile(b.scanToFulfillSecs, 0.5)),
      }));

    const recent = rows.slice(0, 40).map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      orderName: r.shopifyOrderName,
      awb: r.sourceAwb,
      actorRole: r.actorRole,
      scanToLabelSeconds: r.scanToLabelSeconds,
      scanToFulfillmentSeconds: r.scanToFulfillmentSeconds,
      stockxDeliveredToFulfillmentMinutes: r.stockxDeliveredToFulfillmentMinutes,
      requestDurationMs: r.requestDurationMs,
    }));

    return NextResponse.json({
      ok: true,
      days,
      since: since.toISOString(),
      total: rows.length,
      withScanTiming: scanToFulfill.length,
      withLabelTiming: scanToLabel.length,
      withStxDelivered: stxToFulfill.length,
      scanToFulfillment: summarizeSeconds(scanToFulfill),
      scanToLabel: summarizeSeconds(scanToLabel),
      stockxDeliveredToFulfillment: summarizeMinutes(stxToFulfill),
      stockxDeliveredToScan: summarizeMinutes(stxToScan),
      requestDuration: {
        count: requestMs.length,
        avgMs: round(avg(requestMs), 0),
        p50Ms: round(percentile(requestMs, 0.5), 0),
        p90Ms: round(percentile(requestMs, 0.9), 0),
      },
      byDay,
      recent,
    });
  } catch (error: any) {
    console.error("[LOGISTICS][FULFILLMENT-STATS] Error:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to load fulfillment stats" },
      { status: 500 }
    );
  }
}
