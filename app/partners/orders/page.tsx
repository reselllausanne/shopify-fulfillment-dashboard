"use client";

import { useEffect, useMemo, useState } from "react";
import { decathlonLinePayoutPreferMirakl, decathlonMiraklSellTotal } from "@/decathlon/orders/margin";
import { decathlonMiraklSellerPayoutLineTotal } from "@/decathlon/orders/miraklLinePayout";

type OrderListItem = {
  id: string;
  orderId: string;
  orderNumber?: string | null;
  orderDate: string;
  orderState?: string | null;
  shippedCount?: number;
  shippedUnits?: number;
  totalUnits?: number;
  remainingUnits?: number;
  _count?: { lines: number; shipments: number };
};

/** Same fulfillment rule as admin `app/decathlon/orders/page.tsx` (avoid relying on Mirakl SHIPPED when units are 0). */
function isPartnerOrderFulfilled(order: OrderListItem): boolean {
  const totalUnits = order.totalUnits ?? 0;
  const shippedUnits = order.shippedUnits ?? 0;
  const remainingUnits = order.remainingUnits ?? Math.max(totalUnits - shippedUnits, 0);
  const shippedCount = order.shippedCount ?? order._count?.shipments ?? 0;
  if (totalUnits > 0) return remainingUnits <= 0;
  return shippedCount > 0;
}

export default function PartnerOrdersPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<"to_process" | "fulfilled">("to_process");

  const loadOrders = async () => {
    setLoadingOrders(true);
    setError(null);
    try {
      const res = await fetch(`/api/decathlon/orders?limit=50&view=${leftTab}&scope=partner`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load orders");
      const items: OrderListItem[] = data.items || [];
      setOrders(items);
      if (!selectedOrderId && items[0]?.id) {
        setSelectedOrderId(items[0].id);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingOrders(false);
    }
  };

  const loadOrderDetail = async (orderId: string) => {
    setLoadingOrder(true);
    setError(null);
    try {
      const res = await fetch(`/api/decathlon/orders/${orderId}?scope=partner`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load order");
      setSelectedOrder(data.order);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingOrder(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, [leftTab]);

  useEffect(() => {
    if (selectedOrderId) {
      setSelectedOrder(null);
      loadOrderDetail(selectedOrderId);
    }
  }, [selectedOrderId]);

  const normalizeState = (state?: string | null) => String(state ?? "").trim().toUpperCase();
  const canceledStates = useMemo(
    () => new Set(["CANCELED", "CANCELLED", "ORDER_CANCELLED", "CLOSED"]),
    []
  );

  const ordersByTab = useMemo(() => {
    return orders.filter((order) => {
      const state = normalizeState(order.orderState);
      const isShipped = isPartnerOrderFulfilled(order);
      if (leftTab === "fulfilled") return isShipped;
      return !isShipped && !canceledStates.has(state);
    });
  }, [orders, leftTab, canceledStates]);

  const miraklLineLabel = (line: any) => line.productTitle || line.description || line.offerSku || "—";

  /** Prefer KickDB, then supplier feed name, then Mirakl line fields. */
  const displayLineTitle = (line: any) =>
    line.kickdb?.variantName ||
    line.kickdb?.productTitle ||
    [line.catalog?.supplierBrand, line.catalog?.supplierProductName].filter(Boolean).join(" ").trim() ||
    line.catalog?.supplierProductName ||
    miraklLineLabel(line);

  const partnerStockxMatches = useMemo(() => {
    if (!selectedOrder?.stockxMatches || !Array.isArray(selectedOrder.lines)) return [];
    const lineIds = new Set((selectedOrder.lines as any[]).map((l) => l.id));
    return (selectedOrder.stockxMatches as any[]).filter((m) => m?.decathlonOrderLineId && lineIds.has(m.decathlonOrderLineId));
  }, [selectedOrder]);

  const shippedPartnerBreakdown = useMemo(() => {
    if (!selectedOrder?.shipments?.length) return [];
    const partnerLines: any[] = Array.isArray(selectedOrder.lines) ? selectedOrder.lines : [];
    const lineIds = new Set(partnerLines.map((l) => l.id));
    const linesById = new Map(partnerLines.map((l) => [l.id, l]));
    const rows: Array<{
      key: string;
      title: string;
      qty: number;
      tracking: string;
      shippedAt: string | null;
    }> = [];
    for (const s of selectedOrder.shipments) {
      if (!s.shippedAt) continue;
      const tracking = String(s.trackingNumber ?? s.trackingUrl ?? "").trim();
      const shippedAt = s.shippedAt ? String(s.shippedAt) : null;
      const shipId = String(s.id ?? "");
      for (const sl of s.lines ?? []) {
        if (!lineIds.has(sl.orderLineId)) continue;
        const line = linesById.get(sl.orderLineId);
        if (!line) continue;
        const qty = Number(sl.quantity ?? 0);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        rows.push({
          key: `${shipId}-${sl.orderLineId}-${sl.quantity}`,
          title: line.kickdb?.variantName || line.kickdb?.productTitle || miraklLineLabel(line),
          qty,
          tracking,
          shippedAt,
        });
      }
    }
    return rows;
  }, [selectedOrder]);

  const downloadPdf = async (url: string, fallbackName: string) => {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Download failed");
    }
    const blob = await res.blob();
    const rawName = res.headers.get("content-disposition")?.split("filename=")?.[1] ?? "";
    const filename = rawName.replace(/^['"]|['"]$/g, "") || fallbackName;
    const urlObj = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = urlObj;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(urlObj);
  };

  const generatePackingSlip = async () => {
    if (!selectedOrderId) return;
    setError(null);
    try {
      await downloadPdf(
        `/api/decathlon/orders/${selectedOrderId}/documents/packing-slip?scope=partner`,
        `decathlon-delivery_${selectedOrderId}.pdf`
      );
    } catch (err: any) {
      setError(err.message ?? "Packing slip failed");
    }
  };

  const downloadLabel = async () => {
    if (!selectedOrderId) return;
    await downloadPdf(
      `/api/decathlon/orders/${selectedOrderId}/documents/label?scope=partner`,
      `decathlon-label_${selectedOrderId}.pdf`
    );
  };

  const shipOrder = async () => {
    if (!selectedOrderId) return;
    setError(null);
    try {
      const res = await fetch(`/api/decathlon/orders/${selectedOrderId}/ship?scope=partner`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Ship failed");
      // DB-only Mirakl reconcile has no PDF row; normal ship has documentId + label in storage.
      if (data.documentId) {
        try {
          await downloadLabel();
        } catch (labelErr: any) {
          const msg = String(labelErr?.message ?? labelErr);
          setError(
            msg.toLowerCase().includes("failed to fetch")
              ? "Label download failed (network). Check that the app is reachable and try “Refresh orders”, or open the label from Mirakl."
              : `Ship saved but label download failed: ${msg}`
          );
        }
      } else if (data.reconciled) {
        setError(null);
      }
      await loadOrderDetail(selectedOrderId);
      await loadOrders();
    } catch (err: any) {
      setError(err.message ?? "Ship failed");
    }
  };

  const refreshData = async () => {
    await loadOrders();
    if (selectedOrderId) {
      await loadOrderDetail(selectedOrderId);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Decathlon Orders</h1>
          <p className="text-sm text-slate-500">
            Orders are filtered to your products only. Download the packing slip, then generate a label to ship your
            lines. Mixed orders are split automatically so each partner ships their own items.
          </p>
        </div>
        <button
          onClick={refreshData}
          disabled={loadingOrders || loadingOrder}
          className="px-3 py-1.5 rounded text-xs border border-slate-200 bg-white"
        >
          {loadingOrders || loadingOrder ? "Refreshing…" : "Refresh orders"}
        </button>
      </div>

      {loadingOrders ? <div className="text-xs text-slate-500">Loading orders…</div> : null}
      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border rounded p-3 bg-white">
          <div className="font-semibold mb-2">Orders</div>
          <div className="mb-2 grid grid-cols-2 gap-1 text-xs">
            <button
              className={`rounded border px-2 py-1 ${
                leftTab === "to_process" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"
              }`}
              onClick={() => setLeftTab("to_process")}
            >
              To process
            </button>
            <button
              className={`rounded border px-2 py-1 ${
                leftTab === "fulfilled" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"
              }`}
              onClick={() => setLeftTab("fulfilled")}
            >
              Fulfilled
            </button>
          </div>
          <div className="space-y-2 max-h-[500px] overflow-auto">
            {ordersByTab.map((order) => {
              const totalUnits = order.totalUnits ?? 0;
              const shippedUnits = order.shippedUnits ?? 0;
              const isShipped = isPartnerOrderFulfilled(order);
              const listTone = isShipped ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/40";
              return (
                <button
                  key={order.id}
                  onClick={() => setSelectedOrderId(order.id)}
                  className={`w-full text-left border rounded p-2 text-sm ${
                    selectedOrderId === order.id ? "border-black" : listTone || "border-slate-200"
                  }`}
                >
                  <div className="font-medium">{order.orderNumber ?? order.orderId}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(order.orderDate).toLocaleDateString("fr-CH")} • {shippedUnits}/{totalUnits} shipped
                  </div>
                </button>
              );
            })}
            {ordersByTab.length === 0 ? (
              <div className="text-xs text-slate-500">No orders in this tab.</div>
            ) : null}
          </div>
        </div>

        <div className="md:col-span-2 border rounded p-3 space-y-3 bg-white">
          <div className="font-semibold">Order detail</div>
          <div className="flex justify-end gap-2">
            <button
              onClick={generatePackingSlip}
              disabled={!selectedOrderId}
              className="px-3 py-1.5 bg-slate-100 rounded text-xs"
            >
              Download packing slip
            </button>
            <button
              onClick={shipOrder}
              disabled={!selectedOrderId}
              className="px-3 py-1.5 bg-slate-900 text-white rounded text-xs"
            >
              Generate label + ship
            </button>
          </div>

          {loadingOrder ? (
            <div className="text-sm text-slate-500">Loading…</div>
          ) : selectedOrder ? (
            <div className="space-y-4">
              <div className="text-sm text-slate-600">
                {selectedOrder.orderId} · {selectedOrder.orderNumber ?? "—"}
              </div>
              {partnerStockxMatches.length > 0 ? (
                <div className="rounded border border-indigo-200 bg-indigo-50/60 p-3 text-xs space-y-2">
                  <div className="font-semibold text-indigo-950">StockX link (your lines)</div>
                  <ul className="space-y-2">
                    {partnerStockxMatches.map((m: any) => {
                      const productLabel =
                        m.stockxProductName ||
                        m.decathlonProductName ||
                        m.decathlonDescription ||
                        "Linked line";
                      return (
                        <li key={m.id} className="border-b border-indigo-100/80 pb-2 last:border-0 last:pb-0 space-y-0.5">
                          <div className="font-medium text-indigo-950">{productLabel}</div>
                          <div className="text-[11px] text-indigo-900/80 flex flex-wrap gap-x-3 gap-y-0.5">
                            <span>
                              StockX order:{" "}
                              <span className="font-mono">{m.stockxOrderNumber ?? "—"}</span>
                            </span>
                            {m.stockxChainId ? (
                              <span>
                                Chain: <span className="font-mono text-[10px]">{m.stockxChainId}</span>
                              </span>
                            ) : null}
                            {m.stockxStatus ? <span>Status: {m.stockxStatus}</span> : null}
                          </div>
                          {(m.stockxAwb || m.stockxTrackingUrl) && (
                            <div className="text-[10px] text-indigo-800/90">
                              {m.stockxAwb ? <>AWB: {m.stockxAwb}</> : null}
                              {m.stockxAwb && m.stockxTrackingUrl ? " · " : null}
                              {m.stockxTrackingUrl ? (
                                <a className="underline" href={m.stockxTrackingUrl} target="_blank" rel="noreferrer">
                                  Tracking
                                </a>
                              ) : null}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              {Array.isArray(selectedOrder.lines) && selectedOrder.lines.length > 0 ? (
                <div className="rounded border border-slate-200 bg-slate-50/90 p-3 text-xs space-y-2">
                  <div className="font-semibold text-slate-900">Products sold</div>
                  <ul className="space-y-1.5">
                    {selectedOrder.lines.map((line: any) => {
                      const sell = decathlonMiraklSellTotal(line);
                      const pay = decathlonLinePayoutPreferMirakl(line);
                      const mir = decathlonMiraklSellerPayoutLineTotal(line.rawJson);
                      return (
                        <li
                          key={line.id}
                          className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-700 border-b border-slate-100 pb-1.5 last:border-0 last:pb-0"
                        >
                          <span className="min-w-0 flex-1 font-medium text-slate-900">{displayLineTitle(line)}</span>
                          <span className="font-mono text-[10px] text-slate-500 shrink-0">
                            {line.offerSku ?? "—"}
                          </span>
                          <span className="text-slate-500 shrink-0">×{line.quantity ?? "—"}</span>
                          <span className="w-full text-right sm:w-auto sm:ml-auto shrink-0 text-[10px] text-slate-600">
                            {sell != null ? <>Sell CHF {sell.toFixed(2)}</> : null}
                            {sell != null && pay != null ? <span className="text-slate-400"> · </span> : null}
                            {pay != null ? (
                              <span className="font-semibold text-slate-900">
                                {mir != null ? "Payout Mirakl" : "Payout (est.)"} CHF {pay.toFixed(2)}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              <div className="text-xs text-slate-500 border-b border-slate-100 pb-2 space-y-0.5">
                <div className="font-medium text-slate-700">{selectedOrder.recipientName ?? "—"}</div>
                <div>
                  {selectedOrder.recipientAddress1 ?? ""} {selectedOrder.recipientAddress2 ?? ""}
                </div>
                <div>
                  {selectedOrder.recipientPostalCode ?? ""} {selectedOrder.recipientCity ?? ""}{" "}
                  {selectedOrder.recipientCountryCode ?? selectedOrder.recipientCountry ?? ""}
                </div>
              </div>
              {shippedPartnerBreakdown.length > 0 ? (
                <div className="rounded border border-emerald-200 bg-emerald-50/50 p-3 text-xs space-y-2">
                  <div className="font-semibold text-emerald-900">Shipped (your lines)</div>
                  <ul className="space-y-1.5">
                    {shippedPartnerBreakdown.map((row) => (
                      <li key={row.key} className="flex flex-col gap-0.5 text-emerald-950 border-b border-emerald-100/80 pb-1.5 last:border-0 last:pb-0">
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{row.title}</span>
                            <span className="text-emerald-800/80"> × {row.qty}</span>
                          </span>
                          <span className="shrink-0 text-[11px] text-emerald-800/90">
                            {row.tracking ? `Tracking: ${row.tracking}` : "Tracking: —"}
                          </span>
                        </div>
                        {row.shippedAt ? (
                          <div className="text-[10px] text-emerald-800/75">
                            Shipped{" "}
                            {new Date(row.shippedAt).toLocaleString("fr-CH", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="space-y-2">
                {(selectedOrder.lines || []).map((line: any) => {
                  const cat = line.catalog ?? null;
                  const sellBrut = decathlonMiraklSellTotal(line);
                  const miraklRaw = line.rawJson ?? line;
                  const payoutMiraklLine = decathlonMiraklSellerPayoutLineTotal(miraklRaw);
                  const payoutPreferred = decathlonLinePayoutPreferMirakl(line);
                  const sizeDisplay =
                    cat?.sizeRaw ??
                    line.kickdb?.sizeRaw ??
                    line.kickdb?.sizeEu ??
                    line.kickdb?.sizeUs ??
                    line.size ??
                    "—";
                  const catalogPrice = cat?.catalogPrice ?? null;
                  const catalogPriceText =
                    catalogPrice != null ? `CHF ${Number(catalogPrice).toFixed(2)}` : "—";
                  const catalogSyncHint = cat?.lastSyncAt
                    ? `Feed ${new Date(cat.lastSyncAt).toLocaleString("fr-CH", { dateStyle: "short", timeStyle: "short" })}`
                    : null;
                  const styleId = line.kickdb?.styleId ?? line.productSku ?? null;
                  return (
                    <div key={line.id} className="border rounded p-3 text-xs border-slate-200">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1.5 min-w-0">
                          <div className="text-slate-700 font-medium">{displayLineTitle(line)}</div>
                          {miraklLineLabel(line) !== displayLineTitle(line) ? (
                            <div className="text-slate-400 text-[10px]">
                              Mirakl title: <span className="italic">{miraklLineLabel(line)}</span>
                            </div>
                          ) : null}
                          <div className="text-slate-500 text-[11px] leading-snug flex flex-wrap gap-x-3 gap-y-0.5">
                            <span>
                              Size: <span className="text-slate-800 font-medium">{sizeDisplay}</span>
                            </span>
                            <span className="min-w-0">
                              Style ID: <span className="font-mono text-[10px] text-slate-800">{styleId ?? "—"}</span>
                            </span>
                            <span className="text-slate-400">Qty {line.quantity ?? "—"}</span>
                          </div>
                          <div className="text-[11px] border-t border-slate-100 pt-1.5 mt-1 space-y-0.5">
                            <div className="font-medium text-slate-700">Catalog (supplier feed)</div>
                            <div className="text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5">
                              <span>
                                Feed price:{" "}
                                <span className="font-mono text-[10px]">{catalogPriceText}</span>
                              </span>
                              <span>
                                Key:{" "}
                                <span className="font-mono text-[10px] break-all">
                                  {cat?.providerKey ?? "—"}
                                </span>
                              </span>
                            </div>
                            {catalogSyncHint ? (
                              <div className="text-slate-400 text-[10px]">{catalogSyncHint}</div>
                            ) : null}
                          </div>
                        </div>
                        <div className="text-right shrink-0 space-y-0.5">
                          {sellBrut != null ? (
                            <div className="text-slate-400 text-[10px]">Sell Mirakl (ligne): CHF {sellBrut.toFixed(2)}</div>
                          ) : null}
                          {payoutPreferred != null ? (
                            <div className="text-slate-800 font-medium">
                              {payoutMiraklLine != null ? "Payout (Mirakl order line)" : "Payout (est.)"}: CHF{" "}
                              {payoutPreferred.toFixed(2)}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">Select an order to view details.</div>
          )}
        </div>
      </div>
    </div>
  );
}
