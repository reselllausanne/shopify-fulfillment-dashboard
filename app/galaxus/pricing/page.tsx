"use client";

import { useMemo, useState } from "react";

type VariantRow = {
  supplierVariantId: string;
  providerKey: string | null;
  gtin: string | null;
  supplierSku: string;
  supplierProductName: string | null;
  sizeRaw: string | null;
  sizeNormalized: string | null;
  price: any;
  stock: number;
  manualPrice: any;
  manualStock: number | null;
  manualLock: boolean;
  manualNote: string | null;
  galaxusPriceExVat?: number | null;
  galaxusPriceIncVat?: number | null;
  updatedAt: string;
};

type EditRow = {
  manualPrice?: string;
  manualStock?: string;
  manualLock?: boolean;
  manualNote?: string;
  clearManual?: boolean;
};

function normalizeNumber(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value.toString();
  return String(value);
}

function parseNumberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function GalaxusPricingPage() {
  const [query, setQuery] = useState("");
  const [providerKeysInput, setProviderKeysInput] = useState("");
  const [lockedOnly, setLockedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<VariantRow[]>([]);
  const [edits, setEdits] = useState<Record<string, EditRow>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkStock, setBulkStock] = useState("");
  const [bulkLock, setBulkLock] = useState<"nochange" | "lock" | "unlock">("nochange");
  const [bulkNote, setBulkNote] = useState("");
  const [log, setLog] = useState<string | null>(null);

  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);

  const loadItems = async () => {
    setLoading(true);
    setError(null);
    setLog(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (providerKeysInput.trim()) params.set("providerKeys", providerKeysInput.trim());
      if (lockedOnly) params.set("lockedOnly", "1");
      params.set("limit", "200");
      const res = await fetch(`/api/galaxus/pricing/variants?${params.toString()}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to load variants");
      setItems(data.items ?? []);
      setSelected({});
      setEdits({});
    } catch (err: any) {
      setError(err.message ?? "Failed to load variants");
    } finally {
      setLoading(false);
    }
  };

  const applyBulk = () => {
    if (selectedIds.length === 0) return;
    setEdits((prev) => {
      const next = { ...prev };
      for (const id of selectedIds) {
        const existing = { ...(next[id] ?? {}) };
        if (bulkPrice.trim()) existing.manualPrice = bulkPrice;
        if (bulkStock.trim()) existing.manualStock = bulkStock;
        if (bulkLock !== "nochange") existing.manualLock = bulkLock === "lock";
        if (bulkNote.trim()) existing.manualNote = bulkNote;
        next[id] = existing;
      }
      return next;
    });
  };

  const clearSelected = () => {
    if (selectedIds.length === 0) return;
    setEdits((prev) => {
      const next = { ...prev };
      for (const id of selectedIds) {
        next[id] = { clearManual: true, manualLock: false, manualPrice: "", manualStock: "", manualNote: "" };
      }
      return next;
    });
  };

  const saveChanges = async () => {
    const updates = Object.entries(edits)
      .map(([supplierVariantId, edit]) => {
        if (edit.clearManual) {
          return { supplierVariantId, clearManual: true };
        }
        const payload: any = { supplierVariantId };
        if (edit.manualPrice !== undefined) payload.manualPrice = parseNumberOrNull(edit.manualPrice);
        if (edit.manualStock !== undefined) payload.manualStock = parseNumberOrNull(edit.manualStock);
        if (edit.manualLock !== undefined) payload.manualLock = edit.manualLock;
        if (edit.manualNote !== undefined) payload.manualNote = edit.manualNote.trim() || null;
        return payload;
      })
      .filter((entry) => Object.keys(entry).length > 1);

    if (updates.length === 0) {
      setLog("No changes to save.");
      return;
    }
    setLoading(true);
    setError(null);
    setLog(null);
    try {
      const res = await fetch("/api/galaxus/pricing/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to save changes");
      const results = Array.isArray(data.results) ? data.results : [];
      const updatedById = new Map<string, VariantRow>();
      for (const result of results) {
        if (result?.ok && result?.item?.supplierVariantId) {
          updatedById.set(result.item.supplierVariantId, result.item);
        }
      }
      if (updatedById.size > 0) {
        setItems((prev) =>
          prev.map((item) => updatedById.get(item.supplierVariantId) ?? item)
        );
      }
      setEdits({});
      setLog(`Saved ${updatedById.size} update(s).`);
    } catch (err: any) {
      setError(err.message ?? "Failed to save changes");
    } finally {
      setLoading(false);
    }
  };

  const updateEdit = (id: string, patch: Partial<EditRow>) => {
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch, clearManual: false } }));
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Galaxus Pricing Overrides</h1>
        <p className="text-sm text-gray-500">
          Search by ProviderKey/GTIN/SKU, override price or stock, and lock items so sync jobs do not overwrite them.
        </p>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
      {log && <div className="text-xs text-gray-600">{log}</div>}

      <div className="rounded border bg-white p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <div className="text-xs text-gray-500">Search</div>
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              placeholder="Search by key, GTIN, SKU, name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <div className="text-xs text-gray-500">ProviderKeys (optional, one per line)</div>
            <textarea
              className="w-full border rounded px-2 py-1 text-xs font-mono"
              rows={2}
              value={providerKeysInput}
              onChange={(e) => setProviderKeysInput(e.target.value)}
              placeholder="STX_1234567890123"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={lockedOnly}
              onChange={(e) => setLockedOnly(e.target.checked)}
            />
            Locked only
          </label>
          <button
            className="px-3 py-1 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
            onClick={loadItems}
            disabled={loading}
          >
            {loading ? "Loading…" : "Load variants"}
          </button>
          <div className="text-xs text-gray-500">Loaded: {items.length}</div>
        </div>
      </div>

      <div className="rounded border bg-white p-4 space-y-3">
        <div className="text-sm font-medium">Bulk edit selected</div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <div className="text-xs text-gray-500">Manual price (inc VAT)</div>
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              value={bulkPrice}
              onChange={(e) => setBulkPrice(e.target.value)}
              placeholder="95.00"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-500">Manual stock</div>
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              value={bulkStock}
              onChange={(e) => setBulkStock(e.target.value)}
              placeholder="5"
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-500">Lock</div>
            <select
              className="w-full border rounded px-2 py-1 text-sm"
              value={bulkLock}
              onChange={(e) => setBulkLock(e.target.value as "nochange" | "lock" | "unlock")}
            >
              <option value="nochange">No change</option>
              <option value="lock">Lock</option>
              <option value="unlock">Unlock</option>
            </select>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-gray-500">Note</div>
            <input
              className="w-full border rounded px-2 py-1 text-sm"
              value={bulkNote}
              onChange={(e) => setBulkNote(e.target.value)}
              placeholder="Pricing override reason"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="px-3 py-1 rounded bg-gray-900 text-white text-sm disabled:opacity-50"
            onClick={applyBulk}
            disabled={selectedIds.length === 0}
          >
            Apply to selected
          </button>
          <button
            className="px-3 py-1 rounded bg-gray-100 text-sm disabled:opacity-50"
            onClick={clearSelected}
            disabled={selectedIds.length === 0}
          >
            Clear manual overrides
          </button>
          <button
            className="px-3 py-1 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
            onClick={saveChanges}
            disabled={loading || Object.keys(edits).length === 0}
          >
            Save all changes
          </button>
        </div>
      </div>

      <div className="rounded border bg-white overflow-auto">
        <table className="min-w-[1200px] w-full text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-2 py-2 text-left">Sel</th>
              <th className="px-2 py-2 text-left">ProviderKey</th>
              <th className="px-2 py-2 text-left">GTIN</th>
              <th className="px-2 py-2 text-left">Product</th>
              <th className="px-2 py-2 text-left">Size</th>
              <th className="px-2 py-2 text-right">Base Price</th>
              <th className="px-2 py-2 text-right">Galaxus Price (inc VAT)</th>
              <th className="px-2 py-2 text-right">Base Stock</th>
              <th className="px-2 py-2 text-right">Manual Price</th>
              <th className="px-2 py-2 text-right">Manual Stock</th>
              <th className="px-2 py-2 text-center">Lock</th>
              <th className="px-2 py-2 text-left">Note</th>
              <th className="px-2 py-2 text-left">Updated</th>
              <th className="px-2 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const edit = edits[item.supplierVariantId] ?? {};
              const manualPriceValue =
                edit.manualPrice ?? normalizeNumber(item.manualPrice ?? "");
              const manualStockValue =
                edit.manualStock ?? normalizeNumber(item.manualStock ?? "");
              const manualLockValue = edit.manualLock ?? Boolean(item.manualLock);
              const manualNoteValue = edit.manualNote ?? (item.manualNote ?? "");
              const sizeLabel = item.sizeNormalized ?? item.sizeRaw ?? "-";
              const galaxusPriceValue =
                typeof item.galaxusPriceIncVat === "number" ? item.galaxusPriceIncVat : null;
              return (
                <tr key={item.supplierVariantId} className="border-t">
                  <td className="px-2 py-1">
                    <input
                      type="checkbox"
                      checked={Boolean(selected[item.supplierVariantId])}
                      onChange={(e) =>
                        setSelected((prev) => ({
                          ...prev,
                          [item.supplierVariantId]: e.target.checked,
                        }))
                      }
                    />
                  </td>
                  <td className="px-2 py-1 font-mono">{item.providerKey ?? "-"}</td>
                  <td className="px-2 py-1 font-mono">{item.gtin ?? "-"}</td>
                  <td className="px-2 py-1">{item.supplierProductName ?? item.supplierSku}</td>
                  <td className="px-2 py-1">{sizeLabel}</td>
                  <td className="px-2 py-1 text-right">{normalizeNumber(item.price)}</td>
                  <td className="px-2 py-1 text-right">
                    {galaxusPriceValue !== null ? galaxusPriceValue.toFixed(2) : "-"}
                  </td>
                  <td className="px-2 py-1 text-right">{item.stock}</td>
                  <td className="px-2 py-1 text-right">
                    <input
                      className="w-24 border rounded px-1 py-0.5 text-right"
                      value={manualPriceValue}
                      onChange={(e) => updateEdit(item.supplierVariantId, { manualPrice: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <input
                      className="w-16 border rounded px-1 py-0.5 text-right"
                      value={manualStockValue}
                      onChange={(e) => updateEdit(item.supplierVariantId, { manualStock: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={manualLockValue}
                      onChange={(e) => updateEdit(item.supplierVariantId, { manualLock: e.target.checked })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className="w-56 border rounded px-1 py-0.5"
                      value={manualNoteValue}
                      onChange={(e) => updateEdit(item.supplierVariantId, { manualNote: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1">{new Date(item.updatedAt).toLocaleString()}</td>
                  <td className="px-2 py-1">
                    <button
                      className="px-2 py-1 rounded bg-gray-100 text-[11px]"
                      onClick={() =>
                        setEdits((prev) => ({
                          ...prev,
                          [item.supplierVariantId]: {
                            clearManual: true,
                            manualLock: false,
                            manualPrice: "",
                            manualStock: "",
                            manualNote: "",
                          },
                        }))
                      }
                    >
                      Clear
                    </button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 ? (
              <tr>
                <td colSpan={14} className="px-2 py-6 text-center text-xs text-gray-500">
                  No items loaded.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
