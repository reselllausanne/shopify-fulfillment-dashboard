"use client";

import { useEffect, useMemo, useState } from "react";

type DirectOrder = {
  id: string;
  galaxusOrderId: string;
  orderNumber?: string | null;
  orderDate: string;
  fulfillmentState?: string | null;
  lineCount?: number;
};

export default function PartnerGalaxusDirectDeliveryPage() {
  const [orders, setOrders] = useState<DirectOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opsLog, setOpsLog] = useState<string | null>(null);

  const loadOrders = async () => {
    const res = await fetch("/api/partners/galaxus/orders?limit=80&deliveryType=direct_delivery", {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load direct-delivery orders");
    const items: DirectOrder[] = data.items ?? [];
    setOrders(items);
    if (!selectedOrderId && items[0]?.id) setSelectedOrderId(items[0].id);
  };

  const loadOrderDetail = async (orderId: string) => {
    const res = await fetch(`/api/partners/galaxus/orders/${orderId}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load order");
    setSelectedOrder(data.order);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadOrders();
      } catch (e: any) {
        setError(e.message ?? "Failed to load orders");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedOrderId) return;
    (async () => {
      setLoading(true);
      setError(null);
      setSelectedOrder(null);
      try {
        await loadOrderDetail(selectedOrderId);
      } catch (e: any) {
        setError(e.message ?? "Failed to load order detail");
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedOrderId]);

  const directOrderFulfilled = useMemo(() => {
    const shipments = Array.isArray(selectedOrder?.shipments) ? selectedOrder.shipments : [];
    return shipments.some((shipment: any) => {
      const delrStatus = String(shipment?.delrStatus ?? "").toUpperCase();
      return Boolean(shipment?.delrSentAt) || delrStatus === "UPLOADED" || delrStatus === "SENT";
    });
  }, [selectedOrder]);

  const runDirectShipment = async () => {
    if (!selectedOrderId) return;
    setLoading(true);
    setError(null);
    setOpsLog(null);
    try {
      const res = await fetch(`/api/partners/galaxus/orders/${selectedOrderId}/direct-swiss-post-label`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Direct shipment failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await Promise.all([loadOrders(), loadOrderDetail(selectedOrderId)]);
    } catch (e: any) {
      setError(e.message ?? "Direct shipment failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Partner Galaxus Direct Delivery</h1>
        <p className="text-sm text-slate-500">Direct Swiss Post + DELR flow for partner-scoped orders.</p>
      </div>
      {loading ? <div className="text-xs text-slate-500">Loading…</div> : null}
      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border rounded p-3 bg-white">
          <div className="font-semibold mb-2">Orders</div>
          <div className="space-y-2 max-h-[480px] overflow-auto">
            {orders.map((order) => (
              <button
                key={order.id}
                onClick={() => setSelectedOrderId(order.id)}
                className={`w-full rounded border p-2 text-left text-sm ${selectedOrderId === order.id ? "border-black" : "border-slate-200"}`}
              >
                <div className="font-medium">{order.orderNumber ?? order.galaxusOrderId}</div>
                <div className="text-xs text-slate-500">
                  {new Date(order.orderDate).toLocaleDateString("fr-CH")} · {order.lineCount ?? 0} lines
                </div>
              </button>
            ))}
            {orders.length === 0 ? <div className="text-xs text-slate-500">No direct-delivery orders.</div> : null}
          </div>
        </div>

        <div className="md:col-span-2 border rounded p-3 bg-white space-y-3">
          <div className="font-semibold">Order detail</div>
          <div className="flex justify-end">
            <button
              onClick={runDirectShipment}
              disabled={!selectedOrderId || directOrderFulfilled}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {directOrderFulfilled ? "Already fulfilled" : "Generate Swiss Post label + DELR"}
            </button>
          </div>

          {selectedOrder ? (
            <div className="space-y-3 text-sm">
              <div className="text-slate-600">
                {selectedOrder.galaxusOrderId} · {selectedOrder.orderNumber ?? "—"}
              </div>
              <div className="rounded border border-slate-200 p-2 text-xs text-slate-500">
                {selectedOrder.recipientName ?? "—"} · {selectedOrder.recipientAddress1 ?? "—"} ·{" "}
                {selectedOrder.recipientPostalCode ?? "—"} {selectedOrder.recipientCity ?? "—"}
              </div>
              <div className="space-y-2">
                {(selectedOrder.lines ?? []).map((line: any) => (
                  <div key={line.id} className="rounded border border-slate-200 p-2 text-xs">
                    <div className="font-medium text-slate-800">{line.productName ?? line.description ?? "Item"}</div>
                    <div className="text-slate-500">
                      GTIN {line.gtin ?? "—"} · SKU {line.supplierSku ?? "—"} · Qty {line.quantity ?? 0}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">Select an order.</div>
          )}
        </div>
      </div>

      {opsLog ? <pre className="rounded border bg-slate-50 p-3 text-xs whitespace-pre-wrap">{opsLog}</pre> : null}
    </div>
  );
}
