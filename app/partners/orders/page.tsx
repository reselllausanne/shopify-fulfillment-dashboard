"use client";

import { useEffect, useMemo, useState } from "react";
import { decathlonGrossLineAmount } from "@/decathlon/orders/margin";

type OrderListItem = {
  id: string;
  orderId: string;
  orderNumber?: string | null;
  orderDate: string;
  orderState?: string | null;
  linkedCount?: number;
  _count?: { lines: number; shipments: number };
};

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

  const matchesByLine = useMemo(() => {
    const map = new Map<string, any>();
    (selectedOrder?.stockxMatches || []).forEach((m: any) => {
      map.set(m.decathlonOrderLineId, m);
    });
    return map;
  }, [selectedOrder]);

  /** Same rule as admin: counts as linked only with a real buy reference. */
  const isStockxMatchLinked = (match: any) => {
    if (!match) return false;
    const onum = String(match.stockxOrderNumber ?? "").trim();
    const oid = String(match.stockxOrderId ?? "").trim();
    const chain = String(match.stockxChainId ?? "").trim();
    return onum.length > 0 || oid.length > 0 || chain.length > 0;
  };

  const ordersByTab = useMemo(() => {
    return orders.filter((order) => {
      if (leftTab === "fulfilled") return order.orderState === "SHIPPED";
      return order.orderState !== "SHIPPED";
    });
  }, [orders, leftTab]);

  const miraklLineLabel = (line: any) => line.productTitle || line.description || line.offerSku || "—";

  /** Prefer KickDB (from SKU/GTIN mapping) so the title matches the internal catalog / style. */
  const displayLineTitle = (line: any) =>
    line.kickdb?.variantName || line.kickdb?.productTitle || miraklLineLabel(line);

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
      await downloadLabel();
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
            Same line details as the admin dashboard (KickDB + feed). StockX links are read-only here when already set
            on the main site — duplicates are blocked.
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
              const lineCount = order._count?.lines ?? 0;
              const linked = order.linkedCount ?? 0;
              const allLinked = lineCount > 0 && linked >= lineCount;
              const needsStockx = lineCount > 0 && linked < lineCount;
              const listTone =
                order.orderState === "SHIPPED"
                  ? "border-emerald-200 bg-emerald-50/50"
                  : allLinked
                    ? "border-green-300 bg-green-50/40"
                    : needsStockx
                      ? "border-amber-200 bg-amber-50/40"
                      : "";
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
                    {new Date(order.orderDate).toLocaleDateString("fr-CH")} • {linked}/{lineCount} StockX linked
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
              <div className="space-y-2">
                {(selectedOrder.lines || []).map((line: any) => {
                  const match = matchesByLine.get(line.id);
                  const cat = line.catalog ?? null;
                  const hasMatch = Boolean(match);
                  const lineOk = isStockxMatchLinked(match);
                  const grossLine = decathlonGrossLineAmount(line);
                  const sizeDisplay =
                    cat?.sizeRaw ??
                    line.kickdb?.sizeRaw ??
                    line.kickdb?.sizeEu ??
                    line.kickdb?.sizeUs ??
                    line.size ??
                    "—";
                  const matchType = String(match?.matchType ?? "").toUpperCase();
                  const linkedLabel =
                    lineOk
                      ? matchType === "SYNC" || matchType === "STOCKX_SYNC_DECATHLON"
                        ? `Linked (sync)${match?.stockxAwb ? ` · AWB ${match.stockxAwb}` : ""}`
                        : match?.stockxOrderNumber
                          ? `Linked ${match.stockxOrderNumber}`
                          : "Linked (StockX)"
                      : hasMatch
                        ? "Matched (admin)"
                        : "Not linked yet";
                  const statusLabel = match?.stockxStatus ? String(match.stockxStatus) : hasMatch ? "MATCHED" : null;
                  const catalogPrice = cat?.catalogPrice ?? null;
                  const catalogPriceText =
                    catalogPrice != null ? `CHF ${Number(catalogPrice).toFixed(2)}` : "—";
                  const catalogSyncHint = cat?.lastSyncAt
                    ? `Feed ${new Date(cat.lastSyncAt).toLocaleString("fr-CH", { dateStyle: "short", timeStyle: "short" })}`
                    : null;
                  const kickdbTitle = line.kickdb?.productTitle ?? null;
                  const styleId = line.kickdb?.styleId ?? line.productSku ?? null;
                  return (
                    <div
                      key={line.id}
                      className={`border rounded p-3 text-xs ${
                        lineOk ? "border-green-400 bg-green-50/50" : "border-slate-200"
                      }`}
                    >
                      {hasMatch ? (
                        <div className="mb-2 rounded border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-900">
                          <span className="font-semibold">Matched on the admin dashboard.</span>{" "}
                          {statusLabel ? `Status: ${statusLabel}. ` : ""}
                          StockX data is read-only here — you cannot add a duplicate link. Fulfillment (packing slip /
                          ship) still uses this order.
                        </div>
                      ) : null}
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1.5 min-w-0">
                          <div className="text-slate-700 font-medium flex items-center gap-1.5 flex-wrap">
                            {lineOk ? (
                              <span
                                className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-green-600 text-white shrink-0"
                                title="StockX linked"
                              >
                                STX
                              </span>
                            ) : (
                              <span className="text-slate-300">○</span>
                            )}
                            {displayLineTitle(line)}
                          </div>
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
                              KickDB title: <span className="text-slate-800">{kickdbTitle ?? "—"}</span>
                            </span>
                            <span className="min-w-0">
                              Style ID: <span className="font-mono text-[10px] text-slate-800">{styleId ?? "—"}</span>
                            </span>
                            <span className="text-slate-400">Qty {line.quantity ?? "—"}</span>
                          </div>
                          <div className="text-slate-500 text-[11px] flex flex-wrap gap-x-3 gap-y-0.5">
                            <span>
                              Supplier SKU:{" "}
                              <span className="font-mono text-[10px]">{line.supplierSku ?? line.offerSku ?? "—"}</span>
                            </span>
                            <span>
                              GTIN: <span className="font-mono text-[10px]">{line.gtin ?? "—"}</span>
                            </span>
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
                              <span>
                                SKU:{" "}
                                <span className="font-mono text-[10px]">{cat?.supplierSku ?? "—"}</span>
                              </span>
                            </div>
                            {catalogSyncHint ? (
                              <div className="text-slate-400 text-[10px]">{catalogSyncHint}</div>
                            ) : null}
                          </div>
                        </div>
                        <div className="text-right shrink-0 space-y-0.5">
                          <div className={`font-medium ${lineOk ? "text-green-700" : "text-amber-700"}`}>
                            {linkedLabel}
                          </div>
                          {statusLabel ? <div className="text-slate-500">Status: {statusLabel}</div> : null}
                          <div className="text-slate-500">
                            ETA:{" "}
                            {match?.stockxEstimatedDelivery
                              ? new Date(match.stockxEstimatedDelivery).toLocaleDateString("fr-CH")
                              : "—"}
                          </div>
                          <div className="text-slate-500">
                            StockX cost:{" "}
                            {match?.stockxAmount != null ? `CHF ${Number(match.stockxAmount).toFixed(2)}` : "—"}
                          </div>
                          {grossLine != null ? (
                            <div className="text-slate-500">
                              Gross (line): CHF {grossLine.toFixed(2)}
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
