"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PartnerProductDataModal } from "./PartnerProductDataModal";

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
  /** Lowest `SupplierVariant.price` in DB for this GTIN, excluding this partner’s own ids. */
  referenceMinPriceChf?: number | null;
  referenceOfferCount?: number | null;
};

type UpdatePayload = {
  supplierVariantId: string;
  price?: number | null;
  stock?: number | null;
};

function normalizeNumber(value: unknown): string {
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

/** Sub-line under Price: lowest DB price for same GTIN (other suppliers) + delta vs your price. */
function PriceReferenceHint(props: { row: CatalogItem; priceFieldValue: string }) {
  const { row, priceFieldValue } = props;
  const ref = row.referenceMinPriceChf;
  const count = row.referenceOfferCount ?? 0;
  if (ref == null || !Number.isFinite(ref)) return null;

  const your =
    parseNumberOrNull(priceFieldValue) ??
    parseNumberOrNull(String(row.price ?? ""));

  let deltaEl: ReactNode = null;
  if (your != null && Number.isFinite(your)) {
    const d = your - ref;
    if (Math.abs(d) < 0.01) {
      deltaEl = <span className="text-slate-500">Same as lowest elsewhere</span>;
    } else if (d > 0) {
      deltaEl = <span className="text-amber-800">+{d.toFixed(2)} CHF above min</span>;
    } else {
      deltaEl = <span className="text-emerald-800">{d.toFixed(2)} CHF below min</span>;
    }
  }

  return (
    <div
      className="mt-1 max-w-[9rem] space-y-0.5 text-left text-[10px] leading-tight text-slate-500"
      title={`Lowest SupplierVariant.price among other suppliers for GTIN ${row.gtin ?? ""} (${count} listing(s))`}
    >
      <div>
        Others min{" "}
        <span className="tabular-nums font-medium text-slate-700">{ref.toFixed(2)}</span>
        {count > 0 ? <span className="text-slate-400"> ({count})</span> : null}
      </div>
      {deltaEl}
    </div>
  );
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
  const [isNer, setIsNer] = useState(false);
  const [detailVariantId, setDetailVariantId] = useState<string | null>(null);
  const [galaxusFeedExcluded, setGalaxusFeedExcluded] = useState(false);

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
      setGalaxusFeedExcluded(Boolean(data.galaxusFeedExcludedForPartner));
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load catalog");
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
      throw new Error((data as { error?: string }).error ?? "Update failed");
    }
    await loadItems(offset, "replace");
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
      await applyUpdates([{ supplierVariantId: id, price, stock }]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Update failed");
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed");
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
              ? "Browse the full catalog. Open Product data for GTIN, images, and Galaxus fields; use Save on the row for quick price/stock only."
              : "You can view and edit only your own products (price + stock)."}
          </p>
          {galaxusFeedExcluded ? (
            <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Galaxus supplier feeds exclude this partner key (server{" "}
              <code className="rounded bg-amber-100 px-1">GALAXUS_FEED_SUPPLIER_BLOCKLIST</code>
              ). Decathlon export still includes your rows when GTIN, brand, price, and stock rules pass.
            </p>
          ) : null}
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
              <th className="px-2 py-2 text-right" title="Your price; under it: lowest price elsewhere for same GTIN">
                Price
              </th>
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
                  <span className="line-clamp-2" title={row.displayProductName ?? row.supplierProductName ?? ""}>
                    {row.displayProductName ?? row.supplierProductName ?? "—"}
                  </span>
                </td>
                <td className="px-2 py-2">{row.supplierSku ?? "—"}</td>
                <td className="px-2 py-2 font-mono">{row.gtin ?? "—"}</td>
                <td className="px-2 py-2">{row.sizeRaw ?? "—"}</td>
                <td className="px-2 py-2 text-right align-top">
                  <div className="inline-flex flex-col items-end">
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
                    <PriceReferenceHint
                      row={row}
                      priceFieldValue={editPrice[row.supplierVariantId] ?? normalizeNumber(row.price ?? "")}
                    />
                  </div>
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
                      {isNer ? (
                        <button
                          type="button"
                          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800"
                          onClick={() => setDetailVariantId(row.supplierVariantId)}
                        >
                          Product data
                        </button>
                      ) : null}
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
                <td className="px-2 py-4 text-center text-slate-500" colSpan={10}>
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

      <PartnerProductDataModal
        open={detailVariantId != null}
        supplierVariantId={detailVariantId}
        onClose={() => setDetailVariantId(null)}
        onSaved={() => void loadItems(offset, "replace")}
      />
    </div>
  );
}
