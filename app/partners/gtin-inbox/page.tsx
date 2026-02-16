"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type InboxRow = {
  id: string;
  uploadId?: string | null;
  providerKey: string;
  sku: string;
  sizeRaw: string;
  sizeNormalized: string;
  rawStock: number;
  price: string;
  status: string;
  gtinResolved?: string | null;
  gtinCandidatesJson?: string[] | null;
  updatedAt: string;
};

export default function PartnerGtinInboxPage() {
  const router = useRouter();
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("PENDING_GTIN,AMBIGUOUS_GTIN");
  const [uploadIdFilter, setUploadIdFilter] = useState("");
  const [gtinInputs, setGtinInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/partners/me", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/partners/login");
        return;
      }
      await fetchRows();
    };
    load();
  }, [router]);

  const fetchRows = async () => {
    setBusy("load");
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (uploadIdFilter) params.set("uploadId", uploadIdFilter);
      const res = await fetch(`/api/partners/gtin-inbox?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Load failed");
      setRows(data.items ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const exportPending = () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    window.location.href = `/api/partners/gtin-inbox/export?${params.toString()}`;
  };

  const resolveRow = async (rowId: string) => {
    const gtin = gtinInputs[rowId]?.trim() ?? "";
    if (!gtin) {
      setError("Enter a GTIN first.");
      return;
    }
    setBusy(`resolve-${rowId}`);
    setError(null);
    try {
      const res = await fetch("/api/partners/gtin-inbox/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowId, gtin }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Resolve failed");
      await fetchRows();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const setCandidate = (rowId: string, candidate: string) => {
    setGtinInputs((prev) => ({ ...prev, [rowId]: candidate }));
  };

  const uploadBulk = async (file: File) => {
    setBusy("bulk");
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/partners/gtin-resolve", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Bulk resolve failed");
      await fetchRows();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">GTIN Inbox</h1>
        <p className="text-sm text-gray-500">Resolve missing or ambiguous GTINs.</p>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="px-2 py-2 border rounded text-sm w-64"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          placeholder="Statuses (comma-separated)"
        />
        <input
          className="px-2 py-2 border rounded text-sm w-64"
          value={uploadIdFilter}
          onChange={(event) => setUploadIdFilter(event.target.value)}
          placeholder="Upload ID filter"
        />
        <button className="px-3 py-2 rounded bg-gray-200" onClick={fetchRows} disabled={busy !== null}>
          {busy === "load" ? "Loading…" : "Apply"}
        </button>
        <button className="px-3 py-2 rounded bg-gray-100" onClick={exportPending} disabled={busy !== null}>
          Export pending GTIN
        </button>
        <label className="px-3 py-2 rounded bg-gray-100 cursor-pointer">
          Bulk resolve CSV
          <input
            type="file"
            className="hidden"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) uploadBulk(file);
            }}
          />
        </label>
      </div>

      <div className="overflow-auto border rounded bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-2 py-1 text-left">ProviderKey</th>
              <th className="px-2 py-1 text-left">SKU</th>
              <th className="px-2 py-1 text-left">Size</th>
              <th className="px-2 py-1 text-right">Stock</th>
              <th className="px-2 py-1 text-right">Price</th>
              <th className="px-2 py-1 text-left">Status</th>
              <th className="px-2 py-1 text-left">Candidates</th>
              <th className="px-2 py-1 text-left">Set GTIN</th>
              <th className="px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t align-top">
                <td className="px-2 py-1">{row.providerKey}</td>
                <td className="px-2 py-1">{row.sku}</td>
                <td className="px-2 py-1">{row.sizeRaw}</td>
                <td className="px-2 py-1 text-right">{row.rawStock}</td>
                <td className="px-2 py-1 text-right">{row.price}</td>
                <td className="px-2 py-1">{row.status}</td>
                <td className="px-2 py-1">
                  {Array.isArray(row.gtinCandidatesJson) &&
                    row.gtinCandidatesJson.map((candidate) => (
                      <button
                        key={candidate}
                        className="mr-2 underline text-blue-600"
                        onClick={() => setCandidate(row.id, candidate)}
                      >
                        {candidate}
                      </button>
                    ))}
                </td>
                <td className="px-2 py-1">
                  <input
                    className="px-2 py-1 border rounded text-xs w-40"
                    value={gtinInputs[row.id] ?? ""}
                    onChange={(event) =>
                      setGtinInputs((prev) => ({ ...prev, [row.id]: event.target.value }))
                    }
                    placeholder="GTIN"
                  />
                </td>
                <td className="px-2 py-1">
                  <button
                    className="px-2 py-1 rounded bg-blue-600 text-white"
                    onClick={() => resolveRow(row.id)}
                    disabled={busy !== null}
                  >
                    {busy === `resolve-${row.id}` ? "Saving…" : "Set"}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-gray-500" colSpan={9}>
                  No pending GTIN rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
