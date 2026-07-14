"use client";

import { useMemo, useState } from "react";

type PreviewRow = {
  galaxusOrderId: string;
  orderNumber: string | null;
  productName: string;
  sku: string;
  size: string;
  gtin: string;
  quantity: number;
  unitNetPrice: number | null;
  lineNetAmount: number | null;
  currency: string;
};

type PreviewInvoice = {
  partnerKey: string;
  partnerName: string;
  date: string;
  currency: string;
  rows: PreviewRow[];
  totalLineNet: number;
  totalUnits: number;
};

function todayYmdZurich(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function money(n: number | null | undefined, currency = "CHF"): string {
  if (n == null || !Number.isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("de-CH", { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export default function PartnerInvoicesPage() {
  const [date, setDate] = useState(todayYmdZurich);
  const [busy, setBusy] = useState<"preview" | "csv" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<PreviewInvoice | null>(null);

  const canRun = useMemo(() => /^\d{4}-\d{2}-\d{2}$/.test(date), [date]);

  const download = async (format: "csv" | "pdf") => {
    if (!canRun) {
      setError("Pick a valid date.");
      return;
    }
    setBusy(format);
    setError(null);
    try {
      const res = await fetch(
        `/api/partners/sales-invoice?date=${encodeURIComponent(date)}&format=${format}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match =
        disposition.match(/filename\*=UTF-8''([^;]+)$/i) ||
        disposition.match(/filename="([^"]+)"/i) ||
        disposition.match(/filename=([^;]+)/i);
      const fallback = `partner-sales-${date}.${format}`;
      const filename = match?.[1] ? decodeURIComponent(match[1]) : fallback;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(null);
    }
  };

  const preview = async () => {
    if (!canRun) {
      setError("Pick a valid date.");
      return;
    }
    setBusy("preview");
    setError(null);
    try {
      const res = await fetch(
        `/api/partners/sales-invoice?date=${encodeURIComponent(date)}&format=json`,
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !(data as { ok?: boolean }).ok) {
        throw new Error((data as { error?: string }).error ?? "Preview failed");
      }
      setInvoice((data as { invoice: PreviewInvoice }).invoice);
    } catch (err: unknown) {
      setInvoice(null);
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Sales invoice</h1>
        <p className="text-sm text-slate-500">
          Pick a day. Export CSV or PDF of your Galaxus sales (product name / SKU / size / sell
          price from the Galaxus order — works even if catalog products were deleted).
        </p>
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Sell prices already account for the <strong>2% Galaxus fast-payment</strong> deduction.
        </p>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Date (Europe/Zurich)</span>
            <input
              type="date"
              className="rounded border border-slate-300 px-3 py-2 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={busy != null}
            />
          </label>
          <button
            type="button"
            className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-50"
            onClick={() => void preview()}
            disabled={busy != null || !canRun}
          >
            {busy === "preview" ? "Loading…" : "Preview"}
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-800 disabled:opacity-50"
            onClick={() => void download("csv")}
            disabled={busy != null || !canRun}
          >
            {busy === "csv" ? "…" : "Download CSV"}
          </button>
          <button
            type="button"
            className="rounded-full bg-[#55b3f3] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-950 disabled:opacity-50"
            onClick={() => void download("pdf")}
            disabled={busy != null || !canRun}
          >
            {busy === "pdf" ? "…" : "Download PDF"}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Uses Galaxus <strong>order date</strong>, not ship date. Cancelled orders excluded.
        </p>
      </section>

      {invoice ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {invoice.partnerName} · {invoice.date}
              </div>
              <div className="text-xs text-slate-500">
                {invoice.rows.length} line(s) · {invoice.totalUnits} unit(s)
              </div>
            </div>
            <div className="text-lg font-semibold tabular-nums text-slate-900">
              {money(invoice.totalLineNet, invoice.currency)}
            </div>
          </div>

          <div className="overflow-auto border rounded max-h-[28rem]">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-2 py-2 text-left">Order</th>
                  <th className="px-2 py-2 text-left">Product</th>
                  <th className="px-2 py-2 text-left">SKU</th>
                  <th className="px-2 py-2 text-left">Size</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Unit net</th>
                  <th className="px-2 py-2 text-right">Line net</th>
                </tr>
              </thead>
              <tbody>
                {invoice.rows.length === 0 ? (
                  <tr>
                    <td className="px-2 py-3 text-slate-500" colSpan={7}>
                      No partner sales on this date.
                    </td>
                  </tr>
                ) : (
                  invoice.rows.map((row, idx) => (
                    <tr key={`${row.galaxusOrderId}-${idx}`} className="border-t">
                      <td className="px-2 py-1.5 font-mono">{row.galaxusOrderId}</td>
                      <td className="px-2 py-1.5">{row.productName}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px]">{row.sku}</td>
                      <td className="px-2 py-1.5">{row.size}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{row.quantity}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {money(row.unitNetPrice, row.currency)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {money(row.lineNetAmount, row.currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
