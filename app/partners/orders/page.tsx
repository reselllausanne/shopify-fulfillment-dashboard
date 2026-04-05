"use client";

import { useEffect, useMemo, useState } from "react";
import { decathlonGrossLineAmount } from "@/decathlon/orders/margin";

type OrderListItem = {
  id: string;
  orderId: string;
  orderNumber?: string | null;
  orderDate: string;
  orderState?: string | null;
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

  const ordersByTab = useMemo(() => {
    return orders.filter((order) => {
      if (leftTab === "fulfilled") return order.orderState === "SHIPPED";
      return order.orderState !== "SHIPPED";
    });
  }, [orders, leftTab]);

  const buildLineTitle = (line: any) => line.productTitle || line.description || line.offerSku || "—";

  const generatePackingSlip = async () => {
    if (!selectedOrderId) return;
    setError(null);
    try {
      const res = await fetch(`/api/decathlon/orders/${selectedOrderId}/documents/packing-slip?scope=partner`, {
        method: "GET",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Packing slip failed");
      }
      const blob = await res.blob();
      const rawName = res.headers.get("content-disposition")?.split("filename=")?.[1] ?? "";
      const filename =
        rawName.replace(/^['"]|['"]$/g, "") || `decathlon-delivery_${selectedOrderId}.pdf`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message ?? "Packing slip failed");
    }
  };

  const shipOrder = async () => {
    if (!selectedOrderId) return;
    setError(null);
    try {
      const res = await fetch(`/api/decathlon/orders/${selectedOrderId}/ship?scope=partner`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Ship failed");
      await loadOrderDetail(selectedOrderId);
      await loadOrders();
    } catch (err: any) {
      setError(err.message ?? "Ship failed");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Decathlon Orders</h1>
        <p className="text-sm text-slate-500">Manage your Decathlon orders with the same shipping flow.</p>
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
              return (
                <button
                  key={order.id}
                  onClick={() => setSelectedOrderId(order.id)}
                  className={`w-full text-left border rounded p-2 text-sm ${
                    selectedOrderId === order.id ? "border-black" : "border-slate-200"
                  }`}
                >
                  <div className="font-medium">{order.orderNumber ?? order.orderId}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(order.orderDate).toLocaleDateString("fr-CH")} • {lineCount} lines
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
                  const cat = line.catalog ?? null;
                  const sizeDisplay =
                    cat?.sizeRaw ??
                    line.kickdb?.sizeRaw ??
                    line.kickdb?.sizeEu ??
                    line.kickdb?.sizeUs ??
                    line.size ??
                    "—";
                  const grossLine = decathlonGrossLineAmount(line);
                  return (
                    <div key={line.id} className="border rounded p-3 text-xs">
                      <div className="text-slate-700 font-medium">{buildLineTitle(line)}</div>
                      <div className="text-slate-500 text-[11px] flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>
                          Size: <span className="text-slate-800 font-medium">{sizeDisplay}</span>
                        </span>
                        <span className="text-slate-400">Qty {line.quantity ?? "—"}</span>
                        <span className="text-slate-400">SKU {line.supplierSku ?? line.offerSku ?? "—"}</span>
                        <span className="text-slate-400">GTIN {line.gtin ?? "—"}</span>
                      </div>
                      {grossLine != null ? (
                        <div className="text-slate-500 text-[11px] mt-1">Gross (line): CHF {grossLine.toFixed(2)}</div>
                      ) : null}
                      {cat ? (
                        <div className="mt-2 text-[11px] text-slate-500 border-t border-slate-100 pt-1">
                          Feed price: {cat.catalogPrice != null ? `CHF ${Number(cat.catalogPrice).toFixed(2)}` : "—"} •
                          Key: {cat.providerKey ?? "—"}
                        </div>
                      ) : null}
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
