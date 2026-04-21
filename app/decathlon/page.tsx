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

type ExportDiagnostics = {
  supplierVariantsTotal: number;
  exportRowsAfterInvariants: number;
  pendingGtin: number;
  notFoundGtin: number;
  enrichPendingAt: string | null;
  enrichNotFoundAt: string | null;
};

type DecathlonImportRun = {
  runId: string;
  flow: "P41" | "OF01" | "STO01" | "PRI01";
  mode: string;
  status: string;
  importId?: string | null;
  rowsSent?: number;
  linesInError?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorStorageUrl?: string | null;
  errorPublicUrl?: string | null;
  summaryJson?: any;
  errorSummaryJson?: any;
};

type DecathlonOpsStatus = {
  jobs?: Array<{
    jobKey: string;
    intervalMs: number;
    enabled: boolean;
    lastRunAt?: string | null;
    nextRunAt?: string | null;
    lastError?: string | null;
  }>;
  latest?: Record<string, DecathlonImportRun>;
  recentRuns?: DecathlonImportRun[];
};

type ActionResult = {
  action: string;
  result?: any;
};

const FILE_TYPES: Array<{ id: string; label: string }> = [
  { id: "products", label: "Products" },
  { id: "offers", label: "Offers" },
];

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}

function buildP41CsvDownloadHref(rowLimit: string) {
  const params = new URLSearchParams();
  const limitValue = Number.parseInt(rowLimit.trim(), 10);
  if (Number.isFinite(limitValue) && limitValue > 0) {
    params.set("limit", String(limitValue));
  }
  const q = params.toString();
  return q ? `/api/decathlon/ops/p41-csv?${q}` : "/api/decathlon/ops/p41-csv";
}

export default function DecathlonDashboardPage() {
  const [runs, setRuns] = useState<DecathlonRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [fileDiagnostics, setFileDiagnostics] = useState<DiagnosticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowLimit, setRowLimit] = useState("50");
  const [exportCounts, setExportCounts] = useState<ExportDiagnostics | null>(null);
  const [exportCountsBusy, setExportCountsBusy] = useState(false);
  const [opsStatus, setOpsStatus] = useState<DecathlonOpsStatus | null>(null);
  const [opsBusy, setOpsBusy] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);

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

  const loadFileDiagnostics = async (runId: string) => {
    try {
      const res = await fetch(`/api/decathlon/exports/diagnostics?runId=${runId}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "Failed to load diagnostics");
      }
      setFileDiagnostics(data);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load diagnostics");
    }
  };

  const loadExportCounts = async () => {
    setExportCountsBusy(true);
    try {
      const res = await fetch("/api/galaxus/export/diagnostics", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) {
        setExportCounts({
          supplierVariantsTotal: data.counts?.supplierVariantsTotal ?? 0,
          exportRowsAfterInvariants: data.counts?.exportRowsAfterInvariants ?? 0,
          pendingGtin: data.counts?.pendingGtin ?? 0,
          notFoundGtin: data.counts?.notFoundGtin ?? 0,
          enrichPendingAt: data.lastRuns?.enrichPendingAt ?? null,
          enrichNotFoundAt: data.lastRuns?.enrichNotFoundAt ?? null,
        });
      }
    } catch {
      // silent — optional mirror of Galaxus DB
    } finally {
      setExportCountsBusy(false);
    }
  };

  const loadOpsStatus = async () => {
    try {
      const res = await fetch("/api/decathlon/ops/status", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) {
        setOpsStatus(data);
      }
    } catch {
      // silent
    }
  };

  const runOpsAction = async (action: string, payload?: Record<string, unknown>) => {
    setOpsBusy(action);
    setError(null);
    setActionResult(null);
    try {
      const res = await fetch("/api/decathlon/ops/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(payload ?? {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error ?? "Action failed");
      }
      setActionResult({ action, result: data.result ?? data.results ?? data });
      await loadOpsStatus();
    } catch (err: any) {
      setError(err?.message ?? "Action failed");
    } finally {
      setOpsBusy(null);
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
        await loadFileDiagnostics(data.runId);
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
      loadFileDiagnostics(activeRunId).catch(() => undefined);
    }
  }, [activeRunId]);

  useEffect(() => {
    loadExportCounts().catch(() => undefined);
  }, []);

  useEffect(() => {
    loadOpsStatus().catch(() => undefined);
  }, []);

  const activeRun = runs.find((run) => run.runId === activeRunId) ?? runs[0];
  const precheckCounts =
    (actionResult?.result as { precheckSummary?: { counts?: Record<string, number> } } | null)?.precheckSummary
      ?.counts ?? null;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Decathlon Supplier Dashboard</h1>
        <p className="text-sm text-gray-500">
          Mirakl sync for Decathlon from the Galaxus-side DB. Manual actions below call the Mirakl
          Seller APIs (OF01 offers, STO01 stock, PRI01 pricing).
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            className="inline-flex items-center rounded bg-gray-900 px-3 py-1 text-xs font-medium text-white"
            href="/galaxus"
          >
            Galaxus dashboard
          </a>
          <a
            className="inline-flex items-center rounded bg-gray-200 px-3 py-1 text-xs font-medium text-gray-900"
            href="/galaxus/warehouse"
          >
            Warehouse
          </a>
          <a
            className="inline-flex items-center rounded bg-gray-200 px-3 py-1 text-xs font-medium text-gray-900"
            href="/galaxus/pricing"
          >
            Pricing &amp; DB
          </a>
          <a
            className="inline-flex items-center rounded bg-teal-700 px-3 py-1 text-xs font-medium text-white"
            href="/decathlon/orders"
          >
            Orders
          </a>
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="space-y-4 border rounded p-4 bg-white">
        <div>
          <h2 className="text-lg font-semibold">Decathlon Ops Dashboard</h2>
          <p className="text-sm text-gray-500">
            Run Mirakl imports, review deltas, and inspect error summaries without leaving the UI.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded border bg-gray-50 p-3 space-y-3">
            <div>
              <div className="text-sm font-medium">Manual Mirakl imports</div>
              <p className="text-xs text-gray-500">
                Each button uploads one CSV job to Mirakl. Flow settings live in{" "}
                <code className="rounded bg-gray-200 px-1">decathlon/mirakl/config.ts</code>.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="max-w-sm px-3 py-2 rounded bg-indigo-600 text-white text-left text-sm leading-snug disabled:opacity-50"
                onClick={() => runOpsAction("product-sync")}
                disabled={opsBusy !== null}
              >
                {opsBusy === "product-sync" ? (
                  "Running…"
                ) : (
                  <>
                    <span className="block font-semibold">Sync new products only (P41)</span>
                    <span className="block text-[11px] font-normal opacity-90 mt-0.5">
                      Mirakl AI enrichment on by default (color etc. can be filled server-side). Use “Send offers
                      only” for OF01.
                    </span>
                  </>
                )}
              </button>
              <a
                className="inline-flex max-w-sm items-center px-3 py-2 rounded border border-indigo-300 bg-white text-indigo-800 text-left text-sm leading-snug hover:bg-indigo-50"
                href={buildP41CsvDownloadHref(rowLimit)}
              >
                <span className="block font-semibold">Download P41 product CSV</span>
                <span className="block text-[11px] font-normal text-gray-600 mt-0.5">
                  Same CSV as P41 (not yet LIVE). Row limit uses the field below. AI-inclusive rows are the default;
                  add <code className="rounded bg-gray-100 px-0.5">&amp;useAiEnrichment=0</code> for strict PM11 only.
                </span>
              </a>
              <button
                type="button"
                className="max-w-sm px-3 py-2 rounded bg-indigo-100 text-indigo-900 text-left text-sm leading-snug disabled:opacity-50"
                onClick={() => runOpsAction("offer-only")}
                disabled={opsBusy !== null}
              >
                {opsBusy === "offer-only" ? (
                  "Running…"
                ) : (
                  <>
                    <span className="block font-semibold">Send offers only (OF01)</span>
                    <span className="block text-[11px] font-normal opacity-90 mt-0.5">
                      No product upload; sends offers only for products already synced
                    </span>
                  </>
                )}
              </button>
              <button
                type="button"
                className="max-w-sm px-3 py-2 rounded bg-emerald-600 text-white text-left text-sm leading-snug disabled:opacity-50"
                onClick={() => runOpsAction("stock-sync")}
                disabled={opsBusy !== null}
              >
                {opsBusy === "stock-sync" ? (
                  "Running…"
                ) : (
                  <>
                    <span className="block font-semibold">Upload stock quantities (STO01)</span>
                    <span className="block text-[11px] font-normal opacity-90 mt-0.5">
                      Delta: only SKUs whose stock changed vs last sync
                    </span>
                  </>
                )}
              </button>
              <button
                type="button"
                className="max-w-sm px-3 py-2 rounded bg-violet-600 text-white text-left text-sm leading-snug disabled:opacity-50"
                onClick={() => runOpsAction("price-sync")}
                disabled={opsBusy !== null}
              >
                {opsBusy === "price-sync" ? (
                  "Running…"
                ) : (
                  <>
                    <span className="block font-semibold">Upload offer prices (PRI01)</span>
                    <span className="block text-[11px] font-normal opacity-90 mt-0.5">
                      Delta: only SKUs whose price changed vs last sync
                    </span>
                  </>
                )}
              </button>
              <button
                type="button"
                className="max-w-sm px-3 py-2 rounded bg-slate-900 text-white text-left text-sm leading-snug disabled:opacity-50"
                onClick={() => runOpsAction("offer-full")}
                disabled={opsBusy !== null}
              >
                {opsBusy === "offer-full" ? (
                  "Running…"
                ) : (
                  <>
                    <span className="block font-semibold">Reconcile all offers (OF01 full)</span>
                    <span className="block text-[11px] font-normal opacity-90 mt-0.5">
                      Re-sends every eligible offer line (not delta-only)
                    </span>
                  </>
                )}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="max-w-sm px-3 py-2 rounded bg-gray-100 text-gray-900 text-left text-sm leading-snug disabled:opacity-50"
                onClick={() => runOpsAction("status-all")}
                disabled={opsBusy !== null}
              >
                {opsBusy === "status-all" ? (
                  "Checking…"
                ) : (
                  <>
                    <span className="block font-semibold">Refresh latest import status</span>
                    <span className="block text-[11px] font-normal text-gray-600 mt-0.5">
                      Poll Mirakl for OF01, STO01, and PRI01 — no file upload
                    </span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-gray-500">
              Mirakl URL + API key in <code className="rounded bg-gray-200 px-1">.env</code> only. TEST mode,
              OF01 CM11 rules, and P51 poll timing are in{" "}
              <code className="rounded bg-gray-200 px-1">decathlon/mirakl/config.ts</code>. STO01/PRI01 show
              “no rows” when there are no deltas.
            </p>
          </div>

          <div className="rounded border bg-gray-50 p-3 space-y-3">
            <div className="text-sm font-medium">Latest sync status</div>
            <div className="space-y-2 text-xs text-gray-600">
              {["OF01", "STO01", "PRI01"].map((flow) => {
                const run = opsStatus?.latest?.[flow];
                return (
                  <div key={flow} className="rounded border bg-white p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-800">{flow}</span>
                      <span className="text-gray-500">{run?.status ?? "—"}</span>
                    </div>
                    <div className="text-gray-600">
                      Last run: {formatTime(run?.startedAt ?? null)} · Rows: {run?.rowsSent ?? "—"}
                    </div>
                    <div className="text-gray-600">
                      Import ID: {run?.importId ?? "—"} · Errors: {run?.linesInError ?? "—"}
                    </div>
                    {run?.runId && run?.linesInError && run.linesInError > 0 ? (
                      <a
                        className="text-blue-600 underline text-[11px]"
                        href={`/api/decathlon/ops/error-report?runId=${run.runId}`}
                      >
                        Download error report
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {Array.isArray(opsStatus?.recentRuns) && opsStatus!.recentRuns!.length > 0 ? (
              <details className="rounded border bg-white p-2 text-xs text-gray-600">
                <summary className="cursor-pointer font-medium">Recent runs</summary>
                <div className="mt-2 space-y-1">
                  {opsStatus!.recentRuns!.slice(0, 6).map((run) => (
                    <div key={run.runId} className="border-b border-gray-100 pb-1 last:border-b-0">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{run.flow}</span>
                        <span className="text-gray-500">{run.status}</span>
                      </div>
                      <div className="text-gray-500">
                        {formatTime(run.startedAt ?? null)} · Rows: {run.rowsSent ?? "—"} · Errors:{" "}
                        {run.linesInError ?? "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <div className="text-xs text-gray-500">No sync runs yet.</div>
            )}
          </div>
        </div>

        {actionResult ? (
          <div className="border rounded bg-gray-50 p-3 text-xs text-gray-700 space-y-1">
            <div className="font-medium">Last action: {actionResult.action}</div>
            {"runId" in (actionResult.result ?? {}) ? (
              <div className="space-y-1">
                <div>Run ID: {actionResult.result.runId ?? "—"}</div>
                <div>Flow: {actionResult.result.flow ?? "—"}</div>
                <div>Status: {actionResult.result.status ?? "—"}</div>
                <div>Rows sent: {actionResult.result.rowsSent ?? "—"}</div>
                <div>Import ID: {actionResult.result.importId ?? "—"}</div>
                <div>Lines in error: {actionResult.result.linesInError ?? "—"}</div>
                {actionResult.result?.summary ? (
                  <div className="mt-1 space-y-0.5 text-gray-600">
                    <div>
                      Mirakl import status:{" "}
                      {(actionResult.result.summary as { status?: string })?.status ?? "—"}
                    </div>
                    <div>
                      Reason:{" "}
                      {(actionResult.result.summary as { reasonStatus?: string })?.reasonStatus ?? "—"}
                    </div>
                  </div>
                ) : null}
                {actionResult.result?.p51PollTimedOut ? (
                  <div className="text-amber-800 mt-1">
                    Import polling stopped at max wait — status may still be updating. Use Refresh
                    status or check the back office.
                  </div>
                ) : null}
                {precheckCounts ? (
                  <div className="mt-2 space-y-1 text-gray-600">
                    <div>
                      Candidate window:{" "}
                      {precheckCounts.candidateOffset ?? "—"} → {precheckCounts.candidateWindowEnd ?? "—"}{" "}
                      of {precheckCounts.candidatesTotal ?? "—"} · Considered in batch:{" "}
                      {precheckCounts.eligible ?? "—"} · Sent: {precheckCounts.sent ?? "—"}
                    </div>
                    <div>
                      Skipped LIVE: {precheckCounts.skippedLive ?? "—"} · Missing required:{" "}
                      {precheckCounts.missingRequiredAttributes ?? "—"}
                    </div>
                    <div>
                      Status unknown: {precheckCounts.unknownStatus ?? "—"} · Not live:{" "}
                      {precheckCounts.notLive ?? "—"}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-gray-600">Action completed.</div>
            )}
          </div>
        ) : null}

        <div className="rounded border bg-gray-50 p-3 space-y-3">
          <div className="text-sm font-medium">Catalog snapshot (Galaxus DB)</div>
          <p className="text-xs text-gray-500">
            Single source of truth for variants and mappings — same numbers as the Galaxus export
            diagnostics (not a separate Decathlon database).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-md bg-slate-100 text-slate-900 disabled:opacity-50"
              onClick={() => loadExportCounts()}
              disabled={exportCountsBusy}
            >
              {exportCountsBusy ? "Refreshing…" : "Refresh export stats"}
            </button>
            <span className="text-xs text-slate-500">
              DB rows: {exportCounts?.supplierVariantsTotal ?? "—"} · Exportable:{" "}
              {exportCounts?.exportRowsAfterInvariants ?? "—"}
            </span>
          </div>
          <div className="rounded border bg-white p-2 text-xs text-gray-600 space-y-1">
            <div>
              Pending GTIN: {exportCounts?.pendingGtin ?? "—"} · Not found:{" "}
              {exportCounts?.notFoundGtin ?? "—"}
            </div>
            <div>
              Enrich pending last run: {formatTime(exportCounts?.enrichPendingAt ?? null)} · Not found
              last run: {formatTime(exportCounts?.enrichNotFoundAt ?? null)}
            </div>
          </div>
        </div>
      </div>

      <details className="border rounded bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-gray-700">
          Legacy: CSV export (manual upload — remove when on full API)
        </summary>
        <div className="mt-4 flex flex-col gap-6">
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

          <div className="rounded border border-slate-200 bg-gray-50 p-4">
            <h3 className="mb-2 text-base font-semibold">Latest run</h3>
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

          <div className="rounded border border-slate-200 bg-gray-50 p-4">
            <h3 className="mb-2 text-base font-semibold">Downloads</h3>
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

          <div className="rounded border border-slate-200 bg-gray-50 p-4">
            <h3 className="mb-2 text-base font-semibold">File generation diagnostics</h3>
            {fileDiagnostics?.exclusions?.totals ? (
              <div className="grid gap-3 text-sm text-slate-700 md:grid-cols-2">
                {Object.entries(fileDiagnostics.exclusions.totals).map(([reason, count]) => (
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

          <div className="rounded border border-slate-200 bg-gray-50 p-4">
            <h3 className="mb-2 text-base font-semibold">Run history</h3>
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
                        ? "border-slate-900 bg-white"
                        : "border-slate-200 hover:bg-slate-100"
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
      </details>
    </div>
  );
}
