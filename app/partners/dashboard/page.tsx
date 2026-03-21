"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type PartnerInfo = {
  id: string;
  key: string;
  name: string;
};

type UploadResult = {
  uploadId?: string;
  importedRows?: number;
  errorRows?: number;
  errors?: Array<{ row: number; field: string; message: string }>;
  rows?: Array<{ row: number; status: "RESOLVED" | "PENDING_GTIN" | "ERROR"; gtin?: string | null; error?: string }>;
};

type CatalogRow = {
  supplierVariantId: string;
  providerKey: string;
  supplierSku: string;
  gtin: string;
  sizeRaw: string;
  price: string | number;
  stock: number;
  lastSyncAt: string | null;
  updatedAt: string | null;
  mappingStatus: string;
  kickdbBrand: string;
  kickdbName: string;
  kickdbImageUrl: string;
  supplierProductName: string;
  supplierBrand: string;
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


const TEMPLATE_HEADERS = [
  "providerKey",
  "sku",
  "size",
  "rawStock",
  "price",
];

export default function PartnerDashboardPage() {
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [enrichLog, setEnrichLog] = useState<string | null>(null);
  const [pushKeysInput, setPushKeysInput] = useState<string>("");
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [catalogCount, setCatalogCount] = useState<number>(0);
  const [catalogNextOffset, setCatalogNextOffset] = useState<number | null>(null);
  const [uploadHistory, setUploadHistory] = useState<UploadLog[]>([]);
  const [pendingRows, setPendingRows] = useState<PendingRow[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [editStock, setEditStock] = useState<Record<string, string>>({});
  const [editPrice, setEditPrice] = useState<Record<string, string>>({});
  const [pushBusy, setPushBusy] = useState(false);
  const [pushLog, setPushLog] = useState<string | null>(null);
  const router = useRouter();

  const loadHistory = async (offset = 0) => {
    try {
      const res = await fetch(
        `/api/partners/uploads/history?limit=100&offset=${offset}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok) return;
      setCatalog(data.catalog ?? []);
      setCatalogCount(data.catalogCount ?? 0);
      setCatalogNextOffset(data.nextOffset ?? null);
      setUploadHistory(data.uploads ?? []);
      setPendingRows(data.pendingRows ?? []);
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
        loadHistory();
      }
    };
    load();
  }, [router]);

  const logout = async () => {
    await fetch("/api/partners/auth/logout", { method: "POST" });
    router.push("/partners/login");
    router.refresh();
  };

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

  const enrichAll = async (force = false) => {
    setBusy(true);
    setError(null);
    setEnrichLog(null);
    try {
      const res = await fetch(`/api/partners/enrich?all=1&debug=1&force=${force ? 1 : 0}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Enrich failed");
      setEnrichLog(JSON.stringify(data.results ?? [], null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const pushToGalaxusNow = async (mode: "all" | "offer-stock", providerKeys?: string[]) => {
    if (!partner?.key) {
      setError("Partner key missing.");
      return;
    }
    setPushBusy(true);
    setError(null);
    setPushLog(null);
    try {
      const supplier = partner.key.trim().toLowerCase();
      const partnerRes = await fetch("/api/galaxus/partners/sync?all=1", {
        method: "POST",
        cache: "no-store",
      });
      const partnerData = await partnerRes.json().catch(() => ({}));
      if (!partnerRes.ok || !partnerData.ok) {
        throw new Error(partnerData?.error ?? "Partner sync failed");
      }
      const providerKeysParam =
        providerKeys && providerKeys.length > 0
          ? `&providerKeys=${encodeURIComponent(providerKeys.join(","))}`
          : "";
      const uploadRes = await fetch(
        `/api/galaxus/feeds/upload?type=${mode}&supplier=${encodeURIComponent(supplier)}&all=1${providerKeysParam}`,
        {
          method: "POST",
          cache: "no-store",
        }
      );
      const uploadData = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok || !uploadData.ok) {
        throw new Error(uploadData?.error ?? "Galaxus upload failed");
      }
      setPushLog(JSON.stringify({ partner: partnerData, upload: uploadData }, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPushBusy(false);
    }
  };

  const updateCatalogRow = async (row: CatalogRow) => {
    setBusy(true);
    setError(null);
    try {
      const stock = editStock[row.supplierVariantId] ?? String(row.stock ?? 0);
      const price = editPrice[row.supplierVariantId] ?? String(row.price ?? "");
      const res = await fetch(`/api/partners/variants/${encodeURIComponent(row.supplierVariantId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stock, price }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Update failed");
      await loadHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeCatalogRow = async (row: CatalogRow) => {
    if (!confirm(`Remove ${row.supplierSku} (${row.sizeRaw})?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partners/variants/${encodeURIComponent(row.supplierVariantId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Delete failed");
      await loadHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Partner Dashboard</h1>
        <p className="text-sm text-gray-500">
          {partner ? `${partner.name} (${partner.key})` : "Loading partner…"}
        </p>
      </div>
      <div>
        <button
          className="px-3 py-2 rounded bg-gray-200 text-black text-xs"
          onClick={logout}
        >
          Sign out
        </button>
        <button
          className="ml-2 px-3 py-2 rounded bg-gray-100 text-black text-xs"
          onClick={() => router.push("/partners/gtin-inbox")}
        >
          GTIN Inbox
        </button>
        <button
          className="ml-2 px-3 py-2 rounded bg-gray-100 text-black text-xs"
          onClick={() => router.push("/partners/orders")}
        >
          Fulfillment
        </button>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="border rounded bg-white p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Catalog Upload</div>
            <div className="text-xs text-gray-500">Upload your CSV catalog in the template format.</div>
          </div>
          <button
            className="px-3 py-2 rounded bg-gray-100 text-black"
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
            className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
            onClick={uploadCsv}
            disabled={busy}
          >
            {busy ? "Uploading…" : "Upload CSV"}
          </button>
        </div>

        {uploadResult && (
          <div className="space-y-2 text-xs text-gray-700">
            <div>
              Imported: {uploadResult.importedRows ?? 0}, Errors: {uploadResult.errorRows ?? 0}
            </div>
            {uploadResult.rows && uploadResult.rows.length > 0 && (
              <div className="overflow-auto border rounded bg-gray-50">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-100">
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

      <div className="border rounded bg-white p-4 space-y-3">
        <div className="text-sm font-medium">Enrichment</div>
        <div className="flex gap-2">
          <button
            className="px-3 py-2 rounded bg-green-600 text-white disabled:opacity-50"
            onClick={() => enrichAll(false)}
            disabled={busy}
          >
            Enrich GTIN
          </button>
          <button
            className="px-3 py-2 rounded bg-green-100 text-green-900 disabled:opacity-50"
            onClick={() => enrichAll(true)}
            disabled={busy}
          >
            Enrich GTIN (force)
          </button>
        </div>
        {enrichLog && (
          <div className="border rounded bg-gray-50 p-3 text-xs overflow-auto whitespace-pre-wrap">
            {enrichLog}
          </div>
        )}
      </div>

      <div className="border rounded bg-white p-4 space-y-3">
        <div className="text-sm font-medium">Fast Push to Galaxus</div>
        <div className="text-xs text-gray-500">
          Sync partner catalog and upload feeds immediately (skip cron).
        </div>
        <div className="space-y-2">
          <div className="text-xs text-gray-500">
            Optional: paste ProviderKeys (one per line) to push only those rows.
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="px-2 py-1 rounded bg-gray-100 text-xs"
              onClick={() => {
                const keys = catalog.map((row) => row.providerKey).filter(Boolean);
                setPushKeysInput(keys.join("\n"));
              }}
              disabled={busy || pushBusy || catalog.length === 0}
            >
              Use all catalog keys
            </button>
            <button
              className="px-2 py-1 rounded bg-gray-100 text-xs"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(pushKeysInput);
                } catch {
                  // ignore clipboard errors
                }
              }}
              disabled={busy || pushBusy || !pushKeysInput.trim()}
            >
              Copy keys
            </button>
          </div>
          <textarea
            className="w-full border rounded px-2 py-1 text-xs font-mono"
            rows={3}
            placeholder="NER_1234567890123&#10;THE_1234567890123"
            value={pushKeysInput}
            onChange={(e) => setPushKeysInput(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <button
            className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
            onClick={() =>
              pushToGalaxusNow(
                "all",
                pushKeysInput
                  .split(/[\n,]+/)
                  .map((value) => value.trim())
                  .filter(Boolean)
              )
            }
            disabled={busy || pushBusy}
          >
            {pushBusy ? "Pushing…" : "Push Master + Specs + Offer/Stock"}
          </button>
          <button
            className="px-3 py-2 rounded bg-indigo-100 text-indigo-900 disabled:opacity-50"
            onClick={() =>
              pushToGalaxusNow(
                "offer-stock",
                pushKeysInput
                  .split(/[\n,]+/)
                  .map((value) => value.trim())
                  .filter(Boolean)
              )
            }
            disabled={busy || pushBusy}
          >
            Push Offer/Stock only
          </button>
        </div>
        {pushLog && (
          <div className="border rounded bg-gray-50 p-3 text-xs overflow-auto whitespace-pre-wrap">
            {pushLog}
          </div>
        )}
      </div>

      {/* ─── Upload History ─── */}
      <div className="border rounded bg-white p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Upload History</div>
            <div className="text-xs text-gray-500">
              Past CSV uploads and their status.
            </div>
          </div>
          <button
            className="px-3 py-2 rounded bg-gray-100 text-black text-xs"
            onClick={() => loadHistory()}
            disabled={busy}
          >
            Refresh
          </button>
        </div>

        {uploadHistory.length === 0 && historyLoaded && (
          <div className="text-xs text-gray-400">No uploads yet.</div>
        )}

        {uploadHistory.length > 0 && (
          <div className="overflow-auto border rounded bg-gray-50">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-100">
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
                            ? "text-green-700"
                            : u.status === "FAILED"
                            ? "text-red-600"
                            : u.status === "COMPLETED_WITH_ERRORS"
                            ? "text-yellow-700"
                            : "text-gray-600"
                        }
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right">{u.totalRows}</td>
                    <td className="px-2 py-1 text-right">{u.importedRows}</td>
                    <td className="px-2 py-1 text-right">
                      {u.errorRows > 0 ? (
                        <span className="text-red-600">{u.errorRows}</span>
                      ) : (
                        u.errorRows
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Pending GTIN Rows ─── */}
      {pendingRows.length > 0 && (
        <div className="border rounded bg-white p-4 space-y-3">
          <div className="text-sm font-medium">
            Pending GTIN Resolution ({pendingRows.length})
          </div>
          <div className="text-xs text-gray-500">
            These rows need GTIN resolution before they appear in exports. Go to{" "}
            <button
              className="underline text-blue-600"
              onClick={() => router.push("/partners/gtin-inbox")}
            >
              GTIN Inbox
            </button>{" "}
            to resolve them.
          </div>
          <div className="overflow-auto border rounded bg-gray-50">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-100">
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
                      <span
                        className={
                          r.status === "PENDING_GTIN"
                            ? "text-yellow-700"
                            : "text-orange-600"
                        }
                      >
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

      {/* ─── My Catalog in DB ─── */}
      <div className="border rounded bg-white p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">
              My Catalog ({catalogCount} variants)
            </div>
            <div className="text-xs text-gray-500">
              Products currently in the system under your supplier key.
            </div>
          </div>
          <button
            className="px-3 py-2 rounded bg-gray-100 text-black text-xs"
            onClick={() => loadHistory()}
            disabled={busy}
          >
            Refresh
          </button>
        </div>

        {catalog.length === 0 && historyLoaded && (
          <div className="text-xs text-gray-400">
            No products in DB yet. Upload a CSV above.
          </div>
        )}

        {catalog.length > 0 && (
          <div className="overflow-auto border rounded bg-gray-50">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-2 py-1 text-left">Variant ID</th>
                  <th className="px-2 py-1 text-left">SKU</th>
                  <th className="px-2 py-1 text-left">GTIN</th>
                  <th className="px-2 py-1 text-left">Size</th>
                  <th className="px-2 py-1 text-right">Price</th>
                  <th className="px-2 py-1 text-right">Stock</th>
                  <th className="px-2 py-1 text-left">Mapping</th>
                  <th className="px-2 py-1 text-left">KickDB Name</th>
                  <th className="px-2 py-1 text-left">Brand</th>
                  <th className="px-2 py-1 text-left">Image</th>
                  <th className="px-2 py-1 text-left">Updated</th>
                  <th className="px-2 py-1 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((row) => (
                  <tr key={row.supplierVariantId} className="border-t align-top">
                    <td className="px-2 py-1 font-mono">{row.supplierVariantId}</td>
                    <td className="px-2 py-1">{row.supplierSku}</td>
                    <td className="px-2 py-1 font-mono">{row.gtin}</td>
                    <td className="px-2 py-1">{row.sizeRaw}</td>
                    <td className="px-2 py-1 text-right">
                      <input
                        className="w-20 border rounded px-1 py-0.5 text-right"
                        value={editPrice[row.supplierVariantId] ?? String(row.price ?? "")}
                        onChange={(e) =>
                          setEditPrice((prev) => ({
                            ...prev,
                            [row.supplierVariantId]: e.target.value,
                          }))
                        }
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <input
                        className="w-16 border rounded px-1 py-0.5 text-right"
                        value={editStock[row.supplierVariantId] ?? String(row.stock ?? 0)}
                        onChange={(e) =>
                          setEditStock((prev) => ({
                            ...prev,
                            [row.supplierVariantId]: e.target.value,
                          }))
                        }
                      />
                    </td>
                    <td className="px-2 py-1">
                      <span
                        className={
                          row.mappingStatus === "MATCHED"
                            ? "text-green-700"
                            : row.mappingStatus === "NO_MAPPING"
                            ? "text-red-600"
                            : "text-yellow-700"
                        }
                      >
                        {row.mappingStatus}
                      </span>
                    </td>
                    <td className="px-2 py-1">{row.kickdbName || row.supplierProductName || ""}</td>
                    <td className="px-2 py-1">{row.kickdbBrand || row.supplierBrand || ""}</td>
                    <td className="px-2 py-1">
                      {row.kickdbImageUrl ? (
                        <a
                          className="underline text-blue-600"
                          href={row.kickdbImageUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          view
                        </a>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : ""}
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex gap-2">
                        <button
                          className="px-2 py-1 text-xs rounded bg-blue-600 text-white disabled:opacity-50"
                          onClick={() => updateCatalogRow(row)}
                          disabled={busy}
                        >
                          Save
                        </button>
                        <button
                          className="px-2 py-1 text-xs rounded bg-red-100 text-red-700 disabled:opacity-50"
                          onClick={() => removeCatalogRow(row)}
                          disabled={busy}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {catalogNextOffset !== null && (
          <button
            className="px-3 py-2 rounded bg-gray-100 text-black text-xs"
            onClick={() => loadHistory(catalogNextOffset)}
            disabled={busy}
          >
            Load more
          </button>
        )}
      </div>

    </div>
  );
}
