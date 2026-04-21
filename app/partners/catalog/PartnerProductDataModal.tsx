"use client";

import { useEffect, useState } from "react";

export type PartnerProductDataModalProps = {
  open: boolean;
  supplierVariantId: string | null;
  onClose: () => void;
  onSaved: () => void;
};

type VariantJson = Record<string, unknown>;

function field(v: VariantJson | null, key: string): string {
  if (!v) return "";
  const x = v[key];
  if (x === null || x === undefined) return "";
  if (typeof x === "boolean") return x ? "1" : "";
  return String(x);
}

export function PartnerProductDataModal({ open, supplierVariantId, onClose, onSaved }: PartnerProductDataModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listingBusy, setListingBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [v, setV] = useState<VariantJson | null>(null);
  const [mapping, setMapping] = useState<{ status?: string; kickdbVariantId?: string | null } | null>(null);
  const [imagesText, setImagesText] = useState("");

  useEffect(() => {
    if (!open || !supplierVariantId) {
      setV(null);
      setMapping(null);
      setImagesText("");
      return;
    }
    setErr(null);
    setMsg(null);
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/partners/variants/${encodeURIComponent(supplierVariantId)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Load failed");
        const variant = data.variant as VariantJson;
        setV(variant);
        setMapping(data.mapping ?? null);
        setImagesText(
          variant.images != null ? JSON.stringify(variant.images, null, 2) : ""
        );
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Load failed");
        setV(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, supplierVariantId]);

  const setScalar = (key: string, value: string) => {
    setV((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const save = async () => {
    if (!v?.supplierVariantId) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      let images: unknown = null;
      const trimmed = imagesText.trim();
      if (trimmed) {
        try {
          images = JSON.parse(trimmed) as unknown;
        } catch {
          throw new Error("images must be valid JSON (array of URLs or object).");
        }
      }

      const price = Number.parseFloat(String(v.price ?? "").replace(",", "."));
      const stock = Number.parseInt(String(v.stock ?? ""), 10);
      if (!Number.isFinite(price) || price < 0) throw new Error("Invalid price");
      if (!Number.isFinite(stock) || stock < 0) throw new Error("Invalid stock");

      const wg = String(v.weightGrams ?? "").trim();
      const weightGrams = wg === "" ? null : Number.parseInt(wg, 10);
      if (wg !== "" && !Number.isFinite(weightGrams)) throw new Error("Invalid weight (grams)");

      const lead = String(v.leadTimeDays ?? "").trim();
      const leadTimeDays = lead === "" ? null : Number.parseInt(lead, 10);
      if (lead !== "" && !Number.isFinite(leadTimeDays)) throw new Error("Invalid lead time days");

      const iv = String(v.imageVersion ?? "").trim();
      const imageVersion = iv === "" ? null : Number.parseInt(iv, 10);
      if (iv !== "" && !Number.isFinite(imageVersion)) throw new Error("Invalid image version");

      const payload: Record<string, unknown> = {
        supplierVariantId: String(v.supplierVariantId),
        supplierSku: String(v.supplierSku ?? "").trim() || undefined,
        providerKey: String(v.providerKey ?? "").trim() || null,
        gtin: String(v.gtin ?? "").trim() || null,
        supplierBrand: String(v.supplierBrand ?? "").trim() || null,
        supplierProductName: String(v.supplierProductName ?? "").trim() || null,
        supplierGender: String(v.supplierGender ?? "").trim() || null,
        supplierColorway: String(v.supplierColorway ?? "").trim() || null,
        sizeRaw: String(v.sizeRaw ?? "").trim() || null,
        sizeNormalized: String(v.sizeNormalized ?? "").trim() || null,
        price,
        stock,
        weightGrams,
        images,
        sourceImageUrl: String(v.sourceImageUrl ?? "").trim() || null,
        hostedImageUrl: String(v.hostedImageUrl ?? "").trim() || null,
        imageSyncStatus: String(v.imageSyncStatus ?? "").trim() || null,
        imageVersion,
        imageSyncError: String(v.imageSyncError ?? "").trim() || null,
        deliveryType: String(v.deliveryType ?? "").trim() || null,
        leadTimeDays,
        manualNote: String(v.manualNote ?? "").trim() || null,
      };

      const mp = String(v.manualPrice ?? "").trim();
      if (mp !== "") {
        const m = Number.parseFloat(mp.replace(",", "."));
        if (!Number.isFinite(m)) throw new Error("Invalid manual price");
        payload.manualPrice = m;
      } else {
        payload.manualPrice = null;
      }

      const ms = String(v.manualStock ?? "").trim();
      if (ms !== "") {
        const m = Number.parseInt(ms, 10);
        if (!Number.isFinite(m)) throw new Error("Invalid manual stock");
        payload.manualStock = m;
      } else {
        payload.manualStock = null;
      }

      payload.manualLock = Boolean(v.manualLock);

      const res = await fetch("/api/partners/catalog/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: [payload] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Save failed");
      setMsg("Saved.");
      onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const listingReady = async () => {
    if (!supplierVariantId) return;
    setListingBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/partners/variants/${encodeURIComponent(supplierVariantId)}/listing-ready`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not mark listing-ready");
      setMsg(data.message ?? "Marked for feeds (no KickDB).");
      onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "listing-ready failed");
    } finally {
      setListingBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Product data (DB)</div>
            <div className="text-xs text-slate-500 font-mono">{supplierVariantId ?? ""}</div>
            {mapping ? (
              <div className="text-[11px] text-slate-500 mt-0.5">
                Mapping: {mapping.status ?? "—"}
                {mapping.kickdbVariantId ? " · KickDB-linked" : " · no KickDB"}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="space-y-3 p-4 text-xs">
          {err ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">{err}</div>
          ) : null}
          {msg ? (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">{msg}</div>
          ) : null}

          {loading ? (
            <div className="text-slate-500 py-8 text-center">Loading…</div>
          ) : v ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-medium text-slate-600">Supplier SKU</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 font-mono"
                  value={field(v, "supplierSku")}
                  onChange={(e) => setScalar("supplierSku", e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">GTIN</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 font-mono"
                  value={field(v, "gtin")}
                  onChange={(e) => setScalar("gtin", e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Provider key</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-[11px]"
                  value={field(v, "providerKey")}
                  onChange={(e) => setScalar("providerKey", e.target.value)}
                />
                <span className="block text-[10px] text-slate-400">
                  Must match Galaxus rule: built from GTIN + variant id for feeds.
                </span>
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Price (CHF)</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-right"
                  value={field(v, "price")}
                  onChange={(e) => setScalar("price", e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Stock</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-right"
                  value={field(v, "stock")}
                  onChange={(e) => setScalar("stock", e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Brand</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5"
                  value={field(v, "supplierBrand")}
                  onChange={(e) => setScalar("supplierBrand", e.target.value)}
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-medium text-slate-600">Product name</span>
                <textarea
                  className="w-full min-h-[3rem] rounded border border-slate-200 px-2 py-1.5"
                  rows={2}
                  value={field(v, "supplierProductName")}
                  onChange={(e) => setScalar("supplierProductName", e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Gender (Decathlon / specs)</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5"
                  placeholder="e.g. men, women, unisex"
                  value={field(v, "supplierGender")}
                  onChange={(e) => setScalar("supplierGender", e.target.value)}
                />
                <span className="block text-[10px] text-slate-400">
                  Used when there is no KickDB link (replaces KickDB product gender).
                </span>
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Colorway (Decathlon / specs)</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5"
                  placeholder="e.g. Cement / Douglas Fir"
                  value={field(v, "supplierColorway")}
                  onChange={(e) => setScalar("supplierColorway", e.target.value)}
                />
                <span className="block text-[10px] text-slate-400">
                  Used when there is no KickDB link (replaces KickDB colorway).
                </span>
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Size (raw)</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5"
                  value={field(v, "sizeRaw")}
                  onChange={(e) => setScalar("sizeRaw", e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Size (normalized)</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5"
                  value={field(v, "sizeNormalized")}
                  onChange={(e) => setScalar("sizeNormalized", e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Weight (g)</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-right"
                  value={field(v, "weightGrams")}
                  onChange={(e) => setScalar("weightGrams", e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Lead time (days)</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-right"
                  value={field(v, "leadTimeDays")}
                  onChange={(e) => setScalar("leadTimeDays", e.target.value)}
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-medium text-slate-600">Source image URL</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-[11px]"
                  value={field(v, "sourceImageUrl")}
                  onChange={(e) => setScalar("sourceImageUrl", e.target.value)}
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-medium text-slate-600">Hosted image URL</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-[11px]"
                  value={field(v, "hostedImageUrl")}
                  onChange={(e) => setScalar("hostedImageUrl", e.target.value)}
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-medium text-slate-600">images (JSON)</span>
                <textarea
                  className="w-full min-h-[5rem] rounded border border-slate-200 px-2 py-1.5 font-mono text-[11px]"
                  value={imagesText}
                  onChange={(e) => setImagesText(e.target.value)}
                  placeholder='["https://..."] or {}'
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Image sync status</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5"
                  value={field(v, "imageSyncStatus")}
                  onChange={(e) => setScalar("imageSyncStatus", e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Image version</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-right"
                  value={field(v, "imageVersion")}
                  onChange={(e) => setScalar("imageVersion", e.target.value)}
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-medium text-slate-600">Image sync error (read/write)</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-[11px]"
                  value={field(v, "imageSyncError")}
                  onChange={(e) => setScalar("imageSyncError", e.target.value)}
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-medium text-slate-600">Delivery type</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5"
                  value={field(v, "deliveryType")}
                  onChange={(e) => setScalar("deliveryType", e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Manual price</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-right"
                  value={field(v, "manualPrice")}
                  onChange={(e) => setScalar("manualPrice", e.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Manual stock</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-right"
                  value={field(v, "manualStock")}
                  onChange={(e) => setScalar("manualStock", e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={Boolean(v.manualLock)}
                  onChange={(e) => setV((prev) => (prev ? { ...prev, manualLock: e.target.checked } : prev))}
                />
                <span className="text-[11px] font-medium text-slate-600">Manual lock</span>
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-[11px] font-medium text-slate-600">Manual note</span>
                <input
                  className="w-full rounded border border-slate-200 px-2 py-1.5"
                  value={field(v, "manualNote")}
                  onChange={(e) => setScalar("manualNote", e.target.value)}
                />
              </label>
              <div className="sm:col-span-2 rounded border border-slate-100 bg-slate-50 px-2 py-2 text-[10px] text-slate-500 space-y-0.5">
                <div>lastSyncAt: {field(v, "lastSyncAt") || "—"}</div>
                <div>updatedAt: {field(v, "updatedAt") || "—"}</div>
              </div>
            </div>
          ) : (
            <div className="text-slate-500 py-6 text-center">No data</div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-700"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 disabled:opacity-50"
              disabled={!v || listingBusy || saving}
              onClick={() => void listingReady()}
            >
              {listingBusy ? "…" : "Skip KickDB — ready for feeds"}
            </button>
            <button
              type="button"
              className="rounded-full bg-[#55b3f3] px-4 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-50"
              disabled={!v || saving || listingBusy}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save to DB"}
            </button>
          </div>
          <p className="text-[10px] text-slate-500 leading-snug">
            Use <strong>Save to DB</strong> for ProductData fields (GTIN, images, names, etc.). When KickDB cannot
            enrich this SKU, use <strong>Skip KickDB — ready for feeds</strong> after GTIN + provider key + image are
            correct: it sets mapping to SUPPLIER_GTIN (no KickDB) and resolves inbox rows so Galaxus export / Decathlon
            catalog paths can treat it like a normal supplier-GTIN offer. For Decathlon product CSV without KickDB, also
            set <strong>Gender</strong> and <strong>Colorway</strong> above (mirrors KickDB fields).
          </p>
        </div>
      </div>
    </div>
  );
}
