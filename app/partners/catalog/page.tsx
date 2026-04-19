"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeSize, normalizeSku } from "@/app/lib/normalize";

type CatalogItem = {
  supplierVariantId: string;
  owned: boolean;
  displayProductName?: string | null;
  partnerKeyResolved?: string | null;
  partnerDisplayName?: string | null;
  kickdbProductName?: string | null;
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
  leadTimeDays?: number | null;
};

type UpdatePayload = {
  supplierVariantId: string;
  price?: number | null;
  stock?: number | null;
  supplierSku?: string;
  gtin?: string | null;
  supplierBrand?: string | null;
  supplierProductName?: string | null;
  sizeRaw?: string | null;
  sizeNormalized?: string | null;
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
  const [editSku, setEditSku] = useState<Record<string, string>>({});
  const [editGtin, setEditGtin] = useState<Record<string, string>>({});
  const [editBrand, setEditBrand] = useState<Record<string, string>>({});
  const [editProductName, setEditProductName] = useState<Record<string, string>>({});
  const [editSizeRaw, setEditSizeRaw] = useState<Record<string, string>>({});
  const [editLeadTime, setEditLeadTime] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
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
        setEditSku({});
        setEditGtin({});
        setEditBrand({});
        setEditProductName({});
        setEditSizeRaw({});
        setEditLeadTime({});
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
      const id = row.supplierVariantId;
      const priceValue = editPrice[id] ?? String(row.price ?? "");
      const stockValue = editStock[id] ?? String(row.stock ?? "");
      const price = parseNumberOrNull(priceValue);
      const stock = parseIntOrNull(stockValue);
      if (price === null) throw new Error("Price must be a number");
      if (stock === null) throw new Error("Stock must be a number");
      const payload: UpdatePayload = { supplierVariantId: id, price, stock };
      if (isNer) {
        const skuRaw = (editSku[id] ?? row.supplierSku ?? "").trim();
        const skuNorm = normalizeSku(skuRaw) ?? skuRaw;
        const sizeRaw = (editSizeRaw[id] ?? row.sizeRaw ?? "").trim();
        const normalizedSize = normalizeSize(sizeRaw);
        const sizeNormFallback = (row.sizeNormalized ?? "").trim() || sizeRaw || null;
        const sizeNorm = normalizedSize ?? sizeNormFallback;
        const gtinRaw = (editGtin[id] ?? row.gtin ?? "").trim();
        const brand = (editBrand[id] ?? row.supplierBrand ?? "").trim();
        const productName = (editProductName[id] ?? row.supplierProductName ?? "").trim();
        const leadRaw = (editLeadTime[id] ?? (row.leadTimeDays != null ? String(row.leadTimeDays) : "")).trim();
        const leadParsed = leadRaw === "" ? null : parseIntOrNull(leadRaw);
        if (leadRaw !== "" && leadParsed === null) throw new Error("Lead time must be an integer or empty");
        payload.supplierSku = skuNorm;
        payload.gtin = gtinRaw ? gtinRaw : null;
        payload.supplierBrand = brand ? brand : null;
        payload.supplierProductName = productName ? productName : null;
        payload.sizeRaw = sizeRaw ? sizeRaw : null;
        payload.sizeNormalized = sizeNorm ? String(sizeNorm) : null;
        payload.leadTimeDays = leadParsed;
      }
      await applyUpdates([payload]);
    } catch (err: any) {
      setError(err.message ?? "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const deleteRow = async (row: CatalogItem) => {
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
              ? "Full catalog: edit product fields, price, stock, and lead time per row (same API as Galaxus admin bulk)."
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
              <th className="px-2 py-2 text-left">Partner</th>
              <th className="px-2 py-2 text-left">Product</th>
              <th className="px-2 py-2 text-left">SKU</th>
              <th className="px-2 py-2 text-left">GTIN</th>
              <th className="px-2 py-2 text-left">Size</th>
              {isNer ? (
                <>
                  <th className="px-2 py-2 text-left">Brand</th>
                  <th className="px-2 py-2 text-right">Lead (d)</th>
                </>
              ) : null}
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
                <td className="px-2 py-2 text-slate-700">
                  {row.partnerDisplayName ?? row.partnerKeyResolved ?? row.providerKey ?? "—"}
                </td>
                <td className="px-2 py-2 min-w-[10rem] max-w-[18rem]">
                  {isNer && row.owned ? (
                    <textarea
                      className="w-full min-h-[2.5rem] rounded border border-slate-200 px-1 py-0.5 text-xs"
                      rows={2}
                      value={
                        editProductName[row.supplierVariantId] ??
                        (row.supplierProductName ?? row.displayProductName ?? "")
                      }
                      onChange={(event) =>
                        setEditProductName((prev) => ({
                          ...prev,
                          [row.supplierVariantId]: event.target.value,
                        }))
                      }
                    />
                  ) : (
                    <span className="line-clamp-2" title={row.displayProductName ?? row.supplierProductName ?? ""}>
                      {row.displayProductName ?? row.supplierProductName ?? "—"}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2">
                  {isNer && row.owned ? (
                    <input
                      className="w-full min-w-[5rem] rounded border border-slate-200 px-1 py-0.5 font-mono text-[11px]"
                      value={editSku[row.supplierVariantId] ?? (row.supplierSku ?? "")}
                      onChange={(event) =>
                        setEditSku((prev) => ({ ...prev, [row.supplierVariantId]: event.target.value }))
                      }
                    />
                  ) : (
                    row.supplierSku ?? "—"
                  )}
                </td>
                <td className="px-2 py-2 font-mono">
                  {isNer && row.owned ? (
                    <input
                      className="w-full min-w-[6rem] rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                      value={editGtin[row.supplierVariantId] ?? (row.gtin ?? "")}
                      onChange={(event) =>
                        setEditGtin((prev) => ({ ...prev, [row.supplierVariantId]: event.target.value }))
                      }
                    />
                  ) : (
                    row.gtin ?? "—"
                  )}
                </td>
                <td className="px-2 py-2">
                  {isNer && row.owned ? (
                    <input
                      className="w-20 rounded border border-slate-200 px-1 py-0.5"
                      value={editSizeRaw[row.supplierVariantId] ?? (row.sizeRaw ?? "")}
                      onChange={(event) =>
                        setEditSizeRaw((prev) => ({ ...prev, [row.supplierVariantId]: event.target.value }))
                      }
                    />
                  ) : (
                    row.sizeRaw ?? "—"
                  )}
                </td>
                {isNer && row.owned ? (
                  <>
                    <td className="px-2 py-2">
                      <input
                        className="w-full min-w-[5rem] rounded border border-slate-200 px-1 py-0.5"
                        value={editBrand[row.supplierVariantId] ?? (row.supplierBrand ?? "")}
                        onChange={(event) =>
                          setEditBrand((prev) => ({ ...prev, [row.supplierVariantId]: event.target.value }))
                        }
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        className="w-14 rounded border border-slate-200 px-1 py-0.5 text-right"
                        value={
                          editLeadTime[row.supplierVariantId] ??
                          (row.leadTimeDays != null ? String(row.leadTimeDays) : "")
                        }
                        onChange={(event) =>
                          setEditLeadTime((prev) => ({ ...prev, [row.supplierVariantId]: event.target.value }))
                        }
                        placeholder="—"
                      />
                    </td>
                  </>
                ) : isNer ? (
                  <>
                    <td className="px-2 py-2 text-slate-400">—</td>
                    <td className="px-2 py-2 text-slate-400">—</td>
                  </>
                ) : null}
                <td className="px-2 py-2 text-right">
                  {row.owned ? (
                    <input
                      className="w-20 rounded border border-slate-200 px-1 py-0.5 text-right"
                      value={editPrice[row.supplierVariantId] ?? normalizeNumber(row.price ?? "")}
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
                      value={editStock[row.supplierVariantId] ?? normalizeNumber(row.stock ?? 0)}
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
                      <button
                        className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-600"
                        onClick={() => deleteRow(row)}
                        disabled={busyId === row.supplierVariantId}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <span className="text-slate-400">Read only</span>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td className="px-2 py-4 text-center text-slate-500" colSpan={isNer ? 12 : 10}>
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
    </div>
  );
}
