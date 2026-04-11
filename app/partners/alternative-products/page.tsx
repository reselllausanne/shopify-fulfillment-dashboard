"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ALTERNATIVE_PRODUCT_ALLOWED_HEADERS,
  ALTERNATIVE_PRODUCT_OPTIONAL_HEADERS,
  ALTERNATIVE_PRODUCT_REQUIRED_HEADERS,
  ALTERNATIVE_PARTNER_KEY,
} from "@/app/lib/alternativeProducts";

type PartnerInfo = {
  id: string;
  key: string;
  name: string;
};

type UploadResult = {
  uploadId?: string;
  totalRows?: number;
  importedRows?: number;
  errorRows?: number;
  errors?: Array<{ row: number; field: string; message: string }>;
  warnings?: Array<{ row: number; field: string; message: string }>;
  rows?: Array<{ row: number; status: string; error?: string; warning?: string }>;
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

type AlternativeProductRow = {
  id: string;
  externalKey: string;
  gtin: string;
  providerKey: string;
  title: string;
  variantName?: string | null;
  size: string;
  stock: number;
  priceExVat: number | null;
  vatRate: number | null;
  currency: string;
  status: string;
  exportable: boolean;
  exportConflict?: { reason: string; normalPrice: number } | null;
  validationErrorsJson?: unknown;
};

export default function AlternativeProductsPage() {
  const router = useRouter();
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [replaceMode, setReplaceMode] = useState(false);
  const [uploadHistory, setUploadHistory] = useState<UploadLog[]>([]);
  const [products, setProducts] = useState<AlternativeProductRow[]>([]);

  const isAllowedPartner = useMemo(
    () => partner?.key?.toUpperCase() === ALTERNATIVE_PARTNER_KEY,
    [partner]
  );

  const templateHeaders = useMemo(() => ALTERNATIVE_PRODUCT_ALLOWED_HEADERS, []);

  const loadPartner = async () => {
    const res = await fetch("/api/partners/me", { cache: "no-store" });
    if (res.status === 401) {
      router.push("/partners/login");
      return;
    }
    const data = await res.json();
    if (data.ok) {
      setPartner(data.partner);
    }
  };

  const loadHistory = async () => {
    try {
      const res = await fetch("/api/partners/alternative-products/uploads/history", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) {
        setUploadHistory(data.uploads ?? []);
      }
    } catch {
      // ignore
    }
  };

  const loadProducts = async () => {
    try {
      const res = await fetch("/api/partners/alternative-products", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) {
        setProducts(data.items ?? []);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const init = async () => {
      await loadPartner();
      await loadHistory();
      await loadProducts();
    };
    init();
  }, []);

  const downloadTemplate = () => {
    const content = `${templateHeaders.join(",")}\n`;
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "alternative-products-template.csv";
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
      const modeParam = replaceMode ? "?mode=replace" : "";
      const res = await fetch(`/api/partners/alternative-products/uploads${modeParam}`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Upload failed");
      setUploadResult(data);
      await loadHistory();
      await loadProducts();
    } catch (err: any) {
      setError(err.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  if (partner && !isAllowedPartner) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        This view is available only for partner key {ALTERNATIVE_PARTNER_KEY}.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Alternative Products</h1>
        <p className="text-sm text-slate-500">
          Upload external pre-enriched products. These rows are appended to Galaxus and Decathlon exports.
        </p>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">CSV Upload</div>
            <div className="text-xs text-slate-500">
              Required headers: {ALTERNATIVE_PRODUCT_REQUIRED_HEADERS.join(", ")}.
            </div>
            <div className="text-xs text-slate-500">
              Optional headers: {ALTERNATIVE_PRODUCT_OPTIONAL_HEADERS.join(", ")}.
            </div>
            <div className="text-xs text-slate-500">
              `imageUrls` supports pipe-delimited URLs. `specsJson` must be a JSON object.
            </div>
          </div>
          <button
            className="rounded-full border border-slate-200 px-4 py-2 text-xs text-slate-600"
            onClick={downloadTemplate}
          >
            Download template
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={replaceMode}
              onChange={(event) => setReplaceMode(event.target.checked)}
            />
            Replace existing alternative products
          </label>
          <button
            className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
            onClick={uploadCsv}
            disabled={busy}
          >
            {busy ? "Uploading…" : "Upload CSV"}
          </button>
        </div>

        {uploadResult && (
          <div className="text-xs text-slate-600 space-y-2">
            <div>
              Upload {uploadResult.uploadId} — imported {uploadResult.importedRows} rows, errors{" "}
              {uploadResult.errorRows}.
            </div>
            {uploadResult.errors && uploadResult.errors.length > 0 && (
              <div className="rounded border border-red-100 bg-red-50 px-3 py-2 text-red-700">
                {uploadResult.errors.slice(0, 6).map((err) => (
                  <div key={`${err.row}-${err.field}`}>
                    Row {err.row}: {err.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
        <div className="text-sm font-semibold text-slate-900">Upload history</div>
        <div className="overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-2 py-1 text-left">Upload</th>
                <th className="px-2 py-1 text-left">Filename</th>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-right">Rows</th>
                <th className="px-2 py-1 text-right">Imported</th>
                <th className="px-2 py-1 text-right">Errors</th>
                <th className="px-2 py-1 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {uploadHistory.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-2 py-1">{row.id.slice(0, 8)}</td>
                  <td className="px-2 py-1">{row.filename}</td>
                  <td className="px-2 py-1">{row.status}</td>
                  <td className="px-2 py-1 text-right">{row.totalRows}</td>
                  <td className="px-2 py-1 text-right">{row.importedRows}</td>
                  <td className="px-2 py-1 text-right">{row.errorRows}</td>
                  <td className="px-2 py-1">{row.createdAt ?? ""}</td>
                </tr>
              ))}
              {uploadHistory.length === 0 && (
                <tr>
                  <td className="px-2 py-2 text-slate-500" colSpan={7}>
                    No uploads yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-900">Active alternative products</div>
          <button
            className="rounded-full border border-slate-200 px-4 py-2 text-xs text-slate-600"
            onClick={loadProducts}
          >
            Refresh
          </button>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-2 py-1 text-left">External</th>
                <th className="px-2 py-1 text-left">GTIN</th>
                <th className="px-2 py-1 text-left">ProviderKey</th>
                <th className="px-2 py-1 text-left">Title</th>
                <th className="px-2 py-1 text-left">Size</th>
                <th className="px-2 py-1 text-right">Stock</th>
                <th className="px-2 py-1 text-right">Price</th>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-left">Export</th>
              </tr>
            </thead>
            <tbody>
              {products.map((row) => (
                <tr key={row.id} className="border-t align-top">
                  <td className="px-2 py-1">{row.externalKey}</td>
                  <td className="px-2 py-1">{row.gtin}</td>
                  <td className="px-2 py-1">{row.providerKey}</td>
                  <td className="px-2 py-1">{row.title}</td>
                  <td className="px-2 py-1">{row.size}</td>
                  <td className="px-2 py-1 text-right">{row.stock}</td>
                  <td className="px-2 py-1 text-right">
                    {row.priceExVat?.toFixed?.(2) ?? row.priceExVat}
                  </td>
                  <td className="px-2 py-1">{row.status}</td>
                  <td className="px-2 py-1">
                    {row.exportable ? "Yes" : "No"}
                    {row.exportConflict && (
                      <div className="text-[10px] text-slate-500">
                        {row.exportConflict.reason} (normal {row.exportConflict.normalPrice})
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td className="px-2 py-2 text-slate-500" colSpan={9}>
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
