"use client";

import { useCallback, useEffect, useState } from "react";

export type InStockShipItem = {
  id: string;
  channel: "galaxus_direct" | "galaxus_warehouse" | "shopify";
  orderDbId: string;
  orderLabel: string;
  lineId: string;
  gtin: string;
  productName: string;
  size: string | null;
  remaining: number;
  stockQty: number;
  locationName: string;
  customerName: string | null;
  orderDate: string;
  localMatch: boolean;
};

type Props = {
  onPickGtin: (gtin: string) => void;
};

const CHANNEL_LABEL: Record<InStockShipItem["channel"], string> = {
  galaxus_direct: "GX direct",
  galaxus_warehouse: "GX WH",
  shopify: "Shopify",
};

const REFRESH_MS = 60_000;

export default function InStockShipPanel({ onPickGtin }: Props) {
  const [open, setOpen] = useState(true);
  const [items, setItems] = useState<InStockShipItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/scan-awb/in-stock-queue", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setItems(Array.isArray(json.items) ? json.items : []);
      setFetchedAt(json.fetchedAt ?? new Date().toISOString());
    } catch (err: any) {
      setError(err?.message ?? "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-3 top-1/3 z-40 rounded-l-lg border border-emerald-400 bg-emerald-600 px-2 py-3 text-xs font-semibold text-white shadow-lg hover:bg-emerald-700"
        title="Show in-stock to ship"
      >
        WH
        {items.length > 0 ? (
          <span className="mt-1 block rounded bg-white/20 px-1">{items.length}</span>
        ) : null}
      </button>
    );
  }

  return (
    <aside className="fixed right-2 top-20 bottom-4 z-40 flex w-[17.5rem] flex-col overflow-hidden rounded-lg border border-emerald-300 bg-white shadow-xl">
      <div className="flex items-start justify-between gap-2 border-b border-emerald-200 bg-emerald-50 px-3 py-2">
        <div>
          <div className="text-sm font-semibold text-emerald-950">In stock → ship</div>
          <div className="text-[10px] text-emerald-800">
            Galaxus local + Shopify WH · click GTIN
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            className="rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] text-emerald-900 hover:bg-emerald-100"
            title="Refresh"
          >
            ↻
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[10px] text-emerald-900 hover:bg-emerald-100"
            title="Hide"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading && items.length === 0 ? (
          <p className="px-1 text-xs text-gray-500">Loading…</p>
        ) : null}
        {error ? <p className="px-1 text-xs text-red-600">{error}</p> : null}
        {!loading && !error && items.length === 0 ? (
          <p className="px-1 text-xs text-gray-500">No WH/magasin pairs waiting.</p>
        ) : null}
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onPickGtin(item.gtin)}
                className="w-full rounded border border-emerald-200 bg-emerald-50/60 px-2 py-1.5 text-left hover:border-emerald-400 hover:bg-emerald-100"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                    {CHANNEL_LABEL[item.channel]}
                  </span>
                  <span className="truncate text-[10px] text-emerald-900" title={item.locationName}>
                    {item.locationName}
                    {item.stockQty > 0 ? ` · ×${item.stockQty}` : ""}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs font-medium text-gray-900" title={item.productName}>
                  {item.productName}
                  {item.size ? ` · ${item.size}` : ""}
                </div>
                <div className="mt-0.5 font-mono text-[11px] font-semibold text-blue-800">
                  {item.gtin}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-gray-600">
                  {item.orderLabel}
                  {item.customerName ? ` · ${item.customerName}` : ""}
                  {item.remaining > 1 ? ` · rem ${item.remaining}` : ""}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {fetchedAt ? (
        <div className="border-t border-emerald-100 px-2 py-1 text-[9px] text-gray-400">
          Updated {new Date(fetchedAt).toLocaleTimeString("fr-CH")} · auto 60s
        </div>
      ) : null}
    </aside>
  );
}
