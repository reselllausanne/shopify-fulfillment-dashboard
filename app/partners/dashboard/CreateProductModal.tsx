"use client";

import { useEffect, useMemo, useState } from "react";

export type CreateProductModalProps = {
  open: boolean;
  initialMode?: "custom" | "from-db";
  onClose: () => void;
  onCreated: (info: { supplierVariantId: string; mappingStatus: string }) => void;
};

type BaseLookupItem = {
  gtin: string;
  supplierSku?: string | null;
  supplierBrand?: string | null;
  supplierProductName?: string | null;
  supplierGender?: string | null;
  supplierColorway?: string | null;
  hostedImageUrl?: string | null;
  sourceImageUrl?: string | null;
  images?: unknown;
  weightGrams?: number | null;
};

type FormState = {
  sku: string;
  size: string;
  price: string;
  stock: string;
  gtin: string;
  supplierBrand: string;
  supplierProductName: string;
  supplierGender: string;
  supplierColorway: string;
  weightGrams: string;
  leadTimeDays: string;
  hostedImageUrl: string;
  sourceImageUrl: string;
  manualNote: string;
};

const EMPTY_FORM: FormState = {
  sku: "",
  size: "",
  price: "",
  stock: "",
  gtin: "",
  supplierBrand: "",
  supplierProductName: "",
  supplierGender: "",
  supplierColorway: "",
  weightGrams: "",
  leadTimeDays: "",
  hostedImageUrl: "",
  sourceImageUrl: "",
  manualNote: "",
};

export function CreateProductModal({
  open,
  initialMode = "custom",
  onClose,
  onCreated,
}: CreateProductModalProps) {
  const [mode, setMode] = useState<"custom" | "from-db">(initialMode);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // From-DB lookup state
  const [lookupQ, setLookupQ] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResults, setLookupResults] = useState<BaseLookupItem[]>([]);
  const [selectedBase, setSelectedBase] = useState<BaseLookupItem | null>(null);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setForm(EMPTY_FORM);
      setOverwrite(false);
      setErr(null);
      setMsg(null);
      setLookupQ("");
      setLookupResults([]);
      setSelectedBase(null);
    }
  }, [open, initialMode]);

  const setField = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const runLookup = async () => {
    const q = lookupQ.trim();
    if (!q) return;
    setLookupBusy(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (/^\d{8,14}$/.test(q)) params.set("gtin", q);
      else params.set("q", q);
      params.set("limit", "20");
      const res = await fetch(`/api/partners/catalog/base-lookup?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Lookup failed");
      setLookupResults(Array.isArray(data.items) ? data.items : []);
      if ((data.items ?? []).length === 0) setErr("No matching products in DB");
    } catch (e: any) {
      setErr(e?.message ?? "Lookup failed");
    } finally {
      setLookupBusy(false);
    }
  };

  const applyBase = (item: BaseLookupItem) => {
    setSelectedBase(item);
    setForm((prev) => ({
      ...prev,
      gtin: prev.gtin || item.gtin,
      supplierBrand: prev.supplierBrand || (item.supplierBrand ?? ""),
      supplierProductName: prev.supplierProductName || (item.supplierProductName ?? ""),
      supplierGender: prev.supplierGender || (item.supplierGender ?? ""),
      supplierColorway: prev.supplierColorway || (item.supplierColorway ?? ""),
      hostedImageUrl: prev.hostedImageUrl || (item.hostedImageUrl ?? ""),
      sourceImageUrl: prev.sourceImageUrl || (item.sourceImageUrl ?? ""),
      weightGrams:
        prev.weightGrams ||
        (item.weightGrams != null ? String(item.weightGrams) : ""),
    }));
  };

  const validationError = useMemo(() => {
    if (!form.sku.trim()) return "SKU is required";
    if (!form.size.trim()) return "Size is required";
    if (!form.price.trim()) return "Price is required";
    if (!form.stock.trim()) return "Stock is required";
    if (form.gtin.trim() && !/^\d{8,14}$/.test(form.gtin.trim())) {
      return "GTIN must be 8/12/13/14 digits";
    }
    return null;
  }, [form]);

  const submit = async () => {
    if (validationError) {
      setErr(validationError);
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const payload: Record<string, unknown> = {
        mode,
        sku: form.sku.trim(),
        size: form.size.trim(),
        price: form.price.trim(),
        stock: form.stock.trim(),
        gtin: form.gtin.trim() || null,
        supplierBrand: form.supplierBrand.trim() || null,
        supplierProductName: form.supplierProductName.trim() || null,
        supplierGender: form.supplierGender.trim() || null,
        supplierColorway: form.supplierColorway.trim() || null,
        weightGrams: form.weightGrams.trim() || null,
        leadTimeDays: form.leadTimeDays.trim() || null,
        hostedImageUrl: form.hostedImageUrl.trim() || null,
        sourceImageUrl: form.sourceImageUrl.trim() || null,
        manualNote: form.manualNote.trim() || null,
        overwrite,
      };
      const res = await fetch("/api/partners/catalog/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.conflict) {
        setErr(
          (data.error ?? "Variant already exists") +
            " Tick the overwrite box below to replace."
        );
        return;
      }
      if (!res.ok || !data.ok) {
        throw new Error(data?.error ?? "Create failed");
      }
      setMsg(
        `Created ${data.supplierVariantId} (mapping ${data.mappingStatus}). Open Catalog to publish to feeds.`
      );
      onCreated({
        supplierVariantId: String(data.supplierVariantId),
        mappingStatus: String(data.mappingStatus ?? ""),
      });
    } catch (e: any) {
      setErr(e?.message ?? "Create failed");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Create product</div>
            <div className="text-xs text-slate-500">
              Add a single offer without uploading a CSV.
            </div>
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
          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5 text-[11px]">
            <button
              type="button"
              className={`rounded-full px-3 py-1 ${
                mode === "from-db"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              onClick={() => setMode("from-db")}
            >
              Use existing DB product
            </button>
            <button
              type="button"
              className={`rounded-full px-3 py-1 ${
                mode === "custom"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              onClick={() => setMode("custom")}
            >
              Custom product
            </button>
          </div>

          {err ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              {err}
            </div>
          ) : null}
          {msg ? (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
              {msg}
            </div>
          ) : null}

          {mode === "from-db" ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="text-[11px] font-medium text-slate-700">
                Find a product already in the DB (by GTIN, SKU, name, brand)
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  className="min-w-[16rem] flex-1 rounded border border-slate-200 px-2 py-1.5"
                  placeholder="e.g. 195866820350 or Air Jordan 1"
                  value={lookupQ}
                  onChange={(e) => setLookupQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runLookup();
                  }}
                />
                <button
                  type="button"
                  className="rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                  onClick={() => void runLookup()}
                  disabled={lookupBusy || !lookupQ.trim()}
                >
                  {lookupBusy ? "Searching…" : "Search"}
                </button>
              </div>
              {lookupResults.length > 0 ? (
                <div className="max-h-48 overflow-auto rounded border border-slate-200 bg-white">
                  <table className="min-w-full text-[11px]">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-2 py-1 text-left">GTIN</th>
                        <th className="px-2 py-1 text-left">Brand</th>
                        <th className="px-2 py-1 text-left">Product</th>
                        <th className="px-2 py-1 text-left">SKU sample</th>
                        <th className="px-2 py-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lookupResults.map((r) => (
                        <tr key={r.gtin} className="border-t">
                          <td className="px-2 py-1 font-mono">{r.gtin}</td>
                          <td className="px-2 py-1">{r.supplierBrand ?? "—"}</td>
                          <td className="px-2 py-1">{r.supplierProductName ?? "—"}</td>
                          <td className="px-2 py-1 font-mono">{r.supplierSku ?? "—"}</td>
                          <td className="px-2 py-1 text-right">
                            <button
                              type="button"
                              className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] hover:border-[#55b3f3]"
                              onClick={() => applyBase(r)}
                            >
                              {selectedBase?.gtin === r.gtin ? "Selected" : "Use"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {selectedBase ? (
                <div className="text-[11px] text-slate-600">
                  Prefilled from GTIN <span className="font-mono">{selectedBase.gtin}</span>.
                  You still set <strong>your</strong> SKU, size, price, stock below.
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Your SKU *" value={form.sku} onChange={(v) => setField("sku", v)} mono />
            <Field label="Size * (e.g. 42 or 9.5)" value={form.size} onChange={(v) => setField("size", v)} />
            <Field label="Price (CHF) *" value={form.price} onChange={(v) => setField("price", v)} align="right" />
            <Field label="Stock *" value={form.stock} onChange={(v) => setField("stock", v)} align="right" />
            <Field label="GTIN (EAN, 8/12/13/14 digits)" value={form.gtin} onChange={(v) => setField("gtin", v)} mono />
            <Field label="Brand" value={form.supplierBrand} onChange={(v) => setField("supplierBrand", v)} />
            <Field
              label="Product name"
              value={form.supplierProductName}
              onChange={(v) => setField("supplierProductName", v)}
              spanFull
            />
            <Field
              label="Gender (men / women / unisex)"
              value={form.supplierGender}
              onChange={(v) => setField("supplierGender", v)}
            />
            <Field
              label="Colorway"
              value={form.supplierColorway}
              onChange={(v) => setField("supplierColorway", v)}
            />
            <Field
              label="Weight (g)"
              value={form.weightGrams}
              onChange={(v) => setField("weightGrams", v)}
              align="right"
            />
            <Field
              label="Lead time (days)"
              value={form.leadTimeDays}
              onChange={(v) => setField("leadTimeDays", v)}
              align="right"
            />
            <Field
              label="Hosted image URL (https)"
              value={form.hostedImageUrl}
              onChange={(v) => setField("hostedImageUrl", v)}
              mono
              spanFull
            />
            <Field
              label="Source image URL"
              value={form.sourceImageUrl}
              onChange={(v) => setField("sourceImageUrl", v)}
              mono
              spanFull
            />
            <Field
              label="Internal note"
              value={form.manualNote}
              onChange={(v) => setField("manualNote", v)}
              spanFull
            />
          </div>

          <label className="flex items-center gap-2 text-[11px] text-slate-600">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Overwrite if a variant with this SKU + size already exists
          </label>

          <p className="text-[10px] leading-snug text-slate-500">
            With <strong>GTIN</strong> set, the variant is published as <code>SUPPLIER_GTIN</code>{" "}
            (ready for Galaxus & Decathlon feeds after you mark it ready in Catalog →
            Product data). Without GTIN, it is saved as <code>PENDING_GTIN</code> draft —
            it stays in your catalog but is not pushed to marketplaces.
          </p>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-700"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-full bg-[#55b3f3] px-4 py-1.5 text-xs font-semibold text-slate-950 disabled:opacity-50"
              onClick={() => void submit()}
              disabled={busy || Boolean(validationError)}
              title={validationError ?? ""}
            >
              {busy ? "Saving…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  align?: "right" | "left";
  spanFull?: boolean;
}) {
  const { label, value, onChange, mono, align, spanFull } = props;
  return (
    <label className={`space-y-1 ${spanFull ? "sm:col-span-2" : ""}`}>
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      <input
        className={`w-full rounded border border-slate-200 px-2 py-1.5 ${
          mono ? "font-mono text-[11px]" : ""
        } ${align === "right" ? "text-right" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
