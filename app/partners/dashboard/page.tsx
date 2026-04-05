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

type PendingRow = {
  id: string;
  sku: string;
  sizeRaw: string;
  rawStock: number;
  price: string;
  status: string;
  gtinResolved: string;
  updatedAt: string | null;
};

const TEMPLATE_HEADERS = ["providerKey", "sku", "size", "rawStock", "price"];

export default function PartnerDashboardPage() {
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [enrichLog, setEnrichLog] = useState<string | null>(null);
  const [catalogCount, setCatalogCount] = useState<number>(0);
  const [uploadHistory, setUploadHistory] = useState<UploadLog[]>([]);
  const [pendingRows, setPendingRows] = useState<PendingRow[]>([]);
  const [pendingEnrichCount, setPendingEnrichCount] = useState<number>(0);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [defaultLeadDraft, setDefaultLeadDraft] = useState("");
  const [leadSaveBusy, setLeadSaveBusy] = useState(false);
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
      setPendingRows(data.pendingRows ?? []);
      setPendingEnrichCount(data.pendingEnrichCount ?? 0);
      setHistoryLoaded(true);
    } catch {
      // silent
    }
  };

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
        const d = data.partner?.defaultLeadTimeDays;
        setDefaultLeadDraft(d != null ? String(d) : "");
        loadHistory();
      }
    };
    load();
  }, [router]);

  const saveDefaultLeadTime = async (override?: { defaultLeadTimeDays: number | null }) => {
    setLeadSaveBusy(true);
    setError(null);
    try {
      let body: { defaultLeadTimeDays: number | null };
      if (override) {
        body = { defaultLeadTimeDays: override.defaultLeadTimeDays };
      } else {
        const trimmed = defaultLeadDraft.trim();
        if (trimmed === "") {
          body = { defaultLeadTimeDays: null };
        } else {
          const n = Number.parseInt(trimmed, 10);
          if (!Number.isFinite(n) || n < 0 || n > 365) {
            throw new Error("Lead time must be a whole number from 0 to 365 days.");
          }
          body = { defaultLeadTimeDays: n };
        }
      }
      const res = await fetch("/api/partners/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Save failed");
      setPartner(data.partner);
      const d = data.partner?.defaultLeadTimeDays;
      setDefaultLeadDraft(d != null ? String(d) : "");
    } catch (err: any) {
      setError(err.message ?? "Save failed");
    } finally {
      setLeadSaveBusy(false);
    }
  };

  const clearDefaultLeadTime = () => saveDefaultLeadTime({ defaultLeadTimeDays: null });

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
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/partners/uploads", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setUploadResult(data.result ?? data);
      loadHistory();
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
      const res = await fetch(`/api/partners/enrich?mode=new&debug=1&force=${force ? 1 : 0}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Enrich failed");
      setEnrichLog(JSON.stringify(data.results ?? [], null, 2));
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

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-semibold text-slate-900">Galaxus lead time (account default)</div>
        <p className="mt-1 text-xs text-slate-500">
          Used for supplier orders (including direct delivery) when a product has no per-variant lead time. Leave empty
          to use the system default configured on the server.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-600">
            Default days to ship
            <input
              type="number"
              min={0}
              max={365}
              className="mt-1 block w-32 rounded border border-slate-200 px-2 py-2 text-sm"
              placeholder="e.g. 5"
              value={defaultLeadDraft}
              onChange={(e) => setDefaultLeadDraft(e.target.value)}
              disabled={leadSaveBusy}
            />
          </label>
          <button
            type="button"
            className="rounded-full bg-[#55b3f3] px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
            onClick={() => saveDefaultLeadTime()}
            disabled={leadSaveBusy}
          >
            {leadSaveBusy ? "Saving…" : "Save default"}
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-200 px-4 py-2 text-xs text-slate-600"
            onClick={() => clearDefaultLeadTime()}
            disabled={leadSaveBusy}
          >
            Clear (use system default)
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Override per SKU in Catalog → Full edit → &quot;Lead time to ship (days)&quot;.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">Catalog</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{catalogCount}</div>
          <div className="text-xs text-slate-500">Total products in DB</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">Enrichment Queue</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{pendingEnrichCount}</div>
          <div className="text-xs text-slate-500">New products waiting to enrich</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-400">GTIN Inbox</div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">{pendingRows.length}</div>
          <div className="text-xs text-slate-500">Rows needing GTIN resolution</div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <button
          className="rounded-2xl border border-slate-200 bg-white px-4 py-5 text-left transition hover:border-[#55b3f3]"
          onClick={() => router.push("/partners/catalog")}
        >
          <div className="text-xs uppercase tracking-wide text-slate-400">Catalog Management</div>
          <div className="mt-2 text-lg font-semibold text-slate-900">Open Catalog</div>
          <div className="text-xs text-slate-500">Edit prices, stock, and full product data.</div>
        </button>
        <button
          className="rounded-2xl border border-slate-200 bg-white px-4 py-5 text-left transition hover:border-[#55b3f3]"
          onClick={() => router.push("/partners/gtin-inbox")}
        >
          <div className="text-xs uppercase tracking-wide text-slate-400">GTIN Inbox</div>
          <div className="mt-2 text-lg font-semibold text-slate-900">Resolve GTINs</div>
          <div className="text-xs text-slate-500">Handle missing and ambiguous GTINs.</div>
        </button>
        <button
          className="rounded-2xl border border-slate-200 bg-white px-4 py-5 text-left transition hover:border-[#55b3f3]"
          onClick={() => router.push("/partners/orders")}
        >
          <div className="text-xs uppercase tracking-wide text-slate-400">Orders</div>
          <div className="mt-2 text-lg font-semibold text-slate-900">Fulfillment</div>
          <div className="text-xs text-slate-500">Confirm tracking and ship items.</div>
        </button>
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
              {busy ? "Uploading…" : "Upload CSV"}
            </button>
          </div>
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
              Run after upload to resolve GTINs via KickDB for new rows. Force re-enrich runs lookup again (slower). If
              you fix a SKU in Catalog, the GTIN inbox and this dashboard read the same live catalog row (refresh the page
              if you have it open).
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-full bg-[#55b3f3] px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
              onClick={() => enrichPending(false)}
              disabled={busy}
            >
              Enrich new products
            </button>
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

      {pendingRows.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="text-sm font-semibold text-slate-900">
            Pending GTIN Resolution ({pendingRows.length})
          </div>
          <div className="text-xs text-slate-500">
            These rows need GTIN resolution before they appear in exports. Go to{" "}
            <button className="text-[#55b3f3] underline" onClick={() => router.push("/partners/gtin-inbox")}>
              GTIN Inbox
            </button>{" "}
            to resolve them.
          </div>
          <div className="overflow-auto rounded border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-2 py-1 text-left">SKU</th>
                  <th className="px-2 py-1 text-left">Size</th>
                  <th className="px-2 py-1 text-right">Stock</th>
                  <th className="px-2 py-1 text-right">Price</th>
                  <th className="px-2 py-1 text-left">Status</th>
                  <th className="px-2 py-1 text-left">Updated</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-1 font-mono">{r.sku}</td>
                    <td className="px-2 py-1">{r.sizeRaw}</td>
                    <td className="px-2 py-1 text-right">{r.rawStock}</td>
                    <td className="px-2 py-1 text-right">{r.price}</td>
                    <td className="px-2 py-1">
                      <span className={r.status === "PENDING_GTIN" ? "text-amber-700" : "text-orange-600"}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      {r.updatedAt ? new Date(r.updatedAt).toLocaleString() : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
