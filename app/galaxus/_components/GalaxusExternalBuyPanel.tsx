"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  orderId: string | null | undefined;
  line: {
    id: string;
    quantity?: number;
    supplierKey?: string | null;
    providerKey?: string | null;
    supplierPid?: string | null;
    productName?: string | null;
    procurement?: {
      ok?: boolean;
      source?: string | null;
      supplierKey?: string | null;
      stockxOrderNumber?: string | null;
      stockxCostChf?: number | null;
      awb?: string | null;
      trackingUrl?: string | null;
      externalBuyNote?: string | null;
    } | null;
  };
  onSaved?: () => void | Promise<void>;
};

function resolveSupplierKey(line: Props["line"]): string {
  const fromProc = String(line.procurement?.supplierKey ?? "").trim().toUpperCase();
  if (fromProc) return fromProc.slice(0, 3);
  for (const raw of [line.supplierKey, line.providerKey, line.supplierPid]) {
    const p = String(raw ?? "").trim().toUpperCase().split("_")[0];
    if (p && /^[A-Z]{3}$/.test(p)) return p;
  }
  return "REI";
}

const EXTERNAL_KEYS = new Set(["REI", "WEL", "SNL", "BAE", "TRM", "GLD"]);

export function isExternalBuyLine(line: {
  supplierKey?: string | null;
  providerKey?: string | null;
  supplierPid?: string | null;
  procurement?: { source?: string | null; warehouseStockHint?: string | null } | null;
}): boolean {
  if (line.procurement?.warehouseStockHint) return false;
  if (line.procurement?.source === "external_buy") return true;
  const key = resolveSupplierKey(line as Props["line"]);
  return EXTERNAL_KEYS.has(key) && key !== "STX";
}

export default function GalaxusExternalBuyPanel({ orderId, line, onSaved }: Props) {
  const supplierKey = useMemo(() => resolveSupplierKey(line), [line]);
  const linked = line.procurement?.source === "external_buy" && Boolean(line.procurement?.ok);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState("");
  const [cost, setCost] = useState("");
  const [tracking, setTracking] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!linked) return;
    setOrderNumber(String(line.procurement?.stockxOrderNumber ?? ""));
    setCost(
      line.procurement?.stockxCostChf != null && Number.isFinite(Number(line.procurement.stockxCostChf))
        ? String(line.procurement.stockxCostChf)
        : ""
    );
    setTracking(String(line.procurement?.awb ?? ""));
    setTrackingUrl(String(line.procurement?.trackingUrl ?? ""));
    setNote(String(line.procurement?.externalBuyNote ?? ""));
  }, [linked, line.procurement]);

  if (!orderId || !EXTERNAL_KEYS.has(supplierKey)) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/galaxus/orders/${orderId}/external-buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineId: line.id,
          unitIndex: 0,
          supplierKey,
          supplierOrderNumber: orderNumber,
          costAmount: cost === "" ? null : Number(String(cost).replace(",", ".")),
          trackingNumber: tracking || null,
          trackingUrl: trackingUrl || null,
          note: note || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Save failed");
      setOpen(false);
      await onSaved?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirm(`Unlink ${supplierKey} buy from this line?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/galaxus/orders/${orderId}/external-buy`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId: line.id, unitIndex: 0 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Unlink failed");
      setOrderNumber("");
      setCost("");
      setTracking("");
      setTrackingUrl("");
      setNote("");
      setOpen(false);
      await onSaved?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unlink failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded border border-sky-200 bg-sky-50/40 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium text-sky-950">
          {supplierKey} buy{" "}
          {linked ? (
            <span className="text-green-700">
              · linked {line.procurement?.stockxOrderNumber ?? ""}
              {line.procurement?.stockxCostChf != null
                ? ` · CHF ${Number(line.procurement.stockxCostChf).toFixed(2)}`
                : ""}
            </span>
          ) : (
            <span className="text-amber-800">· not linked</span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            className="text-[10px] px-1.5 py-0.5 rounded bg-sky-800 text-white disabled:opacity-50"
            onClick={() => setOpen((v) => !v)}
            disabled={busy}
          >
            {open ? "Close" : linked ? "Edit" : "Link"}
          </button>
          {linked ? (
            <button
              type="button"
              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-800 disabled:opacity-50"
              onClick={() => void clear()}
              disabled={busy}
            >
              Unlink
            </button>
          ) : null}
        </div>
      </div>
      {linked && line.procurement?.awb ? (
        <div className="text-[10px] text-gray-600">
          Tracking:{" "}
          {line.procurement.trackingUrl ? (
            <a
              href={line.procurement.trackingUrl}
              target="_blank"
              rel="noreferrer"
              className="underline text-sky-800"
            >
              {line.procurement.awb}
            </a>
          ) : (
            line.procurement.awb
          )}
        </div>
      ) : null}
      {open ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
          <label className="space-y-0.5">
            <span className="text-gray-600">Order #</span>
            <input
              className="w-full border rounded px-1.5 py-1"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="Reichelt / supplier order id"
            />
          </label>
          <label className="space-y-0.5">
            <span className="text-gray-600">Cost CHF (line total)</span>
            <input
              className="w-full border rounded px-1.5 py-1"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="e.g. 19.63"
            />
          </label>
          <label className="space-y-0.5">
            <span className="text-gray-600">Tracking #</span>
            <input
              className="w-full border rounded px-1.5 py-1"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
            />
          </label>
          <label className="space-y-0.5">
            <span className="text-gray-600">Tracking URL</span>
            <input
              className="w-full border rounded px-1.5 py-1"
              value={trackingUrl}
              onChange={(e) => setTrackingUrl(e.target.value)}
            />
          </label>
          <label className="space-y-0.5 sm:col-span-2">
            <span className="text-gray-600">Note</span>
            <input
              className="w-full border rounded px-1.5 py-1"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error ? <div className="sm:col-span-2 text-red-600">{error}</div> : null}
          <div className="sm:col-span-2">
            <button
              type="button"
              className="px-2 py-1 rounded bg-sky-900 text-white text-[11px] disabled:opacity-50"
              disabled={busy || !orderNumber.trim()}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save link"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
