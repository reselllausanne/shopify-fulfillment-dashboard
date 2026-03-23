"use client";

import { useEffect, useState } from "react";

type DecathlonExportFile = {
  fileType: string;
  rowCount: number;
  checksum?: string | null;
  storageUrl?: string | null;
  publicUrl?: string | null;
  sizeBytes?: number | null;
};

type DecathlonRun = {
  runId: string;
  startedAt: string;
  finishedAt?: string | null;
  success: boolean;
  errorMessage?: string | null;
  counts?: Record<string, number>;
  exclusions?: { totals?: Record<string, number> } | null;
  files?: DecathlonExportFile[];
};

type DiagnosticsPayload = {
  exclusions?: {
    totals?: Record<string, number>;
    samples?: Record<string, Array<{ message: string; providerKey?: string | null }>>;
  };
};

const FILE_TYPES: Array<{ id: string; label: string }> = [
  { id: "products", label: "Products" },
  { id: "offers", label: "Offers" },
  { id: "prices", label: "Prices" },
  { id: "stock", label: "Stock" },
];

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export default function DecathlonDashboardPage() {
  const [runs, setRuns] = useState<DecathlonRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowLimit, setRowLimit] = useState("50");

  const loadRuns = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/decathlon/exports", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Failed to load runs");
      }
      const runRows: DecathlonRun[] = Array.isArray(data?.runs) ? data.runs : [];
      setRuns(runRows);
      if (runRows.length > 0 && !activeRunId) {
        setActiveRunId(runRows[0].runId);
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to load runs");
    } finally {
      setLoading(false);
    }
  };

  const loadDiagnostics = async (runId: string) => {
    try {
      const res = await fetch(`/api/decathlon/exports/diagnostics?runId=${runId}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Failed to load diagnostics");
      }
      setDiagnostics(data);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load diagnostics");
    }
  };

  const handleGenerate = async () => {
    try {
      setGenerating(true);
      setError(null);
      const limitValue = Number.parseInt(rowLimit.trim(), 10);
      const hasLimit = Number.isFinite(limitValue) && limitValue > 0;
      const url = hasLimit
        ? `/api/decathlon/exports/generate?limit=${limitValue}`
        : "/api/decathlon/exports/generate";
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Export generation failed");
      }
      await loadRuns();
      if (data?.runId) {
        setActiveRunId(data.runId);
        await loadDiagnostics(data.runId);
      }
    } catch (err: any) {
      setError(err?.message ?? "Export generation failed");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    loadRuns().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (activeRunId) {
      loadDiagnostics(activeRunId).catch(() => undefined);
    }
  }, [activeRunId]);

  const activeRun = runs.find((run) => run.runId === activeRunId) ?? runs[0];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Decathlon Export Dashboard</h1>
        <p className="text-sm text-slate-500">
          Generate export-only CSVs and download them for manual upload.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleGenerate}
          className="rounded bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          disabled={generating}
        >
          {generating ? "Generating..." : "Generate export files"}
        </button>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Row limit
          <input
            type="number"
            min="1"
            value={rowLimit}
            onChange={(event) => setRowLimit(event.target.value)}
            className="w-24 rounded border border-slate-200 px-2 py-1 text-sm text-slate-700"
          />
        </label>
        <button
          type="button"
          onClick={() => loadRuns()}
          className="rounded border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Refresh runs
        </button>
      </div>

      {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <div className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-lg font-semibold">Latest Run</h2>
        {loading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : activeRun ? (
          <div className="flex flex-col gap-2 text-sm text-slate-700">
            <div className="flex flex-wrap gap-4">
              <span>Run ID: {activeRun.runId}</span>
              <span>Started: {formatDate(activeRun.startedAt)}</span>
              <span>Status: {activeRun.success ? "Success" : "Failed"}</span>
            </div>
            {activeRun.errorMessage ? (
              <div className="text-sm text-red-600">Error: {activeRun.errorMessage}</div>
            ) : null}
            <div className="flex flex-wrap gap-4 text-xs text-slate-500">
              {FILE_TYPES.map((file) => (
                <span key={file.id}>
                  {file.label}: {activeRun.counts?.[file.id] ?? "—"}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">No runs yet.</div>
        )}
      </div>

      <div className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-lg font-semibold">Downloads</h2>
        {!activeRun ? (
          <div className="text-sm text-slate-500">Generate a run to download files.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {FILE_TYPES.map((file) => (
              <a
                key={file.id}
                href={`/api/decathlon/exports/download?runId=${activeRun.runId}&type=${file.id}`}
                className="rounded border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Download {file.label}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-lg font-semibold">Diagnostics</h2>
        {diagnostics?.exclusions?.totals ? (
          <div className="grid gap-3 text-sm text-slate-700 md:grid-cols-2">
            {Object.entries(diagnostics.exclusions.totals).map(([reason, count]) => (
              <div key={reason} className="flex items-center justify-between border-b border-slate-100 pb-1">
                <span className="text-slate-600">{reason}</span>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">No diagnostics available.</div>
        )}
      </div>

      <div className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-lg font-semibold">Run History</h2>
        {runs.length === 0 ? (
          <div className="text-sm text-slate-500">No runs yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {runs.slice(0, 8).map((run) => (
              <button
                key={run.runId}
                type="button"
                onClick={() => setActiveRunId(run.runId)}
                className={`flex flex-wrap items-center justify-between rounded border px-3 py-2 text-left text-sm ${
                  run.runId === activeRunId
                    ? "border-slate-900 bg-slate-50"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="flex flex-col">
                  <span className="font-semibold">{run.runId}</span>
                  <span className="text-xs text-slate-500">{formatDate(run.startedAt)}</span>
                </div>
                <span className={`text-xs font-semibold ${run.success ? "text-green-600" : "text-red-600"}`}>
                  {run.success ? "Success" : "Failed"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
