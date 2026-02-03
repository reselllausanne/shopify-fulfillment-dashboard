"use client";

import { useState } from "react";

type PreviewItem = {
  supplierVariantId: string;
  supplierSku: string;
  price: number | null;
  stock: number | null;
  sizeRaw: string | null;
  productName: string;
  brand: string;
  sizeUs: string;
  sizeEu: string | null;
  barcode: string | null;
};

type SupplierVariant = {
  supplierVariantId: string;
  supplierSku: string;
  price: string;
  stock: number;
  sizeRaw: string | null;
  images: unknown;
  leadTimeDays: number | null;
  updatedAt: string;
};

type EnrichDebugInfo = {
  reason?: string;
  query?: string;
  productName?: string | null;
  raw?: boolean;
  rawSearch?: unknown;
  rawProduct?: unknown;
  searchMeta?: { total?: number };
  searchTop?: { id?: string; slug?: string; title?: string; sku?: string } | null;
  productSummary?: { id?: string; slug?: string; title?: string; sku?: string; variantCount?: number } | null;
  matchedVariant?: { id?: string; size?: string; size_us?: string; size_eu?: string } | null;
  variantSizes?: string[];
  error?: string;
};

type EnrichResult = {
  supplierVariantId: string;
  status: string;
  gtin?: string | null;
  error?: string;
  debug?: EnrichDebugInfo;
};

export default function GalaxusDashboardPage() {
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [dbItems, setDbItems] = useState<SupplierVariant[]>([]);
  const [dbNextOffset, setDbNextOffset] = useState<number | null>(null);
  const [enrichResults, setEnrichResults] = useState<EnrichResult[]>([]);
  const [enrichDebugRaw, setEnrichDebugRaw] = useState<string | null>(null);
  const [batchLimit, setBatchLimit] = useState<number>(100);
  const [batchOffset, setBatchOffset] = useState<number>(0);
  const [supplierFilter, setSupplierFilter] = useState<string>("golden");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportCheckReport, setExportCheckReport] = useState<string | null>(null);

  const fetchPreview = async () => {
    setBusy("preview");
    setError(null);
    try {
      const response = await fetch(`/api/galaxus/supplier/preview?limit=${batchLimit}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Preview failed");
      setPreview(data.items ?? []);
      setPreviewTotal(data.total ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const syncSupplier = async () => {
    setBusy("sync");
    setError(null);
    try {
      const response = await fetch(
        `/api/galaxus/supplier/sync?limit=${batchLimit}&offset=${batchOffset}`,
        { method: "POST" }
      );
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Sync failed");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const loadDb = async (offset = 0) => {
    setBusy("db");
    setError(null);
    try {
      const response = await fetch(
        `/api/galaxus/supplier/variants?limit=${batchLimit}&offset=${offset}`,
        {
          cache: "no-store",
        }
      );
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Load DB failed");
      setDbItems(data.items ?? []);
      setDbNextOffset(data.nextOffset ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const enrichKickDb = async (debug = false, force = false) => {
    setBusy("enrich");
    setError(null);
    try {
      const response = await fetch(
        `/api/galaxus/kickdb/enrich?limit=${batchLimit}&offset=${batchOffset}&debug=${debug ? 1 : 0}&force=${force ? 1 : 0}`,
        {
          method: "POST",
        }
      );
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Enrich failed");
      setEnrichResults(data.results ?? []);
      setEnrichDebugRaw(debug ? JSON.stringify(data.results ?? [], null, 2) : null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const exportAllWithChecks = async () => {
    setBusy("export-check");
    setError(null);
    setExportCheckReport(null);
    const supplierValue = encodeURIComponent(supplierFilter);
    const exportUrls = [
      `/api/galaxus/export/master?limit=${batchLimit}&offset=${batchOffset}&supplier=${supplierValue}`,
      `/api/galaxus/export/stock?limit=${batchLimit}&offset=${batchOffset}&supplier=${supplierValue}`,
      `/api/galaxus/export/specifications?limit=${batchLimit}&offset=${batchOffset}&supplier=${supplierValue}`,
    ];
    exportUrls.forEach((url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    });
    try {
      const response = await fetch(
        `/api/galaxus/export/check-all?limit=${batchLimit}&offset=${batchOffset}&supplier=${supplierValue}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Export checks failed");
      setExportCheckReport(JSON.stringify(data.report ?? {}, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Galaxus Supplier Dashboard</h1>
        <p className="text-sm text-gray-500">
          Preview supplier data, sync to DB, and inspect saved variants.
        </p>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="flex gap-3 flex-wrap items-center">
        <button
          className="px-3 py-2 rounded bg-black text-white disabled:opacity-50"
          onClick={fetchPreview}
          disabled={busy !== null}
        >
          {busy === "preview" ? "Loading…" : "Fetch Supplier Preview"}
        </button>
        <button
          className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
          onClick={syncSupplier}
          disabled={busy !== null}
        >
          {busy === "sync" ? "Syncing…" : "Sync Catalog + Stock"}
        </button>
        <button
          className="px-3 py-2 rounded bg-gray-200 text-black disabled:opacity-50"
          onClick={() => loadDb(0)}
          disabled={busy !== null}
        >
          {busy === "db" ? "Loading…" : "Load DB Variants"}
        </button>
        <button
          className="px-3 py-2 rounded bg-green-600 text-white disabled:opacity-50"
          onClick={() => enrichKickDb(false, false)}
          disabled={busy !== null}
        >
          {busy === "enrich" ? "Enriching…" : "Enrich GTIN (KickDB)"}
        </button>
        <button
          className="px-3 py-2 rounded bg-green-100 text-green-900 disabled:opacity-50"
          onClick={() => enrichKickDb(true, true)}
          disabled={busy !== null}
        >
          {busy === "enrich" ? "Enriching…" : "Enrich GTIN (Debug + Force)"}
        </button>
        <input
          className="px-2 py-2 border rounded text-sm w-24"
          type="number"
          min={1}
          max={500}
          value={batchLimit}
          onChange={(event) => setBatchLimit(Number(event.target.value || 0))}
          placeholder="Limit"
        />
        <input
          className="px-2 py-2 border rounded text-sm w-24"
          type="number"
          min={0}
          value={batchOffset}
          onChange={(event) => setBatchOffset(Number(event.target.value || 0))}
          placeholder="Offset"
        />
        <input
          className="px-2 py-2 border rounded text-sm w-28"
          value={supplierFilter}
          onChange={(event) => setSupplierFilter(event.target.value)}
          placeholder="Supplier key"
        />
        <button
          className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
          onClick={exportAllWithChecks}
          disabled={busy !== null}
        >
          {busy === "export-check" ? "Exporting…" : "Export All + Run Checks"}
        </button>
        <a
          className="px-3 py-2 rounded bg-indigo-600 text-white"
          href={`/api/galaxus/export/master?limit=${batchLimit}&offset=${batchOffset}&supplier=${encodeURIComponent(supplierFilter)}`}
          target="_blank"
          rel="noreferrer"
        >
          Export Master CSV
        </a>
        <a
          className="px-3 py-2 rounded bg-indigo-100 text-indigo-900"
          href={`/api/galaxus/export/stock?limit=${batchLimit}&offset=${batchOffset}&supplier=${encodeURIComponent(supplierFilter)}`}
          target="_blank"
          rel="noreferrer"
        >
          Export Stock CSV
        </a>
        <a
          className="px-3 py-2 rounded bg-indigo-50 text-indigo-900"
          href={`/api/galaxus/export/specifications?limit=${batchLimit}&offset=${batchOffset}&supplier=${encodeURIComponent(supplierFilter)}`}
          target="_blank"
          rel="noreferrer"
        >
          Export Specs CSV
        </a>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">
          Supplier Preview {previewTotal !== null ? `(${preview.length} of ${previewTotal})` : ""}
        </div>
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left">Variant ID</th>
                <th className="px-2 py-1 text-left">SKU</th>
                <th className="px-2 py-1 text-left">Product</th>
                <th className="px-2 py-1 text-left">Size</th>
                <th className="px-2 py-1 text-left">GTIN</th>
                <th className="px-2 py-1 text-right">Price</th>
                <th className="px-2 py-1 text-right">Stock</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((item) => (
                <tr key={item.supplierVariantId} className="border-t">
                  <td className="px-2 py-1">{item.supplierVariantId}</td>
                  <td className="px-2 py-1">{item.supplierSku}</td>
                  <td className="px-2 py-1">{item.productName}</td>
                  <td className="px-2 py-1">{item.sizeEu ?? item.sizeUs}</td>
                  <td className="px-2 py-1">{item.barcode ?? ""}</td>
                  <td className="px-2 py-1 text-right">{item.price ?? ""}</td>
                  <td className="px-2 py-1 text-right">{item.stock ?? ""}</td>
                </tr>
              ))}
              {preview.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-gray-500" colSpan={7}>
                    No preview loaded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">DB Variants</div>
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left">Variant ID</th>
                <th className="px-2 py-1 text-left">SKU</th>
                <th className="px-2 py-1 text-left">Size</th>
                <th className="px-2 py-1 text-right">Price</th>
                <th className="px-2 py-1 text-right">Stock</th>
                <th className="px-2 py-1 text-left">Updated</th>
              </tr>
            </thead>
            <tbody>
              {dbItems.map((item) => (
                <tr key={item.supplierVariantId} className="border-t">
                  <td className="px-2 py-1">{item.supplierVariantId}</td>
                  <td className="px-2 py-1">{item.supplierSku}</td>
                  <td className="px-2 py-1">{item.sizeRaw ?? ""}</td>
                  <td className="px-2 py-1 text-right">{item.price}</td>
                  <td className="px-2 py-1 text-right">{item.stock}</td>
                  <td className="px-2 py-1">{new Date(item.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
              {dbItems.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-gray-500" colSpan={6}>
                    No DB data loaded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {dbNextOffset !== null && (
          <button
            className="px-3 py-2 rounded bg-gray-100 text-black"
            onClick={() => loadDb(dbNextOffset)}
            disabled={busy !== null}
          >
            Load Next Page
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Enrichment Results</div>
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left">Variant ID</th>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-left">GTIN</th>
                <th className="px-2 py-1 text-left">Reason</th>
                <th className="px-2 py-1 text-left">Query</th>
                <th className="px-2 py-1 text-left">Product</th>
              </tr>
            </thead>
            <tbody>
              {enrichResults.map((item) => (
                <tr key={item.supplierVariantId} className="border-t">
                  <td className="px-2 py-1">{item.supplierVariantId}</td>
                  <td className="px-2 py-1">{item.status}</td>
                  <td className="px-2 py-1">{item.gtin ?? ""}</td>
                  <td className="px-2 py-1">{item.debug?.reason ?? item.error ?? ""}</td>
                  <td className="px-2 py-1">{item.debug?.query ?? ""}</td>
                  <td className="px-2 py-1">
                    {item.debug?.productSummary?.title ?? item.debug?.searchTop?.title ?? ""}
                  </td>
                </tr>
              ))}
              {enrichResults.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-gray-500" colSpan={6}>
                    No enrichment run yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {enrichDebugRaw && (
          <div className="border rounded bg-gray-50 p-3 text-xs overflow-auto whitespace-pre-wrap">
            {enrichDebugRaw}
          </div>
        )}
      </div>

      {exportCheckReport && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Export Check Report</div>
          <div className="border rounded bg-gray-50 p-3 text-xs overflow-auto whitespace-pre-wrap">
            {exportCheckReport}
          </div>
        </div>
      )}
    </div>
  );
}
