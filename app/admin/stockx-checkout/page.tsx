"use client";

import { useCallback, useEffect, useState } from "react";

type Preview = {
  previewId: string;
  createdAt: string;
  orderName: string;
  title: string;
  sku: string;
  sizeEU: string;
  saleChf: number | null;
  productUrl: string;
  buyUrl: string | null;
  lane: string;
  itemChf: number | null;
  feesChf: number | null;
  shippingChf: number | null;
  totalChf: number | null;
  eta: string | null;
  payButton: string | null;
  withinCap: boolean;
  maxAllInChf: number;
  screenshotRel: string;
  screenshotDataUrl?: string | null;
};

type LastConfirm = {
  at: string;
  orderName: string;
  totalChf: number | null;
  stockxOrderNumber: string | null;
  ok: boolean;
  error: string | null;
};

const VNC_URL =
  "/stockx-vnc/vnc.html?autoconnect=1&resize=scale&reconnect=1&path=stockx-vnc/websockify";

export default function StockxCheckoutPage() {
  const [orderName, setOrderName] = useState("#7541");
  const [slug, setSlug] = useState("");
  const [confirmTotal, setConfirmTotal] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [lastConfirm, setLastConfirm] = useState<LastConfirm | null>(null);
  const [busy, setBusy] = useState<"preview" | "confirm" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showScreen, setShowScreen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/stockx-checkout");
      const data = await res.json();
      if (data?.ok) {
        setPreview(data.preview ?? null);
        setLastConfirm(data.lastConfirm ?? null);
        if (data.preview?.totalChf != null) setConfirmTotal(String(data.preview.totalChf));
      }
    } catch {
      // keep last
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runPreview = async () => {
    setBusy("preview");
    setMessage(null);
    setShowScreen(true);
    try {
      const res = await fetch("/api/admin/stockx-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          orderName,
          slug: slug.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!data?.ok) {
        setMessage(data?.error || "Preview failed");
      } else {
        setPreview(data.preview);
        setConfirmTotal(String(data.preview.totalChf ?? ""));
        setMessage(
          data.preview.withinCap
            ? `Preview OK — total ${data.preview.totalChf} CHF (${data.preview.lane})`
            : `Preview over cap — ${data.preview.totalChf} > ${data.preview.maxAllInChf} CHF`
        );
      }
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Network error");
    } finally {
      setBusy(null);
    }
  };

  const runConfirm = async () => {
    if (!preview) return;
    const typed = Number(String(confirmTotal).replace(",", "."));
    if (!Number.isFinite(typed)) {
      setMessage("Type the exact total CHF to confirm");
      return;
    }
    if (
      !window.confirm(
        `Buy ${preview.orderName} for ${typed} CHF on StockX (${preview.lane})?\nThis charges the card.`
      )
    ) {
      return;
    }
    setBusy("confirm");
    setMessage(null);
    setShowScreen(true);
    try {
      const res = await fetch("/api/admin/stockx-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          previewId: preview.previewId,
          confirmTotalChf: typed,
        }),
      });
      const data = await res.json();
      setMessage(
        data?.ok
          ? `Bought — StockX ${data.stockxOrderNumber || "order placed"}`
          : data?.error || "Confirm failed"
      );
      await load();
    } catch (e: any) {
      setMessage(e?.message || "Network error");
    } finally {
      setBusy(null);
    }
  };

  const canConfirm =
    Boolean(preview?.payButton) &&
    Boolean(preview?.withinCap) &&
    preview?.totalChf != null &&
    busy == null;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">StockX checkout</h1>
          <p className="mt-1 text-sm text-gray-600">
            Preview goes to <strong>Passer commande</strong> without paying. Confirm is a separate
            click and must retype the exact total. Cap {preview?.maxAllInChf ?? 250} CHF all-in.
            Standard lane preferred over Express.
          </p>
        </div>

        <div className="rounded-lg border bg-white p-4 space-y-3">
          <label className="block text-sm">
            Shopify order
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={orderName}
              onChange={(e) => setOrderName(e.target.value)}
              placeholder="#7541"
            />
          </label>
          <label className="block text-sm">
            StockX slug (optional)
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="adidas-handball-spezial-fox-brown-clear-sky"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={busy != null}
              onClick={() => void runPreview()}
            >
              {busy === "preview" ? "Preview running…" : "1. Preview (no pay)"}
            </button>
            <button
              className="rounded border px-4 py-2 text-sm"
              onClick={() => setShowScreen((v) => !v)}
            >
              {showScreen ? "Hide VNC" : "Show VNC"}
            </button>
            <a className="rounded border px-4 py-2 text-sm" href="/admin/stockx-login">
              StockX login
            </a>
          </div>
        </div>

        {message && (
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {message}
          </div>
        )}

        {preview && (
          <div className="rounded-lg border bg-white p-4 space-y-2 text-sm">
            <div className="font-semibold">
              {preview.orderName} — {preview.title}
            </div>
            <div>
              {preview.sku} · {preview.sizeEU} · lane {preview.lane}
            </div>
            <div>
              Sale {preview.saleChf ?? "?"} CHF → buy total{" "}
              <strong>{preview.totalChf ?? "?"} CHF</strong>
              {preview.saleChf != null && preview.totalChf != null
                ? ` (margin ${(preview.saleChf - preview.totalChf).toFixed(2)} CHF)`
                : ""}
            </div>
            <div>
              Item {preview.itemChf ?? "?"} + fees {preview.feesChf ?? "?"} + ship{" "}
              {preview.shippingChf ?? "?"}
            </div>
            <div>ETA {preview.eta || "?"}</div>
            <div>Pay button: {preview.payButton || "not found"}</div>
            <div className={preview.withinCap ? "text-green-700" : "text-red-700"}>
              {preview.withinCap ? "Within cap" : "OVER CAP — confirm blocked"}
            </div>
            {preview.screenshotDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.screenshotDataUrl}
                alt="Checkout preview"
                className="mt-2 max-h-96 w-full rounded border object-contain bg-gray-100"
              />
            )}
            <div className="flex flex-wrap items-end gap-2 pt-2">
              <label className="block text-sm">
                Retype total CHF to unlock buy
                <input
                  className="mt-1 w-40 rounded border px-3 py-2"
                  value={confirmTotal}
                  onChange={(e) => setConfirmTotal(e.target.value)}
                />
              </label>
              <button
                className="rounded bg-green-700 px-4 py-2 text-sm text-white disabled:opacity-40"
                disabled={!canConfirm}
                onClick={() => void runConfirm()}
              >
                {busy === "confirm" ? "Buying…" : "2. Confirm buy (charges card)"}
              </button>
            </div>
          </div>
        )}

        {lastConfirm && (
          <div className="rounded border bg-white px-3 py-2 text-xs text-gray-700">
            Last confirm {lastConfirm.at}: {lastConfirm.orderName}{" "}
            {lastConfirm.ok ? "OK" : "FAIL"} · {lastConfirm.stockxOrderNumber || "—"} ·{" "}
            {lastConfirm.error || `${lastConfirm.totalChf} CHF`}
          </div>
        )}

        {showScreen && (
          <div className="overflow-hidden rounded-lg border bg-black">
            <iframe title="StockX VNC" src={VNC_URL} className="h-[70vh] w-full" />
          </div>
        )}
      </div>
    </div>
  );
}
