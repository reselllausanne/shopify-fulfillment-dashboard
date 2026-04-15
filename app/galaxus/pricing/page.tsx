"use client";

import { useMemo, useState } from "react";
import {
  applyDecathlonPartnerListPriceMultipliers,
  computeDecathlonOfferListPriceFromBuyNow,
  resolveDecathlonBuyNow,
} from "@/decathlon/exports/pricing";

type PricingVariantRow = {
  supplierVariantId: string;
  providerKey: string | null;
  gtin: string | null;
  supplierSku: string;
  supplierProductName: string | null;
  supplierBrand: string | null;
  sizeRaw: string | null;
  sizeNormalized: string | null;
  price: any;
  stock: number;
  weightGrams?: number | null;
  images?: any;
  sourceImageUrl?: string | null;
  hostedImageUrl?: string | null;
  imageSyncStatus?: string | null;
  imageVersion?: number | null;
  imageLastSyncedAt?: string | null;
  imageSyncError?: string | null;
  leadTimeDays?: number | null;
  manualPrice: any;
  manualStock: number | null;
  manualLock: boolean;
  manualNote: string | null;
  deliveryType?: string | null;
  lastSyncAt?: string | null;
  galaxusPriceExVat?: number | null;
  galaxusPriceIncVat?: number | null;
  updatedAt: string;
};

type PricingEdit = {
  manualPrice?: string;
  manualStock?: string;
  leadTimeDays?: string;
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
  const trimmed = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntOrNull(value: string): number | null {
  const trimmed = value.trim().replace(/\s/g, "");
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumericValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function GalaxusCatalogPage() {

  const [query, setQuery] = useState("");
  const [providerKeysInput, setProviderKeysInput] = useState("");
  const [lockedOnly, setLockedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<PricingVariantRow[]>([]);
  const [edits, setEdits] = useState<Record<string, PricingEdit>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkStock, setBulkStock] = useState("");
  const [bulkLock, setBulkLock] = useState<"nochange" | "lock" | "unlock">("nochange");
  const [bulkNote, setBulkNote] = useState("");
  const [log, setLog] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [advancedRow, setAdvancedRow] = useState<PricingVariantRow | null>(null);
  const [advancedEdit, setAdvancedEdit] = useState<Record<string, string>>({});
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [relatedRowId, setRelatedRowId] = useState<string | null>(null);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [relatedMapping, setRelatedMapping] = useState<string>("");
  const [relatedKickdbVariant, setRelatedKickdbVariant] = useState<string>("");
  const [relatedKickdbProduct, setRelatedKickdbProduct] = useState<string>("");
  const [limit, setLimit] = useState(200);

  const fullEditOpen = Boolean(advancedRow);

  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);

  const loadItems = async (next: number) => {
    setLoading(true);
    setError(null);
    setLog(null);
    try {
      const trimmedQ = query.trim();
      const supplierKeyFromQ =
        (trimmedQ.endsWith("_") || trimmedQ.endsWith(":")) && trimmedQ.length >= 3
          ? trimmedQ.replace(/[:_]+$/g, "")
          : "";
      const params = new URLSearchParams();
      if (supplierKeyFromQ) {
        params.set("supplierKey", supplierKeyFromQ);
      } else if (trimmedQ) {
        params.set("q", trimmedQ);
      }
      if (providerKeysInput.trim()) params.set("providerKeys", providerKeysInput.trim());
      if (lockedOnly) params.set("lockedOnly", "1");
      params.set("limit", String(limit));
      params.set("offset", String(next));
      const res = await fetch(`/api/galaxus/pricing/variants?${params.toString()}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to load variants");
      setItems(data.items ?? []);
      setNextOffset(data.nextOffset ?? null);
      setOffset(next);
      setSelected({});
      setEdits({});
    } catch (err: any) {
      setError(err.message ?? "Failed to load variants");
    } finally {
      setLoading(false);
    }
  };

  const openAdvancedEdit = (item: PricingVariantRow) => {
    setAdvancedRow(item);
    setAdvancedError(null);
    const next: Record<string, string> = {
      providerKey: item.providerKey ?? "",
      gtin: item.gtin ?? "",
      supplierSku: item.supplierSku ?? "",
      supplierBrand: item.supplierBrand ?? "",
      supplierProductName: item.supplierProductName ?? "",
      sizeRaw: item.sizeRaw ?? "",
      sizeNormalized: item.sizeNormalized ?? "",
      price: normalizeNumber(item.price ?? ""),
      stock: normalizeNumber(item.stock ?? ""),
      weightGrams: normalizeNumber(item.weightGrams ?? ""),
      images: item.images ? JSON.stringify(item.images) : "",
      sourceImageUrl: item.sourceImageUrl ?? "",
      hostedImageUrl: item.hostedImageUrl ?? "",
      imageSyncStatus: item.imageSyncStatus ?? "",
      imageVersion: normalizeNumber(item.imageVersion ?? ""),
      imageLastSyncedAt: item.imageLastSyncedAt ?? "",
      imageSyncError: item.imageSyncError ?? "",
      deliveryType: item.deliveryType ?? "",
      lastSyncAt: item.lastSyncAt ?? "",
    };
    setAdvancedEdit(next);
  };

  const openRelatedEdit = async (item: PricingVariantRow) => {
    setRelatedRowId(item.supplierVariantId);
    setRelatedError(null);
    setRelatedLoading(true);
    try {
      const res = await fetch(
        `/api/galaxus/pricing/variant-details?supplierVariantId=${encodeURIComponent(
          item.supplierVariantId
        )}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to load related data");
      }
      setRelatedMapping(JSON.stringify(data.mapping ?? {}, null, 2));
      setRelatedKickdbVariant(JSON.stringify(data.kickdbVariant ?? {}, null, 2));
      setRelatedKickdbProduct(JSON.stringify(data.kickdbProduct ?? {}, null, 2));
    } catch (err: any) {
      setRelatedError(err.message ?? "Failed to load related data");
    } finally {
      setRelatedLoading(false);
    }
  };

  const saveRelatedEdit = async () => {
    if (!relatedRowId) return;
    setRelatedError(null);
    setRelatedLoading(true);
    try {
      const payload = {
        supplierVariantId: relatedRowId,
        mapping: relatedMapping.trim() ? JSON.parse(relatedMapping) : {},
        kickdbVariant: relatedKickdbVariant.trim() ? JSON.parse(relatedKickdbVariant) : {},
        kickdbProduct: relatedKickdbProduct.trim() ? JSON.parse(relatedKickdbProduct) : {},
      };
      const res = await fetch("/api/galaxus/pricing/variant-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to save related data");
      }
      setRelatedMapping(JSON.stringify(data.mapping ?? {}, null, 2));
      setRelatedKickdbVariant(JSON.stringify(data.kickdbVariant ?? {}, null, 2));
      setRelatedKickdbProduct(JSON.stringify(data.kickdbProduct ?? {}, null, 2));
      setLog("Related data updated.");
    } catch (err: any) {
      setRelatedError(err.message ?? "Failed to save related data");
    } finally {
      setRelatedLoading(false);
    }
  };

  const openFullEdit = async (item: PricingVariantRow) => {
    openAdvancedEdit(item);
    await openRelatedEdit(item);
  };

  const closeFullEdit = () => {
    setAdvancedRow(null);
    setAdvancedEdit({});
    setAdvancedError(null);
    setRelatedRowId(null);
    setRelatedMapping("");
    setRelatedKickdbVariant("");
    setRelatedKickdbProduct("");
    setRelatedError(null);
  };

  const saveFullEdit = async () => {
    await saveAdvancedEdit();
    if (relatedRowId) {
      await saveRelatedEdit();
    }
  };

  const saveAdvancedEdit = async () => {
    if (!advancedRow) return;
    setLoading(true);
    setAdvancedError(null);
    try {
      const price = parseNumberOrNull(advancedEdit.price ?? "");
      const stock = parseIntOrNull(advancedEdit.stock ?? "");
      if (price === null) {
        throw new Error("Price is required and must be a number.");
      }
      if (stock === null) {
        throw new Error("Stock is required and must be a number.");
      }
      let images: any = undefined;
      if ((advancedEdit.images ?? "").trim()) {
        try {
          images = JSON.parse(advancedEdit.images ?? "");
        } catch {
          throw new Error("Images must be valid JSON.");
        }
      } else {
        images = null;
      }
      const payload: any = {
        supplierVariantId: advancedRow.supplierVariantId,
        providerKey: advancedEdit.providerKey?.trim() || null,
        gtin: advancedEdit.gtin?.trim() || null,
        supplierSku: advancedEdit.supplierSku?.trim(),
        supplierBrand: advancedEdit.supplierBrand?.trim() || null,
        supplierProductName: advancedEdit.supplierProductName?.trim() || null,
        sizeRaw: advancedEdit.sizeRaw?.trim() || null,
        sizeNormalized: advancedEdit.sizeNormalized?.trim() || null,
        price,
        stock,
        weightGrams: parseIntOrNull(advancedEdit.weightGrams ?? ""),
        images,
        sourceImageUrl: advancedEdit.sourceImageUrl?.trim() || null,
        hostedImageUrl: advancedEdit.hostedImageUrl?.trim() || null,
        imageSyncStatus: advancedEdit.imageSyncStatus?.trim() || null,
        imageVersion: parseIntOrNull(advancedEdit.imageVersion ?? ""),
        imageLastSyncedAt: advancedEdit.imageLastSyncedAt?.trim() || null,
        imageSyncError: advancedEdit.imageSyncError?.trim() || null,
        deliveryType: advancedEdit.deliveryType?.trim() || null,
        lastSyncAt: advancedEdit.lastSyncAt?.trim() || null,
      };
      const res = await fetch("/api/galaxus/pricing/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: [payload] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Update failed");
      }
      const updated = data.results?.find((r: any) => r?.ok && r?.item)?.item;
      if (updated?.supplierVariantId) {
        setItems((prev) =>
          prev.map((item) => (item.supplierVariantId === updated.supplierVariantId ? updated : item))
        );
      }
      setAdvancedRow(null);
      setAdvancedEdit({});
      setLog("Advanced update saved.");
    } catch (err: any) {
      setAdvancedError(err.message ?? "Advanced update failed");
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
        if (edit.leadTimeDays !== undefined) payload.leadTimeDays = parseIntOrNull(edit.leadTimeDays);
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `Save failed (${res.status})`);
      }
      const results = Array.isArray(data.results) ? data.results : [];
      const failures = results.filter((r: any) => r && r.ok === false);
      if (failures.length > 0) {
        const msg = failures
          .map((f: any) => `${f.supplierVariantId ?? "?"}: ${f.error ?? "failed"}`)
          .join("\n");
        setError(msg);
      } else {
        setError(null);
      }
      if (data.ok === false && data.error) {
        setError((prev) => (prev ? `${prev}\n${data.error}` : data.error));
      }
      const updatedById = new Map<string, PricingVariantRow>();
      for (const result of results) {
        if (result?.ok && result?.item?.supplierVariantId) {
          updatedById.set(result.item.supplierVariantId, result.item);
        }
      }
      if (updatedById.size > 0) {
        setItems((prev) => prev.map((item) => updatedById.get(item.supplierVariantId) ?? item));
      }
      if (failures.length === 0) {
        setEdits({});
      }
      setLog(
        failures.length > 0
          ? `Failed ${failures.length} row(s). Saved ${updatedById.size}. Fix errors above.`
          : `Saved ${updatedById.size} update(s).`
      );
    } catch (err: any) {
      setError(err.message ?? "Failed to save changes");
    } finally {
      setLoading(false);
    }
  };

  const updateEdit = (id: string, patch: Partial<PricingEdit>) => {
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch, clearManual: false } }));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Galaxus Pricing & DB</h1>
        <div className="text-sm text-gray-500">
          Bulk edit pricing overrides and directly edit DB rows for supplier variants & mappings.
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <a className="px-3 py-2 rounded bg-gray-100 text-black" href="/galaxus/db">
          View DB
        </a>
      </div>

      <div className="space-y-6">
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
              <label className="flex items-center gap-2 text-xs text-gray-600">
                Limit
                <select
                  className="border rounded px-1 py-0.5 text-xs"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </label>
              <button
                className="px-3 py-1 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
                onClick={() => loadItems(0)}
                disabled={loading}
              >
                {loading ? "Loading…" : "Load variants"}
              </button>
              <div className="text-xs text-gray-500">Loaded: {items.length}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>Offset: {offset}</span>
              <button
                className="px-2 py-1 rounded bg-gray-100 text-xs disabled:opacity-50"
                onClick={() => loadItems(Math.max(0, offset - limit))}
                disabled={loading || offset === 0}
              >
                Prev
              </button>
              <button
                className="px-2 py-1 rounded bg-gray-100 text-xs disabled:opacity-50"
                onClick={() => nextOffset !== null && loadItems(nextOffset)}
                disabled={loading || nextOffset === null}
              >
                Next
              </button>
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
                  <th className="px-2 py-2 text-right">Decathlon Sell Price</th>
                  <th className="px-2 py-2 text-right">Base Stock</th>
                  <th
                    className="px-2 py-2 text-right"
                    title="Calendar days → Galaxus Stock RestockTime/Date (if no STX ETA)"
                  >
                    Lead days
                  </th>
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
                  const manualPriceValue = edit.manualPrice ?? normalizeNumber(item.manualPrice ?? "");
                  const manualStockValue = edit.manualStock ?? normalizeNumber(item.manualStock ?? "");
                  const manualLockValue = edit.manualLock ?? Boolean(item.manualLock);
                  const manualNoteValue = edit.manualNote ?? (item.manualNote ?? "");
                  const leadTimeValue = edit.leadTimeDays ?? normalizeNumber(item.leadTimeDays ?? "");
                  const sizeLabel = item.sizeNormalized ?? item.sizeRaw ?? "-";
                  const galaxusPriceValue =
                    typeof item.galaxusPriceIncVat === "number" ? item.galaxusPriceIncVat : null;
                  const buyNowStockx = parseNumericValue(item.price);
                  const manualOverride = parseNumericValue(manualPriceValue);
                  const decathlonBuyNow = resolveDecathlonBuyNow({
                    buyNowStockx,
                    manualOverride,
                    manualLock: manualLockValue,
                  });
                  const svPrefix = String(item.supplierVariantId ?? "")
                    .split(/[:_]/)[0]
                    ?.toLowerCase() ?? "";
                  const OWN_KEYS = new Set(["stx", "the", "trm", ""]);
                  const isPartnerRow = svPrefix.length > 0 && !OWN_KEYS.has(svPrefix);
                  const decathlonSellPrice = (() => {
                    if (decathlonBuyNow === null) return null;
                    if (isPartnerRow) {
                      return applyDecathlonPartnerListPriceMultipliers(
                        decathlonBuyNow,
                        svPrefix,
                        new Set([svPrefix])
                      );
                    }
                    const base = computeDecathlonOfferListPriceFromBuyNow(decathlonBuyNow);
                    if (!base || base <= 0) return null;
                    return applyDecathlonPartnerListPriceMultipliers(base, svPrefix, new Set());
                  })();
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
                      <td className="px-2 py-1 text-right">
                        {typeof decathlonSellPrice === "number" ? decathlonSellPrice.toFixed(2) : "-"}
                      </td>
                      <td className="px-2 py-1 text-right">{item.stock}</td>
                      <td className="px-2 py-1 text-right">
                        <input
                          className="w-12 border rounded px-1 py-0.5 text-right"
                          type="number"
                          min={0}
                          step={1}
                          title="Empty = clear; used in stock CSV when no STX purchase ETA"
                          value={leadTimeValue}
                          onChange={(e) =>
                            updateEdit(item.supplierVariantId, { leadTimeDays: e.target.value })
                          }
                        />
                      </td>
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
                      <button
                        className="ml-2 px-2 py-1 rounded bg-gray-900 text-white text-[11px]"
                        onClick={() => openFullEdit(item)}
                      >
                        Edit full data
                      </button>
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={16} className="px-2 py-6 text-center text-xs text-gray-500">
                      No items loaded.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {fullEditOpen && (
            <div className="rounded border bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Edit full product data</div>
                <button className="text-xs text-gray-500" onClick={closeFullEdit}>
                  Close
                </button>
              </div>
              {advancedError && <div className="text-xs text-red-600">{advancedError}</div>}
              {relatedError && <div className="text-xs text-red-600">{relatedError}</div>}
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">ProviderKey</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.providerKey ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, providerKey: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">GTIN</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.gtin ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, gtin: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Supplier SKU</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.supplierSku ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, supplierSku: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Product name</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.supplierProductName ?? ""}
                    onChange={(e) =>
                      setAdvancedEdit((prev) => ({ ...prev, supplierProductName: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Brand</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.supplierBrand ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, supplierBrand: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Size raw</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.sizeRaw ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, sizeRaw: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Size normalized</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.sizeNormalized ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, sizeNormalized: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Price</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.price ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, price: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Stock</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.stock ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, stock: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Weight grams</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.weightGrams ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, weightGrams: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Source image URL</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.sourceImageUrl ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, sourceImageUrl: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Hosted image URL</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.hostedImageUrl ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, hostedImageUrl: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Image sync status</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.imageSyncStatus ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, imageSyncStatus: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Image version</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.imageVersion ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, imageVersion: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Image last synced (ISO)</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    placeholder="2026-03-25T12:00:00.000Z"
                    value={advancedEdit.imageLastSyncedAt ?? ""}
                    onChange={(e) =>
                      setAdvancedEdit((prev) => ({ ...prev, imageLastSyncedAt: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Image sync error</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.imageSyncError ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, imageSyncError: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Delivery type</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    value={advancedEdit.deliveryType ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, deliveryType: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">Last sync at (ISO)</div>
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    placeholder="2026-03-25T12:00:00.000Z"
                    value={advancedEdit.lastSyncAt ?? ""}
                    onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, lastSyncAt: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-gray-500">Images (JSON array)</div>
                <textarea
                  className="w-full border rounded px-2 py-1 text-xs font-mono"
                  rows={3}
                  value={advancedEdit.images ?? ""}
                  onChange={(e) => setAdvancedEdit((prev) => ({ ...prev, images: e.target.value }))}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">VariantMapping (JSON)</div>
                  <textarea
                    className="w-full border rounded px-2 py-1 text-[11px] font-mono"
                    rows={8}
                    value={relatedMapping}
                    onChange={(e) => setRelatedMapping(e.target.value)}
                    disabled={relatedLoading}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">KickDBVariant (JSON)</div>
                  <textarea
                    className="w-full border rounded px-2 py-1 text-[11px] font-mono"
                    rows={8}
                    value={relatedKickdbVariant}
                    onChange={(e) => setRelatedKickdbVariant(e.target.value)}
                    disabled={relatedLoading}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">KickDBProduct (JSON)</div>
                  <textarea
                    className="w-full border rounded px-2 py-1 text-[11px] font-mono"
                    rows={8}
                    value={relatedKickdbProduct}
                    onChange={(e) => setRelatedKickdbProduct(e.target.value)}
                    disabled={relatedLoading}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="px-3 py-1 rounded bg-indigo-600 text-white text-xs disabled:opacity-50"
                  onClick={saveFullEdit}
                  disabled={loading || relatedLoading}
                >
                  {loading || relatedLoading ? "Saving…" : "Save full row"}
                </button>
                <button
                  className="px-3 py-1 rounded bg-gray-100 text-xs"
                  onClick={closeFullEdit}
                  disabled={loading || relatedLoading}
                >
                  Cancel
                </button>
              </div>
              <div className="text-[11px] text-gray-500">
                Edits are limited to safe fields (e.g. colorway, brand, traitsJson, sizes, gtin, providerKey).
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

