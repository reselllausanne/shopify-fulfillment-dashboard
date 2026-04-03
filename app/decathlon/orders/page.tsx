"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GalaxusManualEntryModal from "@/app/components/GalaxusManualEntryModal";
import { StockxOrderTools } from "@/app/galaxus/_components/StockxOrderTools";

type OrderListItem = {
  id: string;
  orderId: string;
  orderNumber?: string | null;
  orderDate: string;
  shippedCount?: number;
  linkedCount?: number;
  orderState?: string | null;
  _count?: { lines: number; shipments: number };
};

export default function DecathlonOrdersPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [opsLog, setOpsLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const knownOrderIds = useRef<Set<string>>(new Set());
  const [polling, setPolling] = useState(false);
  const [leftTab, setLeftTab] = useState<"to_process" | "fulfilled">("to_process");
  const [manualEntryModal, setManualEntryModal] = useState<{
    isOpen: boolean;
    mode: "create" | "edit";
    line: any | null;
    orderId: string | null;
    initialData: any;
  }>({ isOpen: false, mode: "create", line: null, orderId: null, initialData: {} });

  const loadOrders = async () => {
    setLoadingOrders(true);
    setError(null);
    try {
      const res = await fetch(`/api/decathlon/orders?limit=50&view=${leftTab}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load orders");
      const items: OrderListItem[] = data.items || [];
      const fresh = new Set<string>();
      for (const item of items) {
        if (!knownOrderIds.current.has(item.id)) {
          fresh.add(item.id);
        }
      }
      setNewOrderIds(fresh.size > 0 ? fresh : new Set());
      knownOrderIds.current = new Set(items.map((item) => item.id));
      setOrders(items);
      if (!selectedOrderId && data.items?.[0]?.id) {
        setSelectedOrderId(data.items[0].id);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingOrders(false);
    }
  };

  const ingestNewOrders = async () => {
    setPolling(true);
    setError(null);
    try {
      await fetch("/api/decathlon/orders/poll", { method: "POST", cache: "no-store" });
    } catch (err: any) {
      setError(err?.message ?? "Ingest failed");
    } finally {
      await loadOrders();
      setPolling(false);
    }
  };

  const loadOrderDetail = async (orderId: string) => {
    setLoadingOrder(true);
    setError(null);
    try {
      const res = await fetch(`/api/decathlon/orders/${orderId}`, { cache: "no-store" });
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

  const buildLineTitle = (line: any) => line.productTitle || line.description || line.offerSku || "—";

  const orderedList = useMemo(() => {
    if (newOrderIds.size === 0) return orders;
    const fresh = orders.filter((o) => newOrderIds.has(o.id));
    const rest = orders.filter((o) => !newOrderIds.has(o.id));
    return [...fresh, ...rest];
  }, [orders, newOrderIds]);

  const ordersByTab = useMemo(() => {
    return orderedList.filter((order) => {
      if (leftTab === "fulfilled") return order.orderState === "SHIPPED";
      return order.orderState !== "SHIPPED";
    });
  }, [orderedList, leftTab]);

  const needsLinking = (order: OrderListItem) => {
    const lines = order._count?.lines ?? 0;
    const linked = order.linkedCount ?? 0;
    return lines > 0 && linked < lines;
  };

  const openManualEntry = (line: any) => {
    if (!selectedOrderId || !selectedOrder) {
      setError("Order detail not loaded yet");
      return;
    }
    if (String(selectedOrder?.id ?? "") !== String(selectedOrderId)) {
      setError("Order detail is still loading (please retry)");
      return;
    }
    const match = matchesByLine.get(line.id) ?? null;
    const priceRaw = line.unitPrice ?? line.lineTotal ?? null;
    const priceNumber = typeof priceRaw === "number" ? priceRaw : Number(priceRaw);
    const savedCost = match?.stockxAmount != null ? Number(match.stockxAmount) : null;
    const resolvedCost = Number.isFinite(savedCost as number) ? (savedCost as number) : null;
    const marginAmount =
      Number.isFinite(priceNumber) && resolvedCost != null ? priceNumber - resolvedCost : null;
    const marginPercent =
      Number.isFinite(priceNumber) && priceNumber > 0 && resolvedCost != null
        ? ((priceNumber - resolvedCost) / priceNumber) * 100
        : null;
    const title = buildLineTitle(line);
    const orderLabel = `${selectedOrder?.orderId ?? ""}${selectedOrder?.recipientName ? ` · ${selectedOrder.recipientName}` : ""}`;
    const initialData = {
      shopifyOrderId: selectedOrder?.id ?? "",
      shopifyOrderName: orderLabel,
      shopifyCreatedAt: selectedOrder?.orderDate ?? null,
      shopifyLineItemId: line.id,
      shopifyProductTitle: title,
      shopifySku: line.supplierSku ?? line.offerSku ?? "",
      shopifySizeEU: line.size ?? "",
      shopifyTotalPrice: Number.isFinite(priceNumber) ? priceNumber : null,
      shopifyCurrencyCode: selectedOrder?.currencyCode ?? "CHF",
      stockxOrderNumber: match?.stockxOrderNumber ?? "",
      stockxChainId: String(line.offerSku ?? "").trim(),
      stockxOrderId: match?.stockxOrderId ?? "",
      stockxProductName: match?.stockxProductName ?? "",
      stockxSizeEU: match?.stockxSizeEU ?? "",
      stockxSkuKey: match?.stockxSkuKey ?? "",
      stockxPurchaseDate: match?.stockxPurchaseDate ?? null,
      stockxStatus: match?.stockxStatus ?? "MANUAL",
      stockxAwb: match?.stockxAwb ?? "",
      stockxTrackingUrl: match?.stockxTrackingUrl ?? "",
      stockxEstimatedDelivery: match?.stockxEstimatedDelivery ?? null,
      stockxLatestEstimatedDelivery: match?.stockxLatestEstimatedDelivery ?? null,
      stockxCheckoutType: match?.stockxCheckoutType ?? "",
      stockxStates: match?.stockxStates ?? null,
      stockxAmount: resolvedCost,
      supplierCost: resolvedCost,
      manualCostOverride: null,
      marginAmount: marginAmount != null ? Number(marginAmount.toFixed(2)) : null,
      marginPercent: marginPercent != null ? Number(marginPercent.toFixed(2)) : null,
      matchType: "MANUAL",
      matchConfidence: "high",
      matchScore: 1,
    };
    setManualEntryModal({
      isOpen: true,
      mode: match ? "edit" : "create",
      line,
      orderId: selectedOrderId ?? null,
      initialData,
    });
  };

  const saveManualEntry = async (data: any) => {
    const orderId = manualEntryModal.orderId ?? selectedOrderId;
    if (!orderId || !manualEntryModal.line) return;
    setError(null);
    setOpsLog(null);
    try {
      const res = await fetch(`/api/decathlon/orders/${orderId}/stockx/manual-entry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lineId: manualEntryModal.line.id,
          data,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Manual entry failed");
      setOpsLog(JSON.stringify(json, null, 2));
      setManualEntryModal({ isOpen: false, mode: "create", line: null, orderId: null, initialData: {} });
      await loadOrderDetail(orderId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const generatePackingSlip = async () => {
    if (!selectedOrderId) return;
    setOpsLog(null);
    setError(null);
    try {
      const res = await fetch(`/api/decathlon/orders/${selectedOrderId}/documents/packing-slip`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Packing slip failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const shipOrder = async () => {
    if (!selectedOrderId) return;
    setOpsLog(null);
    setError(null);
    try {
      const res = await fetch(`/api/decathlon/orders/${selectedOrderId}/ship`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Ship failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Decathlon Orders</h1>
          <p className="text-sm text-gray-500">Order management + StockX linking (Mirakl)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/decathlon" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Decathlon Ops
          </a>
          <button
            onClick={() => void ingestNewOrders()}
            disabled={loadingOrders || polling}
            className="px-3 py-2 bg-gray-900 text-white rounded"
          >
            {polling ? "Refreshing..." : "Refresh orders"}
          </button>
        </div>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {polling ? <div className="text-xs text-gray-500">Polling Mirakl...</div> : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border rounded p-3">
          <div className="font-semibold mb-2">Orders</div>
          <div className="mb-2 grid grid-cols-2 gap-1 text-xs">
            <button
              className={`rounded border px-2 py-1 ${leftTab === "to_process" ? "bg-black text-white border-black" : "bg-white border-gray-300"}`}
              onClick={() => setLeftTab("to_process")}
            >
              To process
            </button>
            <button
              className={`rounded border px-2 py-1 ${leftTab === "fulfilled" ? "bg-black text-white border-black" : "bg-white border-gray-300"}`}
              onClick={() => setLeftTab("fulfilled")}
            >
              Fulfilled
            </button>
          </div>
          <div className="space-y-2 max-h-[500px] overflow-auto">
            {ordersByTab.map((order) => (
              <button
                key={order.id}
                onClick={() => setSelectedOrderId(order.id)}
                className={`w-full text-left border rounded p-2 text-sm ${
                  needsLinking(order)
                    ? "border-red-500 bg-red-50"
                    : newOrderIds.has(order.id)
                    ? "border-green-500 bg-green-50"
                    : selectedOrderId === order.id
                    ? "border-black"
                    : "border-gray-200"
                }`}
              >
                <div className="font-medium">{order.orderNumber ?? order.orderId}</div>
                <div className="text-xs text-gray-500">
                  {new Date(order.orderDate).toLocaleDateString("fr-CH")} •{" "}
                  {order.linkedCount ?? 0}/{order._count?.lines ?? 0} linked
                </div>
              </button>
            ))}
            {ordersByTab.length === 0 ? (
              <div className="text-xs text-gray-500">No orders in this tab.</div>
            ) : null}
          </div>
        </div>

        <div className="md:col-span-2 border rounded p-3 space-y-3">
          <div className="font-semibold">Order detail</div>
          <StockxOrderTools
            orderId={selectedOrderId}
            apiBasePath="/api/decathlon"
            onAfterAction={async () => {
              if (selectedOrderId) await loadOrderDetail(selectedOrderId);
              await loadOrders();
            }}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={generatePackingSlip}
              disabled={!selectedOrderId}
              className="px-3 py-1.5 bg-gray-100 rounded text-xs"
            >
              Download packing slip
            </button>
            <button
              onClick={shipOrder}
              disabled={!selectedOrderId}
              className="px-3 py-1.5 bg-gray-900 text-white rounded text-xs"
            >
              Generate label + ship
            </button>
          </div>

          {loadingOrder ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : selectedOrder ? (
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                {selectedOrder.orderId} · {selectedOrder.orderNumber ?? "—"}
              </div>
              <div className="space-y-2">
                {(selectedOrder.lines || []).map((line: any) => {
                  const match = matchesByLine.get(line.id);
                  const priceRaw = line.unitPrice ?? line.lineTotal ?? null;
                  const priceNumber = typeof priceRaw === "number" ? priceRaw : Number(priceRaw);
                  const priceText = Number.isFinite(priceNumber) ? `CHF ${priceNumber.toFixed(2)}` : "—";
                  return (
                    <div
                      key={line.id}
                      className="border rounded p-3 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="space-y-2">
                          <div className="font-medium">{selectedOrder.recipientName ?? "—"}</div>
                          <div className="text-gray-500">
                            {selectedOrder.recipientAddress1 ?? ""} {selectedOrder.recipientAddress2 ?? ""}
                          </div>
                          <div className="text-gray-500">
                            {selectedOrder.recipientPostalCode ?? ""} {selectedOrder.recipientCity ?? ""}{" "}
                            {selectedOrder.recipientCountryCode ?? selectedOrder.recipientCountry ?? ""}
                          </div>
                          <div className="text-gray-600 font-medium flex items-center gap-1.5">
                            {match ? <span className="text-green-600">✓</span> : <span className="text-gray-300">○</span>}
                            {buildLineTitle(line)}
                          </div>
                          <div className="text-gray-500">SKU: {line.offerSku ?? "—"} · Qty: {line.quantity}</div>
                          <div className="text-gray-500">Sell price: {priceText}</div>
                        </div>
                        <div className="text-right">
                          <div className={`font-medium ${match ? "text-green-700" : "text-red-600"}`}>
                            {match ? `Linked ${match.stockxOrderNumber ?? ""}` : "Not linked"}
                          </div>
                          <div className="text-gray-500">ETA: {match?.stockxEstimatedDelivery ? new Date(match.stockxEstimatedDelivery).toLocaleDateString("fr-CH") : "—"}</div>
                          <div className="text-gray-500">
                            Cost: {match?.stockxAmount != null ? `CHF ${match.stockxAmount}` : "—"}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex justify-end">
                        <button
                          onClick={() => openManualEntry(line)}
                          disabled={loadingOrder || !selectedOrder || String(selectedOrder?.id ?? "") !== String(selectedOrderId)}
                          className="px-2 py-1 bg-blue-600 text-white rounded mr-2"
                        >
                          Create Manual Entry (Full)
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">Select an order to view details.</div>
          )}
        </div>
      </div>

      {opsLog ? (
        <pre className="text-xs bg-gray-50 border rounded p-3 whitespace-pre-wrap">{opsLog}</pre>
      ) : null}
      <GalaxusManualEntryModal
        isOpen={manualEntryModal.isOpen}
        mode={manualEntryModal.mode}
        initialData={manualEntryModal.initialData}
        shopifyItem={{
          orderName: manualEntryModal.initialData?.shopifyOrderName ?? "",
          title: manualEntryModal.initialData?.shopifyProductTitle ?? "",
          sku: manualEntryModal.initialData?.shopifySku ?? "",
          sizeEU: manualEntryModal.initialData?.shopifySizeEU ?? "",
          createdAt: manualEntryModal.initialData?.shopifyCreatedAt ?? null,
        }}
        onSave={(data) => saveManualEntry(data)}
        onClose={() => setManualEntryModal({ isOpen: false, mode: "create", line: null, orderId: null, initialData: {} })}
      />
    </div>
  );
}
