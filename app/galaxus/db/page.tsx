"use client";

import { useMemo, useState } from "react";

type CatalogRow = any;

export default function GalaxusDbPage() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [items, setItems] = useState<CatalogRow[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [showJson, setShowJson] = useState(false);

  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const row of items) {
      for (const key of Object.keys(row ?? {})) keys.add(key);
    }
    const baseFirst = [
      "supplierVariantId",
      "supplierSku",
      "providerKey",
      "gtin",
      "price",
      "stock",
      "manualLock",
      "manualPrice",
      "manualStock",
      "supplierBrand",
      "supplierProductName",
      "sizeNormalized",
      "sizeRaw",
      "deliveryType",
      "leadTimeDays",
    ];
    const rest = Array.from(keys).filter((k) => !baseFirst.includes(k)).sort();
    return [...baseFirst.filter((k) => keys.has(k)), ...rest];
  }, [items]);

  const load = async (offset: number) => {
    setLoading(true);
    setError(null);
    setLog(null);
    try {
      const trimmedQ = q.trim();
      const supplierKeyFromQ =
        (trimmedQ.endsWith("_") || trimmedQ.endsWith(":")) && trimmedQ.length >= 3
          ? trimmedQ.replace(/[:_]+$/g, "")
          : "";
      const params = new URLSearchParams();
      params.set("limit", "200");
      params.set("offset", String(offset));
      if (supplierKeyFromQ) {
        params.set("supplierKey", supplierKeyFromQ);
      } else if (trimmedQ) {
        params.set("q", trimmedQ);
      }
      const res = await fetch(`/api/galaxus/db/catalog?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Failed to load DB rows");
      setItems(data.items ?? []);
      setNextOffset(data.nextOffset ?? null);
      setLog(`Loaded ${data.items?.length ?? 0} rows.`);
    } catch (err: any) {
      setError(err.message ?? "Failed to load DB rows");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">View DB</h1>
        <div className="text-sm text-gray-500">
          Read-only overview of all stored fields per product (SupplierVariant + mappings + KickDB).
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="px-3 py-2 rounded bg-gray-100 text-black" href="/galaxus/pricing">
            Pricing
          </a>
        </div>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {log ? <div className="text-xs text-gray-600">{log}</div> : null}
      {items.length > 0 ? (
        <div className="text-xs text-gray-500">
          Columns in view: {columns.length}
        </div>
      ) : null}

      <div className="rounded border bg-white p-3 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <div className="text-xs text-gray-500">Search</div>
          <input
            className="border rounded px-2 py-1 text-sm w-80"
            placeholder="supplierVariantId / providerKey / gtin / sku / name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={showJson} onChange={(e) => setShowJson(e.target.checked)} />
          Show JSON columns fully
        </label>
        <button
          className="px-3 py-2 rounded bg-gray-900 text-white disabled:opacity-50"
          onClick={() => load(0)}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load"}
        </button>
        <button
          className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
          onClick={() => nextOffset !== null && load(nextOffset)}
          disabled={loading || nextOffset === null}
        >
          Next page
        </button>
      </div>

      <div className="overflow-auto border rounded bg-white">
        <table className="min-w-[1400px] w-full text-[11px]">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              {columns.map((col) => (
                <th key={col} className="px-2 py-2 text-left whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((row, idx) => (
              <tr key={row?.supplierVariantId ?? idx} className="border-t">
                {columns.map((col) => {
                  const value = row?.[col];
                  const isObj = value && typeof value === "object";
                  const text = isObj
                    ? JSON.stringify(value)
                    : value === null || value === undefined
                      ? ""
                      : String(value);
                  const display = !showJson && isObj && text.length > 160 ? `${text.slice(0, 160)}…` : text;
                  return (
                    <td key={`${idx}-${col}`} className="px-2 py-1 align-top">
                      <div className="max-w-[520px] break-all">{display}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="px-2 py-6 text-center text-xs text-gray-500" colSpan={columns.length || 1}>
                  No rows loaded.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

