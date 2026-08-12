"use client";

import { useEffect, useState } from "react";

type BackfillItem = {
  shopifyOrderName: string | null;
  stockxOrderNumber: string;
  status: "UPDATED" | "NO_TRACKING" | "AUTH_FAILED" | "ERROR" | "DRY_RUN";
  awb?: string | null;
  stockxStatus?: string | null;
  error?: string | null;
};

type BackfillResponse = {
  ok: boolean;
  dryRun?: boolean;
  scanned?: number;
  candidates?: number;
  updated?: number;
  abortedReason?: string | null;
  items?: BackfillItem[];
  error?: string;
  details?: string;
};

const statusStyle: Record<BackfillItem["status"], string> = {
  UPDATED: "bg-green-100 text-green-800",
  DRY_RUN: "bg-blue-100 text-blue-800",
  NO_TRACKING: "bg-gray-100 text-gray-700",
  AUTH_FAILED: "bg-red-100 text-red-800",
  ERROR: "bg-orange-100 text-orange-800",
};

export default function AwbBackfillPage() {
  const [token, setToken] = useState("");
  const [days, setDays] = useState(45);
  const [limit, setLimit] = useState(40);
  const [dryRun, setDryRun] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BackfillResponse | null>(null);
  const [stats, setStats] = useState<{ missingAwb: number; stockxMatches: number } | null>(null);

  const loadStats = async (windowDays: number) => {
    try {
      const res = await fetch(`/api/db/backfill-awb?days=${windowDays}`);
      const data = await res.json();
      if (data?.ok) setStats({ missingAwb: data.missingAwb, stockxMatches: data.stockxMatches });
    } catch {
      setStats(null);
    }
  };

  useEffect(() => {
    void loadStats(days);
  }, [days]);

  const run = async () => {
    if (!token.trim()) {
      window.alert("Paste a StockX bearer token first.");
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/db/backfill-awb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, days, limit, dryRun }),
      });
      const data: BackfillResponse = await res.json();
      setResult(data);
      await loadStats(days);
    } catch (error: any) {
      setResult({ ok: false, error: error?.message || "Network error" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Backfill StockX AWB</h1>
          <p className="mt-1 text-sm text-gray-600">
            Refetches <span className="font-mono">getBuyOrder</span> for matched StockX buys that have
            no AWB stored, so the warehouse scan page can find them.
          </p>
        </div>

        {stats && (
          <div className="rounded-lg border bg-white p-4 text-sm text-gray-800">
            Last {days} days: <strong>{stats.missingAwb}</strong> StockX matches without AWB out of{" "}
            <strong>{stats.stockxMatches}</strong>.
          </div>
        )}

        <div className="space-y-4 rounded-lg border bg-white p-4">
          <label className="block text-sm font-medium text-gray-700">
            StockX bearer token
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              rows={4}
              placeholder="Paste the bearer token copied from the StockX buying page"
              className="mt-1 w-full rounded border p-2 font-mono text-xs"
            />
          </label>

          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm text-gray-700">
              Days back
              <input
                type="number"
                min={1}
                max={180}
                value={days}
                onChange={(e) => setDays(Number(e.target.value) || 45)}
                className="mt-1 block w-24 rounded border p-2"
              />
            </label>
            <label className="text-sm text-gray-700">
              Max orders
              <input
                type="number"
                min={1}
                max={200}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value) || 40)}
                className="mt-1 block w-24 rounded border p-2"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              Dry run (no DB write)
            </label>
            <button
              onClick={run}
              disabled={running}
              className="rounded bg-indigo-600 px-4 py-2 text-white disabled:bg-gray-400"
            >
              {running ? "Running…" : dryRun ? "Test token" : "Run backfill"}
            </button>
          </div>
        </div>

        {result && (
          <div className="space-y-3 rounded-lg border bg-white p-4">
            {result.ok ? (
              <div className="text-sm text-gray-800">
                Checked <strong>{result.scanned}</strong> orders · updated{" "}
                <strong>{result.updated}</strong>
                {result.dryRun ? " (dry run)" : ""}
              </div>
            ) : (
              <div className="text-sm text-red-700">
                {result.error} {result.details}
              </div>
            )}

            {result.abortedReason && (
              <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {result.abortedReason}
              </div>
            )}

            {result.items && result.items.length > 0 && (
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-gray-500">
                  <tr>
                    <th className="py-1">Shopify</th>
                    <th className="py-1">StockX order</th>
                    <th className="py-1">Result</th>
                    <th className="py-1">AWB</th>
                    <th className="py-1">StockX status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={`${item.stockxOrderNumber}`} className="border-t">
                      <td className="py-1">{item.shopifyOrderName || "—"}</td>
                      <td className="py-1 font-mono text-xs">{item.stockxOrderNumber}</td>
                      <td className="py-1">
                        <span className={`rounded px-2 py-0.5 text-xs ${statusStyle[item.status]}`}>
                          {item.status}
                        </span>
                        {item.error ? (
                          <span className="ml-2 text-xs text-gray-500">{item.error}</span>
                        ) : null}
                      </td>
                      <td className="py-1 font-mono text-xs">{item.awb || "—"}</td>
                      <td className="py-1 text-xs">{item.stockxStatus || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
