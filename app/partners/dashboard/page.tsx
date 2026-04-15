"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type PartnerInfo = {
  id: string;
  key: string;
  name: string;
  active?: boolean;
  defaultLeadTimeDays?: number | null;
};

type UploadResult = {
  uploadId?: string;
  importedRows?: number;
  errorRows?: number;
  newRows?: number;
  errors?: Array<{ row: number; field: string; message: string }>;
  rows?: Array<{
    row: number;
    status: "RESOLVED" | "PENDING_GTIN" | "AMBIGUOUS_GTIN" | "PENDING_ENRICH" | "ERROR";
    gtin?: string | null;
    error?: string;
  }>;
};

type UploadLog = {
  id: string;
  filename: string;
  status: string;
  totalRows: number;
  importedRows: number;
  errorRows: number;
  errorsJson: unknown;
  createdAt: string | null;
};

const TEMPLATE_HEADERS = ["providerKey", "sku", "size", "rawStock", "price"];

export default function PartnerDashboardPage() {
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [enrichLog, setEnrichLog] = useState<string | null>(null);
  const [importQueueLog, setImportQueueLog] = useState<string | null>(null);
  const [importPollUploadId, setImportPollUploadId] = useState<string | null>(null);
  const [catalogCount, setCatalogCount] = useState<number>(0);
  const [uploadHistory, setUploadHistory] = useState<UploadLog[]>([]);
  const [pendingEnrichCount, setPendingEnrichCount] = useState<number>(0);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [ordersToProcessCount, setOrdersToProcessCount] = useState<number | null>(null);
  type ShippedSalesBlock =
    | {
        kind: "ner_mirakl";
        fulfilledOrderCount: number;
        fulfilledPartnerLineUnits: number;
        miraklPayoutChf: number;
        miraklPayoutLineMisses: number;
      }
    | {
        kind: "partner_sell";
        fulfilledOrderCount: number;
        fulfilledPartnerLineUnits: number;
        sellTotalChf: number;
      };
  const [shippedSalesBlock, setShippedSalesBlock] = useState<ShippedSalesBlock | null>(null);
  const [catalogShippedChf, setCatalogShippedChf] = useState<number | null>(null);
  const [catalogShippedLines, setCatalogShippedLines] = useState<number | null>(null);
  const [catalogShippedExcluded, setCatalogShippedExcluded] = useState(false);
  const router = useRouter();

  const loadHistory = async (offset = 0) => {
    try {
      const res = await fetch(`/api/partners/uploads/history?limit=100&offset=${offset}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok) return;
      setCatalogCount(data.catalogCount ?? 0);
      setUploadHistory(data.uploads ?? []);
      setPendingEnrichCount(data.pendingEnrichCount ?? 0);
      setHistoryLoaded(true);
    } catch {
      // silent
    }
  };

  const normalizeState = (state?: string | null) => String(state ?? "").trim().toUpperCase();
  const canceledStates = new Set(["CANCELED", "CANCELLED", "ORDER_CANCELLED", "CLOSED"]);

  const loadShippedSales = async () => {
    try {
      const res = await fetch("/api/partners/decathlon-shipped-stats", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) return;
      setCatalogShippedExcluded(Boolean(data.catalogShippedExcluded));
      setCatalogShippedChf(
        data.catalogShippedExcluded ? 0 : Number(data.partnerCatalogShippedChf ?? 0)
      );
      setCatalogShippedLines(
        data.catalogShippedExcluded ? 0 : Number(data.shippedLineCount ?? 0)
      );
      if (data.variant === "ner_mirakl") {
        setShippedSalesBlock({
          kind: "ner_mirakl",
          fulfilledOrderCount: Number(data.fulfilledOrderCount ?? 0),
          fulfilledPartnerLineUnits: Number(data.fulfilledPartnerLineUnits ?? 0),
          miraklPayoutChf: Number(data.miraklPayoutChf ?? 0),
          miraklPayoutLineMisses: Number(data.miraklPayoutLineMisses ?? 0),
        });
        return;
      }
      setShippedSalesBlock({
        kind: "partner_sell",
        fulfilledOrderCount: Number(data.fulfilledOrderCount ?? 0),
        fulfilledPartnerLineUnits: Number(data.fulfilledPartnerLineUnits ?? 0),
        sellTotalChf: Number(data.sellTotalChf ?? 0),
      });
    } catch {
      // silent
    }
  };

  const loadOrdersSummary = async () => {
    try {
      const res = await fetch("/api/decathlon/orders?limit=200&scope=partner", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok) return;
      const items: Array<{
        orderState?: string | null;
        shippedCount?: number;
        totalUnits?: number;
        shippedUnits?: number;
        remainingUnits?: number;
        _count?: { shipments?: number };
      }> = Array.isArray(data.items) ? data.items : [];
      const toProcess = items.filter((order) => {
        const state = normalizeState(order.orderState);
        const totalUnits = order.totalUnits ?? 0;
        const shippedUnits = order.shippedUnits ?? 0;
        const remainingUnits = order.remainingUnits ?? Math.max(totalUnits - shippedUnits, 0);
        const shippedCount = order.shippedCount ?? order._count?.shipments ?? 0;
        const isFulfilled = totalUnits > 0 ? remainingUnits <= 0 : shippedCount > 0;
        return !isFulfilled && !canceledStates.has(state);
      }).length;
      setOrdersToProcessCount(toProcess);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    if (!importPollUploadId) return;
    const id = window.setInterval(() => {
      void loadHistory();
    }, 2500);
    return () => window.clearInterval(id);
  }, [importPollUploadId]);

  useEffect(() => {
    if (!importPollUploadId) return;
    const u = uploadHistory.find((x) => x.id === importPollUploadId);
    if (u && !["QUEUED", "PROCESSING"].includes(u.status)) {
      setImportPollUploadId(null);
      setImportQueueLog(
        u.status === "FAILED"
          ? "Import failed — open Upload History for details."
          : `Import finished: ${u.importedRows} rows imported, ${u.errorRows} row errors.`
      );
    }
  }, [uploadHistory, importPollUploadId]);

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/partners/me", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/partners/login");
        return;
      }
      const data = await res.json();
      if (data.ok) {
        setPartner(data.partner);
        loadHistory();
        loadOrdersSummary();
        loadShippedSales();
      }
    };
    load();
  }, [router]);

  const downloadTemplate = () => {
    const content = `${TEMPLATE_HEADERS.join(",")}\n`;
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "partner-catalog-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const uploadCsv = async () => {
    if (!file) {
      setError("Select a CSV file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setUploadResult(null);
    setImportQueueLog(null);
    setImportPollUploadId(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/partners/uploads", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      if (data.queued && data.uploadId) {
        setImportPollUploadId(data.uploadId);
        setImportQueueLog(
          `Import queued (job ${data.jobId}). Large files are processed in the background; upload history refreshes automatically.`
        );
        await loadHistory();
        return;
      }
      setUploadResult(data.result ?? data);
      await loadHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const enrichPending = async (force = false) => {
    setBusy(true);
    setError(null);
    setEnrichLog(null);
    try {
      const res = await fetch(
        `/api/partners/enrich?mode=new&autoDrain=1&limit=500&force=${force ? 1 : 0}`,
        {
          method: "POST",
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Enrich failed");
      if (data.queued) {
        setEnrichLog(`Queued enrichment job ${data.jobId} (limit ${data.limit}).`);
      } else {
        setEnrichLog(JSON.stringify(data.results ?? [], null, 2));
      }
      await loadHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadCatalogCsv = async () => {
    setDownloadBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/partners/catalog/export", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Download failed");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match =
        disposition.match(/filename\*=UTF-8''([^;]+)$/i) ||
        disposition.match(/filename="([^"]+)"/i) ||
        disposition.match(/filename=([^;]+)/i);
      const filename = match?.[1] ? decodeURIComponent(match[1]) : "partner-stock-enriched.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDownloadBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Partner Dashboard</h1>
        <p className="text-sm text-slate-500">
          {partner ? `${partner.name} (${partner.key})` : "Loading partner…"}
        </p>
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-[#55b3f3]"
          onClick={() => router.push("/partners/catalog")}
        >
          <div className="text-xs uppercase tracking-wide text-slate-400">Catalog</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{catalogCount}</div>
          <div className="text-xs text-slate-500">Open catalog to manage prices and stock.</div>
        </button>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">Enrichment Queue</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{pendingEnrichCount}</div>
          <div className="text-xs text-slate-500">New products waiting to enrich</div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <button
          className="rounded-2xl border border-slate-200 bg-white px-4 py-5 text-left transition hover:border-[#55b3f3]"
          onClick={() => router.push("/partners/orders")}
        >
          <div className="text-xs uppercase tracking-wide text-slate-400">Orders</div>
          <div className="mt-2 text-lg font-semibold text-slate-900">To process</div>
          <div className="text-xs text-slate-500">
            {ordersToProcessCount == null
              ? "Loading orders…"
              : `${ordersToProcessCount} order${ordersToProcessCount === 1 ? "" : "s"} to process`}
          </div>
        </button>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="text-xs uppercase tracking-wide text-slate-400">
            {shippedSalesBlock?.kind === "ner_mirakl" ? "Fulfilled — Mirakl payout" : "Fulfilled — sell (Mirakl ligne)"}
          </div>
          {shippedSalesBlock == null ? (
            <div className="mt-2 text-xs text-slate-500">Loading…</div>
          ) : shippedSalesBlock.kind === "ner_mirakl" ? (
            <div className="mt-2 space-y-2 text-xs text-slate-600">
              <div className="text-2xl font-semibold text-slate-900">
                CHF {shippedSalesBlock.miraklPayoutChf.toFixed(2)}
                <span className="ml-2 text-xs font-normal text-slate-500">total Mirakl payout</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <div>
                  <span className="text-slate-400">Fulfilled orders</span>{" "}
                  <span className="font-medium text-slate-800">{shippedSalesBlock.fulfilledOrderCount}</span>
                </div>
                <div>
                  <span className="text-slate-400">Your line units</span>{" "}
                  <span className="font-medium text-slate-800">{shippedSalesBlock.fulfilledPartnerLineUnits}</span>
                </div>
              </div>
              <div className="text-[11px] text-slate-500 leading-snug">
                Same orders as <strong>Fulfilled</strong> under Decathlon orders (including manual / legacy shipments).
                Each line: Mirakl <code className="text-[10px]">total_price − total_commission</code>.
                {shippedSalesBlock.miraklPayoutLineMisses > 0
                  ? ` ${shippedSalesBlock.miraklPayoutLineMisses} line(s) missing Mirakl totals in stored JSON — run order sync if needed.`
                  : null}
              </div>
            </div>
          ) : (
            <>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                CHF {shippedSalesBlock.sellTotalChf.toFixed(2)}
              </div>
              <div className="text-xs text-slate-500">
                Sum of Mirakl sell totals on your lines for fulfilled orders (
                {shippedSalesBlock.fulfilledPartnerLineUnits} unit
                {shippedSalesBlock.fulfilledPartnerLineUnits === 1 ? "" : "s"},{" "}
                {shippedSalesBlock.fulfilledOrderCount} order
                {shippedSalesBlock.fulfilledOrderCount === 1 ? "" : "s"}). Margin is not computed.
              </div>
            </>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-5">
          <div className="text-xs uppercase tracking-wide text-slate-400">Shipped sales (catalog)</div>
          {catalogShippedExcluded ? (
            <div className="mt-2 text-xs text-slate-500">Not shown for NER (use Mirakl payout card).</div>
          ) : catalogShippedChf == null ? (
            <div className="mt-2 text-xs text-slate-500">Loading…</div>
          ) : (
            <>
              <div className="mt-2 text-2xl font-semibold text-slate-900">CHF {catalogShippedChf.toFixed(2)}</div>
              <div className="text-xs text-slate-500">
                Your feed price × shipped units ({catalogShippedLines ?? 0} shipment line
                {(catalogShippedLines ?? 0) === 1 ? "" : "s"}).
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Catalog Upload</div>
              <div className="text-xs text-slate-500">
                Upload your stock CSV. Newly added products will be queued for enrichment.
              </div>
            </div>
            <button
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-[#55b3f3]"
              onClick={downloadTemplate}
              disabled={busy}
            >
              Download template
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button
              className="rounded-full bg-[#55b3f3] px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
              onClick={uploadCsv}
              disabled={busy}
            >
              {busy ? "Uploading…" : importPollUploadId ? "Processing…" : "Upload CSV"}
            </button>
          </div>
          {importQueueLog && (
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              {importQueueLog}
            </div>
          )}
          {uploadResult && (
            <div className="space-y-2 text-xs text-slate-600">
              <div>
                Imported: {uploadResult.importedRows ?? 0}, New: {uploadResult.newRows ?? 0}, Errors:{" "}
                {uploadResult.errorRows ?? 0}
              </div>
              {uploadResult.rows && uploadResult.rows.length > 0 && (
                <div className="overflow-auto rounded border border-slate-200">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-2 py-1 text-left">Row</th>
                        <th className="px-2 py-1 text-left">Status</th>
                        <th className="px-2 py-1 text-left">GTIN</th>
                        <th className="px-2 py-1 text-left">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uploadResult.rows.map((row) => (
                        <tr key={`${row.row}-${row.status}`} className="border-t">
                          <td className="px-2 py-1">{row.row}</td>
                          <td className="px-2 py-1">{row.status}</td>
                          <td className="px-2 py-1">{row.gtin ?? ""}</td>
                          <td className="px-2 py-1">{row.error ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <div className="text-sm font-semibold text-slate-900">Enrichment</div>
            <div className="text-xs text-slate-500">
              Enrichment runs automatically on upload. Use force re-enrich only after you change SKU/size values in the
              catalog and want to refresh KickDB matches.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-xs text-slate-700 disabled:opacity-50"
              onClick={() => enrichPending(true)}
              disabled={busy}
            >
              Force re-enrich
            </button>
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-xs text-slate-700 disabled:opacity-50"
              onClick={downloadCatalogCsv}
              disabled={busy || downloadBusy}
            >
              {downloadBusy ? "Preparing…" : "Download enriched CSV"}
            </button>
          </div>
          {enrichLog && (
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs overflow-auto whitespace-pre-wrap">
              {enrichLog}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Upload History</div>
            <div className="text-xs text-slate-500">Past CSV uploads and their status.</div>
          </div>
          <button
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600"
            onClick={() => loadHistory()}
            disabled={busy}
          >
            Refresh
          </button>
        </div>

        {uploadHistory.length === 0 && historyLoaded && (
          <div className="text-xs text-slate-400">No uploads yet.</div>
        )}

        {uploadHistory.length > 0 && (
          <div className="overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-2 py-1 text-left">Date</th>
                  <th className="px-2 py-1 text-left">File</th>
                  <th className="px-2 py-1 text-left">Status</th>
                  <th className="px-2 py-1 text-right">Total</th>
                  <th className="px-2 py-1 text-right">Imported</th>
                  <th className="px-2 py-1 text-right">Errors</th>
                </tr>
              </thead>
              <tbody>
                {uploadHistory.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="px-2 py-1">
                      {u.createdAt ? new Date(u.createdAt).toLocaleString() : ""}
                    </td>
                    <td className="px-2 py-1 font-mono">{u.filename}</td>
                    <td className="px-2 py-1">
                      <span
                        className={
                          u.status === "COMPLETED"
                            ? "text-emerald-700"
                            : u.status === "FAILED"
                            ? "text-red-600"
                            : u.status === "COMPLETED_WITH_ERRORS"
                            ? "text-amber-700"
                            : "text-slate-600"
                        }
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right">{u.totalRows}</td>
                    <td className="px-2 py-1 text-right">{u.importedRows}</td>
                    <td className="px-2 py-1 text-right">
                      {u.errorRows > 0 ? <span className="text-red-600">{u.errorRows}</span> : u.errorRows}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
