"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type CatalogItem = {
  supplierVariantId: string;
  owned: boolean;
  providerKey?: string | null;
  gtin?: string | null;
  supplierSku?: string | null;
  supplierBrand?: string | null;
  supplierProductName?: string | null;
  sizeRaw?: string | null;
  sizeNormalized?: string | null;
  price?: string | number | null;
  stock?: number | null;
  updatedAt?: string | null;
  weightGrams?: number | null;
  images?: unknown | null;
  sourceImageUrl?: string | null;
  hostedImageUrl?: string | null;
  imageSyncStatus?: string | null;
  imageVersion?: number | null;
  imageLastSyncedAt?: string | null;
  imageSyncError?: string | null;
  deliveryType?: string | null;
  lastSyncAt?: string | null;
  leadTimeDays?: number | null;
};

type UpdatePayload = {
  supplierVariantId: string;
  providerKey?: string | null;
  gtin?: string | null;
  supplierSku?: string;
  supplierBrand?: string | null;
  supplierProductName?: string | null;
  sizeRaw?: string | null;
  sizeNormalized?: string | null;
  price?: number | null;
  stock?: number | null;
  weightGrams?: number | null;
  images?: unknown | null;
  sourceImageUrl?: string | null;
  hostedImageUrl?: string | null;
  imageSyncStatus?: string | null;
  imageVersion?: number | null;
  imageLastSyncedAt?: string | null;
  imageSyncError?: string | null;
  deliveryType?: string | null;
  lastSyncAt?: string | null;
  leadTimeDays?: number | null;
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

export default function PartnerCatalogPage() {
  const router = useRouter();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [limit, setLimit] = useState(200);
  const [editPrice, setEditPrice] = useState<Record<string, string>>({});
  const [editStock, setEditStock] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalRow, setModalRow] = useState<CatalogItem | null>(null);
  const [modalEdit, setModalEdit] = useState<Record<string, string>>({});
  const [modalError, setModalError] = useState<string | null>(null);
  const [isNer, setIsNer] = useState(false);

  useEffect(() => {
    const loadPartner = async () => {
      try {
        const res = await fetch("/api/partners/me", { cache: "no-store" });
        if (res.status === 401) {
          router.push("/partners/login");
          return;
        }
        const data = await res.json();
        if (data.ok && data.partner?.key) {
          setIsNer(String(data.partner.key).toLowerCase() === "ner");
        }
      } catch {
        // ignore
      }
    };
    loadPartner();
  }, [router]);

  const loadItems = async (next = 0, mode: "replace" | "append" = "replace") => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      const appliedMineOnly = !isNer || mineOnly;
      if (appliedMineOnly) params.set("mine", "1");
      params.set("limit", String(limit));
      params.set("offset", String(next));
      const res = await fetch(`/api/partners/catalog/variants?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load catalog");
      const incoming = Array.isArray(data.items) ? data.items : [];
      setItems((prev) => {
        if (mode === "replace") return incoming;
        const seen = new Set(prev.map((item) => item.supplierVariantId));
        const merged = [...prev];
        for (const item of incoming) {
          if (!seen.has(item.supplierVariantId)) merged.push(item);
        }
        return merged;
      });
      setNextOffset(data.nextOffset ?? null);
      setOffset(next);
      if (mode === "replace") {
        setEditPrice({});
        setEditStock({});
      }
    } catch (err: any) {
      setError(err.message ?? "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, [isNer]);

  const applySearch = () => loadItems(0, "replace");

  const openFullEdit = (row: CatalogItem) => {
    if (!isNer) return;
    setModalRow(row);
    setModalError(null);
    const next: Record<string, string> = {
      providerKey: row.providerKey ?? "",
      gtin: row.gtin ?? "",
      supplierSku: row.supplierSku ?? "",
      supplierBrand: row.supplierBrand ?? "",
      supplierProductName: row.supplierProductName ?? "",
      sizeRaw: row.sizeRaw ?? "",
      sizeNormalized: row.sizeNormalized ?? "",
      price: normalizeNumber(row.price ?? ""),
      stock: normalizeNumber(row.stock ?? ""),
      weightGrams: normalizeNumber(row.weightGrams ?? ""),
      images: row.images ? JSON.stringify(row.images) : "",
      sourceImageUrl: row.sourceImageUrl ?? "",
      hostedImageUrl: row.hostedImageUrl ?? "",
      imageSyncStatus: row.imageSyncStatus ?? "",
      imageVersion: normalizeNumber(row.imageVersion ?? ""),
      imageLastSyncedAt: row.imageLastSyncedAt ?? "",
      imageSyncError: row.imageSyncError ?? "",
      deliveryType: row.deliveryType ?? "",
      lastSyncAt: row.lastSyncAt ?? "",
      leadTimeDays: normalizeNumber(row.leadTimeDays ?? ""),
    };
    setModalEdit(next);
  };

  const closeFullEdit = () => {
    setModalRow(null);
    setModalEdit({});
    setModalError(null);
  };

  const applyUpdates = async (updates: UpdatePayload[]) => {
    if (updates.length === 0) return;
    const res = await fetch("/api/partners/catalog/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error ?? "Update failed");
    }
    const updatedItems = (data.results ?? [])
      .filter((r: any) => r?.ok && r?.item)
      .map((r: any) => r.item);
    if (updatedItems.length > 0) {
      setItems((prev) =>
        prev.map((item) => updatedItems.find((u: any) => u.supplierVariantId === item.supplierVariantId) ?? item)
      );
    }
  };

  const saveInline = async (row: CatalogItem) => {
    if (!row.owned) return;
    setBusyId(row.supplierVariantId);
    setError(null);
    try {
      const priceValue = editPrice[row.supplierVariantId] ?? String(row.price ?? "");
      const stockValue = editStock[row.supplierVariantId] ?? String(row.stock ?? "");
      const price = parseNumberOrNull(priceValue);
      const stock = parseIntOrNull(stockValue);
      if (price === null) throw new Error("Price must be a number");
      if (stock === null) throw new Error("Stock must be a number");
      await applyUpdates([
        {
          supplierVariantId: row.supplierVariantId,
          price,
          stock,
        },
      ]);
    } catch (err: any) {
      setError(err.message ?? "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const saveFullEdit = async () => {
    if (!modalRow || !isNer) return;
    setBusyId("modal");
    setModalError(null);
    try {
      const price = parseNumberOrNull(modalEdit.price ?? "");
      const stock = parseIntOrNull(modalEdit.stock ?? "");
      if (price === null) throw new Error("Price is required and must be a number.");
      if (stock === null) throw new Error("Stock is required and must be a number.");
      let images: any = undefined;
      if ((modalEdit.images ?? "").trim()) {
        try {
          images = JSON.parse(modalEdit.images ?? "");
        } catch {
          throw new Error("Images must be valid JSON.");
        }
      } else {
        images = null;
      }
      const payload: UpdatePayload = {
        supplierVariantId: modalRow.supplierVariantId,
        providerKey: modalEdit.providerKey?.trim() || null,
        gtin: modalEdit.gtin?.trim() || null,
        supplierSku: modalEdit.supplierSku?.trim() || "",
        supplierBrand: modalEdit.supplierBrand?.trim() || null,
        supplierProductName: modalEdit.supplierProductName?.trim() || null,
        sizeRaw: modalEdit.sizeRaw?.trim() || null,
        sizeNormalized: modalEdit.sizeNormalized?.trim() || null,
        price,
        stock,
        weightGrams: parseIntOrNull(modalEdit.weightGrams ?? ""),
        images,
        sourceImageUrl: modalEdit.sourceImageUrl?.trim() || null,
        hostedImageUrl: modalEdit.hostedImageUrl?.trim() || null,
        imageSyncStatus: modalEdit.imageSyncStatus?.trim() || null,
        imageVersion: parseIntOrNull(modalEdit.imageVersion ?? ""),
        imageLastSyncedAt: modalEdit.imageLastSyncedAt?.trim() || null,
        imageSyncError: modalEdit.imageSyncError?.trim() || null,
        deliveryType: modalEdit.deliveryType?.trim() || null,
        lastSyncAt: modalEdit.lastSyncAt?.trim() || null,
        ...(() => {
          const leadRaw = (modalEdit.leadTimeDays ?? "").trim();
          if (leadRaw === "") return { leadTimeDays: null as number | null };
          const parsed = parseIntOrNull(leadRaw);
          if (parsed === null) throw new Error("Lead time must be a whole number of days.");
          if (parsed < 0 || parsed > 365) throw new Error("Lead time must be between 0 and 365 days.");
          return { leadTimeDays: parsed };
        })(),
      };
      await applyUpdates([payload]);
      closeFullEdit();
    } catch (err: any) {
      setModalError(err.message ?? "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const deleteRow = async (row: CatalogItem) => {
    if (!isNer) return;
    if (!row.owned) return;
    if (!confirm(`Remove ${row.supplierSku ?? row.supplierVariantId}?`)) return;
    setBusyId(row.supplierVariantId);
    setError(null);
    try {
      const res = await fetch(`/api/partners/variants/${encodeURIComponent(row.supplierVariantId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Delete failed");
      await loadItems(offset);
    } catch (err: any) {
      setError(err.message ?? "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  const ownedCount = useMemo(() => items.filter((item) => item.owned).length, [items]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Catalog & Pricing</h1>
          <p className="text-sm text-slate-500">
            {isNer
              ? "Full catalog view with full edit access."
              : "You can view and edit only your own products (price + stock)."}
          </p>
        </div>
        <div className="text-xs text-slate-500">
          {isNer ? `Owned: ${ownedCount} · Loaded: ${items.length}` : `Loaded: ${items.length}`}
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="w-64 rounded border border-slate-200 px-3 py-2 text-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by SKU, GTIN, variant id..."
          />
          {isNer ? (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={mineOnly}
                onChange={(event) => setMineOnly(event.target.checked)}
              />
              Only my products
            </label>
          ) : null}
          <select
            className="rounded border border-slate-200 px-2 py-2 text-xs text-slate-600"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          >
            <option value={100}>100 rows</option>
            <option value={200}>200 rows</option>
            <option value={400}>400 rows</option>
          </select>
          <button
            className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
            onClick={applySearch}
            disabled={loading}
          >
            {loading ? "Loading…" : "Apply"}
          </button>
        </div>
      </div>

      <div className="overflow-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-2 py-2 text-left">Variant ID</th>
              <th className="px-2 py-2 text-left">SKU</th>
              <th className="px-2 py-2 text-left">GTIN</th>
              <th className="px-2 py-2 text-left">Size</th>
              <th className="px-2 py-2 text-right">Price</th>
              <th className="px-2 py-2 text-right">Stock</th>
              <th className="px-2 py-2 text-left">Updated</th>
              <th className="px-2 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.supplierVariantId} className="border-t">
                <td className="px-2 py-2 font-mono">{row.supplierVariantId}</td>
                <td className="px-2 py-2">{row.supplierSku ?? "-"}</td>
                <td className="px-2 py-2 font-mono">{row.gtin ?? "-"}</td>
                <td className="px-2 py-2">{row.sizeRaw ?? "-"}</td>
                <td className="px-2 py-2 text-right">
                  {row.owned ? (
                    <input
                      className="w-20 rounded border border-slate-200 px-1 py-0.5 text-right"
                      value={editPrice[row.supplierVariantId] ?? String(row.price ?? "")}
                      onChange={(event) =>
                        setEditPrice((prev) => ({
                          ...prev,
                          [row.supplierVariantId]: event.target.value,
                        }))
                      }
                    />
                  ) : (
                    <span className="text-slate-500">{row.price ?? "-"}</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  {row.owned ? (
                    <input
                      className="w-16 rounded border border-slate-200 px-1 py-0.5 text-right"
                      value={editStock[row.supplierVariantId] ?? String(row.stock ?? 0)}
                      onChange={(event) =>
                        setEditStock((prev) => ({
                          ...prev,
                          [row.supplierVariantId]: event.target.value,
                        }))
                      }
                    />
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-2 py-2">{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "-"}</td>
                <td className="px-2 py-2">
                  {row.owned ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded-full bg-[#55b3f3] px-3 py-1 text-xs font-semibold text-slate-950 disabled:opacity-50"
                        onClick={() => saveInline(row)}
                        disabled={busyId === row.supplierVariantId}
                      >
                        {busyId === row.supplierVariantId ? "Saving…" : "Save"}
                      </button>
                      {isNer ? (
                        <>
                          <button
                            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700"
                            onClick={() => openFullEdit(row)}
                          >
                            Full edit
                          </button>
                          <button
                            className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-600"
                            onClick={() => deleteRow(row)}
                            disabled={busyId === row.supplierVariantId}
                          >
                            Remove
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-slate-400">Read only</span>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td className="px-2 py-4 text-center text-slate-500" colSpan={8}>
                  No catalog rows found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {nextOffset !== null && (
        <button
          className="rounded-full border border-slate-200 px-4 py-2 text-xs text-slate-600"
          onClick={() => loadItems(nextOffset, "append")}
          disabled={loading}
        >
          Load more
        </button>
      )}

      {modalRow && isNer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400">Full edit</div>
                <div className="text-lg font-semibold text-slate-900">{modalRow.supplierVariantId}</div>
              </div>
              <button className="text-sm text-slate-500" onClick={closeFullEdit}>
                Close
              </button>
            </div>
            {modalError && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {modalError}
              </div>
            )}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {[
                ["providerKey", "Provider key"],
                ["gtin", "GTIN"],
                ["supplierSku", "SKU"],
                ["supplierBrand", "Brand"],
                ["supplierProductName", "Product name"],
                ["sizeRaw", "Size (raw)"],
                ["sizeNormalized", "Size (normalized)"],
                ["price", "Price"],
                ["stock", "Stock"],
                ["weightGrams", "Weight (grams)"],
                ["sourceImageUrl", "Source image URL"],
                ["hostedImageUrl", "Hosted image URL"],
                ["imageSyncStatus", "Image sync status"],
                ["imageVersion", "Image version"],
                ["imageLastSyncedAt", "Image last synced"],
                ["imageSyncError", "Image sync error"],
                ["deliveryType", "Delivery type"],
                ["leadTimeDays", "Lead time to ship (days)"],
                ["lastSyncAt", "Last sync"],
              ].map(([key, label]) => (
                <label key={key} className="text-xs text-slate-600">
                  {label}
                  <input
                    className="mt-1 w-full rounded border border-slate-200 px-2 py-2 text-sm text-slate-900"
                    value={modalEdit[key] ?? ""}
                    onChange={(event) =>
                      setModalEdit((prev) => ({
                        ...prev,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
              <label className="text-xs text-slate-600 md:col-span-2">
                Images (JSON)
                <textarea
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-2 text-sm text-slate-900"
                  rows={4}
                  value={modalEdit.images ?? ""}
                  onChange={(event) =>
                    setModalEdit((prev) => ({
                      ...prev,
                      images: event.target.value,
                    }))
                  }
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Image hosting reads the first absolute URL from this JSON array (or from Source image URL). After
                  saving, run the image sync job (ops / Galaxus admin) or wait for the scheduled sync to upload to
                  Supabase storage.
                </p>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="rounded-full bg-[#55b3f3] px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
                onClick={saveFullEdit}
                disabled={busyId === "modal"}
              >
                {busyId === "modal" ? "Saving…" : "Save changes"}
              </button>
              <button
                className="rounded-full border border-slate-200 px-4 py-2 text-xs text-slate-700"
                onClick={closeFullEdit}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
