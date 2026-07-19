"use client";

import { useCallback, useEffect, useState } from "react";

type MetricSeconds = {
  count: number;
  avgSec: number | null;
  p50Sec: number | null;
  p90Sec: number | null;
};

type MetricMinutes = {
  count: number;
  avgMin: number | null;
  p50Min: number | null;
  p90Min: number | null;
};

type StatsPayload = {
  ok: boolean;
  days: number;
  total: number;
  withScanTiming: number;
  withLabelTiming: number;
  withStxDelivered: number;
  scanToFulfillment: MetricSeconds;
  scanToLabel: MetricSeconds;
  stockxDeliveredToFulfillment: MetricMinutes;
  stockxDeliveredToScan: MetricMinutes;
  requestDuration: {
    count: number;
    avgMs: number | null;
    p50Ms: number | null;
    p90Ms: number | null;
  };
  byDay: Array<{
    date: string;
    fulfills: number;
    withScanTiming: number;
    p50ScanToFulfillSec: number | null;
  }>;
  recent: Array<{
    id: string;
    createdAt: string;
    orderName: string | null;
    awb: string | null;
    actorRole: string | null;
    scanToLabelSeconds: number | null;
    scanToFulfillmentSeconds: number | null;
    stockxDeliveredToFulfillmentMinutes: number | null;
    requestDurationMs: number | null;
  }>;
  error?: string;
};

function fmtSec(v: number | null | undefined) {
  if (v == null) return "—";
  if (v < 60) return `${v.toFixed(0)}s`;
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return `${m}m ${s}s`;
}

function fmtMin(v: number | null | undefined) {
  if (v == null) return "—";
  if (v < 60) return `${Math.round(v)}m`;
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  if (h < 48) return `${h}h ${m}m`;
  return `${(v / 1440).toFixed(1)}d`;
}

function MetricCard({
  title,
  subtitle,
  p50,
  avg,
  p90,
  count,
}: {
  title: string;
  subtitle: string;
  p50: string;
  avg: string;
  p90: string;
  count: number;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-medium text-gray-900">{title}</div>
      <div className="mt-0.5 text-xs text-gray-500">{subtitle}</div>
      <div className="mt-3 text-3xl font-semibold tabular-nums text-gray-900">{p50}</div>
      <div className="mt-1 text-xs text-gray-500">p50 · n={count}</div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
        <div>
          avg <span className="font-medium text-gray-900">{avg}</span>
        </div>
        <div>
          p90 <span className="font-medium text-gray-900">{p90}</span>
        </div>
      </div>
    </div>
  );
}

export default function ScanFulfillmentStatsPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (selectedDays: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/logistics/fulfillment-stats?days=${selectedDays}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as StatsPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  return (
    <div className="min-h-screen bg-gray-50 p-6 text-gray-900">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Fulfillment timing</h1>
            <p className="mt-1 text-sm text-gray-600">
              Scan → label → fulfill (warehouse team). StockX lag = inbound → fulfill.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/scan"
              className="rounded bg-gray-200 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-300"
            >
              ← Scan
            </a>
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded px-3 py-1.5 text-sm ${
                  days === d
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-100"
                }`}
              >
                {d}d
              </button>
            ))}
            <button
              type="button"
              onClick={() => void load(days)}
              disabled={loading}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {loading ? "…" : "Refresh"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {data && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border bg-white p-3 text-sm">
                <div className="text-gray-500">Fulfills</div>
                <div className="text-2xl font-semibold">{data.total}</div>
              </div>
              <div className="rounded-lg border bg-white p-3 text-sm">
                <div className="text-gray-500">With scan clock</div>
                <div className="text-2xl font-semibold">{data.withScanTiming}</div>
              </div>
              <div className="rounded-lg border bg-white p-3 text-sm">
                <div className="text-gray-500">With label clock</div>
                <div className="text-2xl font-semibold">{data.withLabelTiming}</div>
              </div>
              <div className="rounded-lg border bg-white p-3 text-sm">
                <div className="text-gray-500">With StockX inbound</div>
                <div className="text-2xl font-semibold">{data.withStxDelivered}</div>
              </div>
            </div>

            {data.withScanTiming === 0 && (
              <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                No scan→fulfill samples yet in this window. New scans from /scan will start filling
                this after deploy.
              </div>
            )}

            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard
                title="Scan → fulfill"
                subtitle="Team pick/pack cycle"
                p50={fmtSec(data.scanToFulfillment.p50Sec)}
                avg={fmtSec(data.scanToFulfillment.avgSec)}
                p90={fmtSec(data.scanToFulfillment.p90Sec)}
                count={data.scanToFulfillment.count}
              />
              <MetricCard
                title="Scan → label"
                subtitle="Until Swiss Post label"
                p50={fmtSec(data.scanToLabel.p50Sec)}
                avg={fmtSec(data.scanToLabel.avgSec)}
                p90={fmtSec(data.scanToLabel.p90Sec)}
                count={data.scanToLabel.count}
              />
              <MetricCard
                title="StockX inbound → fulfill"
                subtitle="Waiting after delivered-to-CH"
                p50={fmtMin(data.stockxDeliveredToFulfillment.p50Min)}
                avg={fmtMin(data.stockxDeliveredToFulfillment.avgMin)}
                p90={fmtMin(data.stockxDeliveredToFulfillment.p90Min)}
                count={data.stockxDeliveredToFulfillment.count}
              />
            </div>

            <div className="mb-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b px-4 py-3 text-sm font-medium">By day</div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Fulfills</th>
                      <th className="px-4 py-2">Scan timed</th>
                      <th className="px-4 py-2">p50 scan→fulfill</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.byDay.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-gray-500">
                          No rows.
                        </td>
                      </tr>
                    ) : (
                      data.byDay.map((row) => (
                        <tr key={row.date}>
                          <td className="px-4 py-2 font-mono text-xs">{row.date}</td>
                          <td className="px-4 py-2">{row.fulfills}</td>
                          <td className="px-4 py-2">{row.withScanTiming}</td>
                          <td className="px-4 py-2">{fmtSec(row.p50ScanToFulfillSec)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b px-4 py-3 text-sm font-medium">Recent fulfills</div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-2">When</th>
                      <th className="px-4 py-2">Order</th>
                      <th className="px-4 py-2">Role</th>
                      <th className="px-4 py-2">Scan→label</th>
                      <th className="px-4 py-2">Scan→fulfill</th>
                      <th className="px-4 py-2">STX→fulfill</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.recent.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-2 text-xs text-gray-600">
                          {new Date(row.createdAt).toLocaleString("fr-CH")}
                        </td>
                        <td className="px-4 py-2 font-medium">{row.orderName || "—"}</td>
                        <td className="px-4 py-2 text-xs">{row.actorRole || "—"}</td>
                        <td className="px-4 py-2">{fmtSec(row.scanToLabelSeconds)}</td>
                        <td className="px-4 py-2">{fmtSec(row.scanToFulfillmentSeconds)}</td>
                        <td className="px-4 py-2">
                          {fmtMin(row.stockxDeliveredToFulfillmentMinutes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {loading && !data && (
          <div className="rounded border bg-white px-4 py-8 text-center text-sm text-gray-500">
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
