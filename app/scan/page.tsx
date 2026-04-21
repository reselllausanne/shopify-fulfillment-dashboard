
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ScanStatus = "FOUND" | "NOT_FOUND" | "UNMATCHED" | "ERROR";

type ScanResult = {
  ok: boolean;
  status: ScanStatus;
  awb: string;
  match: any | null;
  decathlon?: {
    matchId?: string | null;
    orderId: string | null;
    orderDbId: string | null;
    orderNumber?: string | null;
    orderState?: string | null;
  } | null;
  galaxus?: {
    matchId?: string | null;
    orderId: string | null;
    orderDbId: string | null;
    orderNumber?: string | null;
  } | null;
  error?: { message?: string; code?: string };
};

type HistoryItem = {
  ts: string;
  awb: string;
  status: ScanStatus;
  orderName?: string | null;
  durationMs?: number;
  gapMs?: number;
};

type GoatTrackingItem = {
  id: string;
  shopifyOrderName: string;
  shopifyLineItemId: string;
  shopifyCustomerEmail: string | null;
  shopifyCustomerFirstName: string | null;
  shopifyCustomerLastName: string | null;
  shopifyCreatedAt: string | null;
  stockxOrderNumber: string;
  stockxAwb: string | null;
  stockxTrackingUrl: string | null;
  supplierSource: string | null;
};

type AwbListItem = {
  awb: string;
  shopifyOrderName?: string | null;
  shopifyOrderId?: string | null;
  shopifyCreatedAt?: string | null;
  trackingUrl?: string | null;
};

const ENABLE_FULFILLMENT = true; // feature flag placeholder (do not enable)

export default function ScanPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [fulfillLoading, setFulfillLoading] = useState(false);
  const [fulfillResult, setFulfillResult] = useState<any | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [awbList, setAwbList] = useState<AwbListItem[]>([]);
  const [awbFilter, setAwbFilter] = useState("");
  const [forceFulfill, setForceFulfill] = useState(false);
  const [goatLoading, setGoatLoading] = useState(false);
  const [goatError, setGoatError] = useState<string | null>(null);
  const [goatTracking, setGoatTracking] = useState<{ count: number; items: GoatTrackingItem[] } | null>(null);
  const canceledStates = useMemo(
    () => new Set(["CANCELED", "CANCELLED", "ORDER_CANCELLED", "CLOSED"]),
    []
  );

  useEffect(() => {
    focusInput();
  }, []);

  useEffect(() => {
    const loadAwbList = async () => {
      try {
        const res = await fetch("/api/scan-awb?list=1&limit=500");
        const data = await res.json();
        if (data?.items) setAwbList(data.items);
      } catch {
        // Non-blocking
      }
    };
    loadAwbList();
  }, []);

  const loadGoatTracking = async () => {
    setGoatLoading(true);
    setGoatError(null);
    try {
      const res = await fetch("/api/notifications/goat-tracking");
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data?.ok) {
        setGoatTracking({ count: data.count || 0, items: data.items || [] });
      } else {
        setGoatError(data?.error || "Failed to load GOAT tracking");
      }
    } catch (err: any) {
      setGoatError(err?.message || "Failed to load GOAT tracking");
    } finally {
      setGoatLoading(false);
    }
  };

  useEffect(() => {
    loadGoatTracking();
  }, []);

  const downloadPdf = async (url: string, fallbackName: string) => {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      const data = ct.includes("application/json") ? await res.json().catch(() => ({})) : {};
      throw new Error((data as any).error ?? `Download failed (${res.status})`);
    }
    const blob = await res.blob();
    const dispo = res.headers.get("Content-Disposition") ?? "";
    const match = /filename\*?=(?:UTF-8''|)([^";\n]+)|filename="([^"]+)"/i.exec(dispo);
    const rawName = (match?.[1] || match?.[2] || "").trim();
    const filename = rawName.replace(/^["']|["']$/g, "") || fallbackName;
    const urlObj = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = urlObj;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(urlObj);
    return filename;
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const isPackingSlipPendingError = (error: any) => {
    const message = String(error?.message ?? error ?? "").toLowerCase();
    return (
      message.includes("packing slip") ||
      message.includes("delivery bill") ||
      message.includes("delivery slip") ||
      message.includes("or72") ||
      message.includes("no packing slip")
    );
  };

  const downloadPackingSlipWithRetry = async (url: string, fallbackName: string) => {
    let lastError: any = null;
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await downloadPdf(url, fallbackName);
      } catch (err: any) {
        lastError = err;
        if (!isPackingSlipPendingError(err)) {
          break;
        }
        if (attempt < maxAttempts - 1) {
          const delay = Math.min(2000 * 1.6 ** attempt, 25000);
          await sleep(delay);
        }
      }
    }
    throw lastError;
  };

  const buildChannelAlert = (scan: ScanResult) => {
    const parts: string[] = [];
    if (scan.decathlon) {
      const ref = scan.decathlon.orderNumber || scan.decathlon.orderId || scan.decathlon.orderDbId || "—";
      parts.push(`Decathlon ${ref}`);
    }
    if (scan.galaxus) {
      const ref = scan.galaxus.orderNumber || scan.galaxus.orderId || scan.galaxus.orderDbId || "—";
      parts.push(`Galaxus ${ref}`);
    }
    if (parts.length === 0) return null;
    return `AWB ${scan.awb} → ${parts.join(" | ")}`;
  };

  const galaxusOrderRef = (g: NonNullable<ScanResult["galaxus"]>) =>
    String(g.orderNumber || g.orderId || g.orderDbId || "").trim() || "—";

  const resolveDecathlonOrderRef = (match: ScanResult["decathlon"]) =>
    match?.orderId || match?.orderDbId || "";

  const autoHandleDecathlon = async (match: ScanResult["decathlon"], awb: string) => {
    const orderRef = resolveDecathlonOrderRef(match);
    if (!orderRef) return;
    const state = String(match?.orderState ?? "").trim().toUpperCase();
    if (state && canceledStates.has(state)) {
      window.alert(`Decathlon order ${orderRef} is canceled; skipping fulfillment.`);
      return;
    }
    try {
      const shipRes = await fetch(`/api/decathlon/orders/${orderRef}/ship`, { method: "POST" });
      const shipData = await shipRes.json().catch(() => ({}));
      if (!shipRes.ok || !shipData.ok) {
        throw new Error(shipData.error ?? "Decathlon ship failed");
      }
      const shipmentId = String(shipData?.shipmentId ?? "").trim();
      const slipUrl = shipmentId
        ? `/api/decathlon/orders/${orderRef}/documents/packing-slip?shipmentId=${encodeURIComponent(shipmentId)}`
        : `/api/decathlon/orders/${orderRef}/documents/packing-slip`;
      const slipName = shipmentId
        ? `decathlon-delivery_${orderRef}_${shipmentId}.pdf`
        : `decathlon-delivery_${orderRef}.pdf`;
      let slipNote = "Packing slip not ready yet (OR72). Try again later.";
      try {
        const fn = await downloadPackingSlipWithRetry(slipUrl, slipName);
        slipNote = `Packing slip downloaded (${fn}).`;
      } catch {
        // Non-blocking: shipping can be ok while OR72 is still generating.
      }
      if (shipData.reconciled) {
        window.alert(
          `Decathlon order ${orderRef}: Mirakl was already shipped; your dashboard DB is now synced. ${slipNote}`
        );
      } else {
        window.alert(`Decathlon order ${orderRef} shipped. ${slipNote}`);
      }
    } catch (error: any) {
      window.alert(
        `Decathlon auto-fulfill failed for AWB ${awb}: ${error?.message ?? "Unknown error"}`
      );
    }
  };

  const handleChannelActions = async (scan: ScanResult) => {
    if (scan.galaxus) {
      const ref = galaxusOrderRef(scan.galaxus);
      window.alert(
        `Galaxus — order ${ref}\nAWB is stored on GalaxusStockxMatch (marketplace).\nNo Shopify label / fulfill on this page.`
      );
    }
    if (scan.decathlon) {
      if (!scan.galaxus) {
        const alertText = buildChannelAlert(scan);
        if (alertText) window.alert(alertText);
      }
      await autoHandleDecathlon(scan.decathlon, scan.awb);
    } else if (!scan.galaxus) {
      const alertText = buildChannelAlert(scan);
      if (alertText) window.alert(alertText);
    }
  };

  const focusInput = () => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const handleSubmit = async () => {
    const startedAt = Date.now();
    if (!code.trim()) {
      setResult({
        ok: false,
        status: "UNMATCHED",
        awb: "",
      } as ScanResult);
      focusInput();
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/scan-awb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data: ScanResult = await res.json();
      setResult(data);
      const finishedAt = Date.now();
      setHistory((prev) => {
        const prevTs = prev[0]?.ts ? new Date(prev[0].ts).getTime() : null;
        const entry: HistoryItem = {
          ts: new Date().toISOString(),
          awb: data.awb,
          status: data.status,
          orderName: data.match?.shopifyOrderName,
          durationMs: finishedAt - startedAt,
          gapMs: prevTs ? startedAt - prevTs : undefined,
        };
        return [entry, ...prev].slice(0, 20);
      });

      await handleChannelActions(data);

      if (ENABLE_FULFILLMENT && data.ok && data.match && !data.galaxus) {
        await runFulfillFromScan(data);
      }
    } catch (err: any) {
      setResult({
        ok: false,
        status: "ERROR",
        awb: "",
        match: null,
        error: { message: err?.message || "Network error" },
      });
    } finally {
      setLoading(false);
      focusInput();
    }
  };

  const formatDuration = (ms?: number) => {
    if (ms == null) return "—";
    if (ms < 1000) return `${ms}ms`;
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${min}m ${rem.toFixed(0)}s`;
  };

  const runFulfillFromScan = async (scan: ScanResult) => {
    if (!scan?.awb || !scan?.match || scan.galaxus) return;
    setFulfillLoading(true);
    setFulfillResult(null);
    try {
      const res = await fetch("/api/fulfill-from-awb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          awb: scan.awb,
          trackingUrl: scan.match?.trackingUrl || null,
          allowAlreadyFulfilled: forceFulfill,
        }),
      });
      const data = await res.json();
      setFulfillResult(data);
    } catch (err: any) {
      setFulfillResult({ ok: false, error: err?.message || "Network error" });
    } finally {
      setFulfillLoading(false);
    }
  };

  const handleFulfill = async () => {
    if (!result?.awb || !result?.match || result.galaxus) return;
    await runFulfillFromScan(result);
  };


  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  const statusColor = useMemo(() => {
    const s = result?.status;
    if (s === "FOUND") return "bg-green-50 border-green-200 text-green-800";
    if (s === "NOT_FOUND" || s === "UNMATCHED") return "bg-yellow-50 border-yellow-200 text-yellow-800";
    if (s === "ERROR") return "bg-red-50 border-red-200 text-red-800";
    return "bg-gray-50 border-gray-200 text-gray-800";
  }, [result?.status]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center p-6">
      <div className="w-full max-w-3xl relative">
        <div className="absolute right-0 top-0 flex items-center gap-2">
          <a
            href="https://admin.shopify.com/store/resell-lausanne"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200 transition-colors"
          >
            Shopify Login
          </a>
          <button
            onClick={handleLogout}
            className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
          >
            Logout
          </button>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2 text-center">📦 Scan AWB / Barcode</h1>
        <p className="text-center text-gray-600 mb-6">
          Scan AWB: Shopify orders can fulfill + label here. Galaxus marketplace hits only show a notice (AWB lives on
          GalaxusStockxMatch — no label on this page).
        </p>

        {(goatTracking?.count || goatError) && (
          <div className="mb-6 border rounded-lg p-4 bg-amber-50 border-amber-200">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-amber-800">
                🐐 GOAT / Manual orders missing tracking: {goatTracking?.count || 0}
              </div>
              <button
                onClick={loadGoatTracking}
                disabled={goatLoading}
                className="text-xs px-2 py-1 bg-amber-200 text-amber-900 rounded hover:bg-amber-300 disabled:opacity-60"
              >
                {goatLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            {goatError && (
              <div className="text-xs text-red-700 mt-2">{goatError}</div>
            )}
            {!goatError && (goatTracking?.items?.length || 0) > 0 && (
              <div className="mt-2 space-y-1 text-xs text-amber-900">
                {goatTracking!.items.map((item) => (
                  <div key={item.id} className="flex flex-wrap gap-2">
                    <span className="font-semibold">{item.shopifyOrderName}</span>
                    <span>Ref: {item.stockxOrderNumber}</span>
                    {item.shopifyCreatedAt && (
                      <span>
                        {new Date(item.shopifyCreatedAt).toLocaleDateString("fr-CH")}
                      </span>
                    )}
                    {item.shopifyCustomerEmail && <span>{item.shopifyCustomerEmail}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6 flex flex-col items-center gap-4">
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Scan or paste AWB / barcode and press Enter"
            className="w-full text-center text-xl px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400"
            >
              {loading ? "Searching..." : "Search"}
            </button>
            <button
              onClick={() => {
                setCode("");
                setResult(null);
                focusInput();
              }}
              className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Result */}
        {result && (
          <div className={`mt-6 border rounded-lg p-4 ${statusColor}`}>
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Status: {result.status}</div>
              <div className="text-sm text-gray-600">AWB: {result.awb || "—"}</div>
            </div>
            {!result.match && !result.decathlon && !result.galaxus && result.status !== "ERROR" && (
              <p className="text-sm mt-2">
                No match found. Check OrderMatch / DecathlonStockxMatch / GalaxusStockxMatch (stockxAwb or tracking URL).
              </p>
            )}

            {result.galaxus && (
              <div className="mt-4 rounded-lg border border-teal-300 bg-teal-50 p-4 text-teal-950">
                <div className="font-semibold text-teal-900">Galaxus marketplace</div>
                <p className="text-sm mt-1">
                  Order ref: <span className="font-mono">{galaxusOrderRef(result.galaxus)}</span> — AWB linked on{" "}
                  <code className="text-xs bg-teal-100 px-1 rounded">GalaxusStockxMatch</code>. No Shopify label step
                  here.
                </p>
                <a
                  href="/galaxus/warehouse"
                  className="mt-2 inline-block text-sm font-medium text-teal-800 underline hover:text-teal-950"
                >
                  Open Galaxus warehouse →
                </a>
              </div>
            )}
            {result.error && (
              <p className="text-sm mt-2 text-red-700">
                {result.error.message || "Error"} {result.error.code ? `(${result.error.code})` : ""}
              </p>
            )}

            {result.match && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="bg-white bg-opacity-80 p-3 rounded border">
                  <h3 className="font-semibold text-gray-800 mb-1">Order</h3>
                  <div>Order #: {result.match.shopifyOrderName || "—"}</div>
                  <div>Order ID: {result.match.shopifyOrderId || "—"}</div>
                  <div>Line Item ID: {result.match.shopifyLineItemId || "—"}</div>
                  <div>Match: {result.match.matchConfidence || "—"} ({result.match.matchScore ?? "—"})</div>
                </div>
                <div className="bg-white bg-opacity-80 p-3 rounded border">
                  <h3 className="font-semibold text-gray-800 mb-1">Customer</h3>
                  <div>Name: {result.match.customer?.name || "—"}</div>
                  <div>Email: {result.match.customer?.email || "—"}</div>
                  <div>Phone: {result.match.customer?.phone || "—"}</div>
                  <div>
                    Address:{" "}
                    {result.match.customer?.shippingAddress
                      ? [
                          result.match.customer.shippingAddress.address1,
                          result.match.customer.shippingAddress.address2,
                          result.match.customer.shippingAddress.zip,
                          result.match.customer.shippingAddress.city,
                          result.match.customer.shippingAddress.country,
                        ]
                          .filter(Boolean)
                          .join(", ")
                      : "—"}
                  </div>
                </div>
                <div className="bg-white bg-opacity-80 p-3 rounded border md:col-span-2">
                  <h3 className="font-semibold text-gray-800 mb-1">Item</h3>
                  <div>Title: {result.match.lineItem?.title || "—"}</div>
                  <div>Variant/Size: {result.match.lineItem?.variantTitle || "—"}</div>
                  <div>SKU: {result.match.lineItem?.sku || "—"}</div>
                  <div>Qty: {result.match.lineItem?.quantity ?? "—"}</div>
                  <div>Tracking URL: {result.match.trackingUrl || "—"}</div>
                </div>
              </div>
            )}

            {ENABLE_FULFILLMENT && (
              <div className="mt-4">
                <label className="flex items-center gap-2 text-sm text-gray-700 mb-2">
                  <input
                    type="checkbox"
                    checked={forceFulfill}
                    onChange={(e) => setForceFulfill(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  Force fulfillment (ignore existing tracking)
                </label>
                <button
                  disabled={fulfillLoading || Boolean(result?.galaxus)}
                  onClick={handleFulfill}
                  className="px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400"
                  title={result?.galaxus ? "Galaxus orders: no Shopify label on this page" : undefined}
                >
                  {fulfillLoading ? "Processing..." : "Fulfill + Print Label"}
                </button>
                {result?.galaxus ? (
                  <p className="text-xs text-gray-600 mt-1">Disabled: scan matched GalaxusStockxMatch (marketplace).</p>
                ) : null}
                {fulfillResult && (
                  <div className="mt-3 text-sm">
                    {fulfillResult.ok ? (
                      <div className="text-green-700">
                        ✅ {fulfillResult.status}
                      </div>
                    ) : (
                      <div className="text-red-700">
                        ❌ {fulfillResult.status || "ERROR"}{" "}
                        {fulfillResult.error || fulfillResult.userErrors?.[0]?.message || ""}
                      </div>
                    )}
                  </div>
                )}
                {fulfillResult?.labelFilePath && (
                  <div className="mt-3 text-xs text-gray-700 whitespace-pre-wrap break-words">
                    <div className={fulfillResult.ok ? "text-green-700" : "text-red-700"}>
                      {fulfillResult.ok ? "✅ Label generated" : "❌ Label error"}
                    </div>
                    <div className="text-gray-500">
                      Stored at <span className="font-mono">{fulfillResult.labelFilePath}</span>
                    </div>
                    {fulfillResult.printJobResult && (
                      <div className="mt-1 text-gray-600">
                        {fulfillResult.printJobResult.ok
                          ? "Print job sent to the configured printer"
                          : fulfillResult.printJobResult.skipped
                          ? `Print skipped: ${fulfillResult.printJobResult.message || "disabled"}`
                          : `Print error: ${
                              fulfillResult.printJobResult.error ||
                              fulfillResult.printJobResult.message ||
                              "unknown"
                            }`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="mt-8 bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">Scan History (last 20)</h3>
              <button
                onClick={() => setHistory([])}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                Clear history
              </button>
            </div>
            <div className="space-y-2 text-sm">
              {history.map((h, idx) => (
                <div key={`${h.ts}-${idx}`} className="flex flex-col md:flex-row md:justify-between border-b pb-1 gap-1">
                  <div className="text-gray-700">
                    {new Date(h.ts).toLocaleTimeString()} — {h.awb}
                  </div>
                  <div className="text-right text-gray-600">
                    {h.status} {h.orderName ? `(${h.orderName})` : ""}
                  </div>
                  <div className="text-xs text-gray-500">
                    Processing: {formatDuration(h.durationMs)} • Gap: {formatDuration(h.gapMs)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AWB List */}
        <div className="mt-8 bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-800">AWB List (from DB)</h3>
            <span className="text-xs text-gray-500">{awbList.length} items</span>
          </div>
          <input
            value={awbFilter}
            onChange={(e) => setAwbFilter(e.target.value)}
            placeholder="Filter by AWB or order #"
            className="w-full mb-3 px-3 py-2 border rounded text-sm"
          />
          <div className="max-h-80 overflow-y-auto text-sm">
            {awbList
              .filter((a) => {
                if (!awbFilter.trim()) return true;
                const q = awbFilter.trim().toLowerCase();
                return (
                  a.awb.toLowerCase().includes(q) ||
                  (a.shopifyOrderName || "").toLowerCase().includes(q)
                );
              })
              .map((a) => (
                <div key={`${a.awb}-${a.shopifyOrderId || ""}`} className="flex justify-between border-b py-2">
                  <div className="text-gray-800">
                    <span className="font-mono">{a.awb}</span>
                    {a.shopifyOrderName ? ` — ${a.shopifyOrderName}` : ""}
                  </div>
                  <div className="text-gray-500">
                    {a.shopifyCreatedAt
                      ? new Date(a.shopifyCreatedAt).toLocaleDateString("de-CH")
                      : "—"}
                  </div>
                </div>
              ))}
            {awbList.length === 0 && (
              <div className="text-gray-500">No AWBs found in DB.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

