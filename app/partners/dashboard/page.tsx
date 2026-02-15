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
};


const TEMPLATE_HEADERS = [
  "partnerVariantId",
  "sku",
  "productName",
  "brand",
  "sizeRaw",
  "stock",
  "price",
  "imageUrls",
  "gtin",
];

export default function PartnerDashboardPage() {
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [enrichLog, setEnrichLog] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/partners/me", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/partners/login");
        return;
      }
      const data = await res.json();
      if (data.ok) setPartner(data.partner);
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
          <div className="text-xs text-gray-700">
            Imported: {uploadResult.importedRows ?? 0}, Errors: {uploadResult.errorRows ?? 0}
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

    </div>
  );
}
