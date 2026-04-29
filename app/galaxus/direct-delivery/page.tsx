"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GalaxusManualEntryModal from "@/app/components/GalaxusManualEntryModal";
import { StockxOrderTools } from "@/app/galaxus/_components/StockxOrderTools";
import { runPurgeGalaxusOrderFromDbUi } from "@/galaxus/_lib/purgeGalaxusOrderClient";

type OrderListItem = {
  id: string;
  galaxusOrderId: string;
  orderNumber?: string | null;
  orderDate: string;
  shippedCount?: number;
  fulfilledCount?: number;
  linkedCount?: number;
  fulfillmentState?: "to_process" | "shipped" | "fulfilled";
  _count?: { lines: number; shipments: number };
};

export default function GalaxusDirectDeliveryPage() {
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
  const [sendingOrdr, setSendingOrdr] = useState(false);
  const [purgingOrder, setPurgingOrder] = useState(false);
  const [leftTab, setLeftTab] = useState<"to_process" | "fulfilled">("to_process");
  const [manualEntryModal, setManualEntryModal] = useState<{
    isOpen: boolean;
    mode: "create" | "edit";
    line: any | null;
    orderId: string | null;
    unitIndex: number;
    initialData: any;
  }>({ isOpen: false, mode: "create", line: null, orderId: null, unitIndex: 0, initialData: {} });

  const loadOrders = async () => {
    setLoadingOrders(true);
    setError(null);
    try {
      const res = await fetch(
        "/api/galaxus/orders?limit=50&view=active&deliveryType=direct_delivery",
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load orders");
      const items: OrderListItem[] = data.items || [];
      const fresh = new Set<string>();
      for (const item of items) {
        if (!knownOrderIds.current.has(item.id)) {
          fresh.add(item.id);
        }
      }
      if (fresh.size > 0) {
        setNewOrderIds(fresh);
      } else {
        setNewOrderIds(new Set());
      }
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
      await fetch("/api/galaxus/edi/poll", { cache: "no-store" });
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
      const res = await fetch(`/api/galaxus/orders/${orderId}`, { cache: "no-store" });
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
  }, []);

  useEffect(() => {
    const poll = async () => {
      setPolling(true);
      try {
        await fetch("/api/galaxus/edi/poll", { cache: "no-store" });
      } catch {
        // Silent: polling should not spam UI
      } finally {
        await loadOrders();
        setPolling(false);
      }
    };
    const interval = setInterval(poll, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedOrderId) {
      // Avoid showing stale order details while loading the new order
      setSelectedOrder(null);
      loadOrderDetail(selectedOrderId);
    }
  }, [selectedOrderId]);

  useEffect(() => {
    // Prevent saving a modal that was opened for another order.
    if (manualEntryModal.isOpen && manualEntryModal.orderId && selectedOrderId && manualEntryModal.orderId !== selectedOrderId) {
      setManualEntryModal({ isOpen: false, mode: "create", line: null, orderId: null, unitIndex: 0, initialData: {} });
    }
  }, [selectedOrderId, manualEntryModal.isOpen, manualEntryModal.orderId]);

  const matchesByLine = useMemo(() => {
    const map = new Map<string, any>();
    (selectedOrder?.stockxMatches || []).forEach((m: any) => {
      map.set(m.galaxusOrderLineId, m);
    });
    return map;
  }, [selectedOrder]);
  const orderFulfilled = useMemo(() => {
    const shipments = Array.isArray(selectedOrder?.shipments) ? selectedOrder.shipments : [];
    return shipments.some((shipment: any) => {
      const delrStatus = String(shipment?.delrStatus ?? "").toUpperCase();
      return Boolean(shipment?.delrSentAt) || delrStatus === "UPLOADED" || delrStatus === "SENT";
    });
  }, [selectedOrder]);

  const orderHasTracking = useMemo(() => {
    const shipments = Array.isArray(selectedOrder?.shipments) ? selectedOrder.shipments : [];
    return shipments.some((shipment: any) => String(shipment?.trackingNumber ?? "").trim().length > 0);
  }, [selectedOrder]);

  const orderLinked = useMemo(() => {
    const lines = Array.isArray(selectedOrder?.lines) ? selectedOrder.lines : [];
    const matches = Array.isArray(selectedOrder?.stockxMatches) ? selectedOrder.stockxMatches : [];
    return lines.length > 0 && matches.length >= lines.length;
  }, [selectedOrder]);

  const buildLineTitle = (line: any) =>
    line.productName || line.description || line.supplierPid || "—";

  const orderedList = useMemo(() => {
    if (newOrderIds.size === 0) return orders;
    const fresh = orders.filter((o) => newOrderIds.has(o.id));
    const rest = orders.filter((o) => !newOrderIds.has(o.id));
    return [...fresh, ...rest];
  }, [orders, newOrderIds]);

  const ordersByTab = useMemo(() => {
    return orderedList.filter((order) => {
      const state = order.fulfillmentState ?? "to_process";
      if (leftTab === "fulfilled") return state === "fulfilled";
      return state === "to_process";
    });
  }, [orderedList, leftTab]);

  const needsLinking = (order: OrderListItem) => {
    const lines = order._count?.lines ?? 0;
    const linked = order.linkedCount ?? 0;
    return lines > 0 && linked < lines;
  };

  const resendOrdr = async () => {
    if (!selectedOrderId) return;
    setSendingOrdr(true);
    setError(null);
    setOpsLog(null);
    try {
      const res = await fetch("/api/galaxus/edi/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: selectedOrderId,
          types: ["ORDR"],
          force: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Resend ORDR failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSendingOrdr(false);
    }
  };

  /** Swiss Post first; Shipment rows are only created after a successful label (no orphan parcels on API error). */
  const generateDirectSwissPostLabel = async () => {
    if (!selectedOrderId) return;
    setError(null);
    setOpsLog(null);
    try {
      const res = await fetch(`/api/galaxus/orders/${selectedOrderId}/direct-swiss-post-label`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Direct Swiss Post label failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrders();
      if (selectedOrderId) await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    }
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
    const priceRaw = line.priceLineAmount ?? line.lineNetAmount ?? null;
    const priceNumber = typeof priceRaw === "number" ? priceRaw : Number(priceRaw);
    const savedCost =
      match?.stockxAmount != null
        ? Number(match.stockxAmount)
        : null;
    const resolvedCost = Number.isFinite(savedCost as number) ? (savedCost as number) : null;
    const marginAmount =
      Number.isFinite(priceNumber) && resolvedCost != null ? priceNumber - resolvedCost : null;
    const marginPercent =
      Number.isFinite(priceNumber) && priceNumber > 0 && resolvedCost != null
        ? ((priceNumber - resolvedCost) / priceNumber) * 100
        : null;
    const title = buildLineTitle(line);
    const gtin = String(line.gtin ?? "").trim();
    const sizePrefill = String(line.size ?? "");
    const skuPrefill = String(line.supplierSku ?? "N/A");
    const orderLabel = `${selectedOrder?.galaxusOrderId ?? ""}${selectedOrder?.recipientName ? ` · ${selectedOrder.recipientName}` : ""}`;
    const initialData = {
      shopifyOrderId: selectedOrder?.id ?? "",
      shopifyOrderName: orderLabel,
      shopifyCreatedAt: selectedOrder?.orderDate ?? null,
      shopifyLineItemId: line.id,
      shopifyProductTitle: title,
      shopifySku: skuPrefill,
      shopifySizeEU: sizePrefill || "N/A",
      shopifyTotalPrice: Number.isFinite(priceNumber) ? priceNumber : null,
      shopifyCurrencyCode: selectedOrder?.currencyCode ?? "CHF",
      stockxOrderNumber: match?.stockxOrderNumber ?? "",
      // Reuse Chain ID field in the modal as "Supplier PID" (do not persist in DB)
      stockxChainId: String(line.supplierPid ?? "").trim(),
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
      unitIndex: 0,
      initialData,
    });
  };

  const purgeSelectedOrderFromDb = () => {
    if (!selectedOrderId || !selectedOrder?.galaxusOrderId) return;
    void runPurgeGalaxusOrderFromDbUi({
      orderId: selectedOrderId,
      galaxusOrderId: String(selectedOrder.galaxusOrderId),
      setError,
      setPurging: setPurgingOrder,
      onSuccess: async () => {
        setSelectedOrderId(null);
        setSelectedOrder(null);
        await loadOrders();
      },
    });
  };

  const saveManualEntry = async (data: any) => {
    const orderId = manualEntryModal.orderId ?? selectedOrderId;
    if (!orderId || !manualEntryModal.line) return;
    setError(null);
    setOpsLog(null);
    try {
      const res = await fetch(`/api/galaxus/orders/${orderId}/stockx/manual-entry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lineId: manualEntryModal.line.id,
          unitIndex: manualEntryModal.unitIndex,
          data,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Manual entry failed");
      // Non-StockX order numbers should save without warnings (match is still stored).
      setOpsLog(JSON.stringify(json, null, 2));
      setManualEntryModal({ isOpen: false, mode: "create", line: null, orderId: null, unitIndex: 0, initialData: {} });
      await loadOrderDetail(orderId);
    } catch (err: any) {
      setError(err.message);
    }
  };


  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Galaxus Direct Delivery (CH)</h1>
          <p className="text-sm text-gray-500">Minimal direct-delivery operations and StockX linking</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/galaxus" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Ops &amp; Data
          </a>
          <a href="/galaxus/warehouse" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Warehouse
          </a>
          <a href="/galaxus/warehouse-shipments" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Warehouse shipments
          </a>
          <a href="/galaxus/pricing" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Pricing &amp; DB
          </a>
          <a href="/galaxus/invoices" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Invoices
          </a>
          <a href="/decathlon" className="px-3 py-2 rounded bg-teal-700 text-white text-sm">
            Decathlon
          </a>
          <button
            onClick={() => void ingestNewOrders()}
            disabled={loadingOrders || polling}
            className="px-3 py-2 bg-gray-900 text-white rounded"
          >
            {polling ? "Ingesting..." : "Ingest new orders"}
          </button>
        </div>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {polling ? <div className="text-xs text-gray-500">Polling SFTP...</div> : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border rounded p-3">
          <div className="font-semibold mb-2">Orders</div>
          <div className="mb-2 grid grid-cols-2 gap-1 text-xs">
            <button
              className={`rounded border px-2 py-1 ${leftTab === "to_process" ? "bg-black text-white border-black" : "bg-white border-gray-300"}`}
              onClick={() => setLeftTab("to_process")}
            >
              A traiter
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
                <div className="font-medium">{order.orderNumber ?? order.galaxusOrderId}</div>
                <div className="text-xs text-gray-500">
                  {new Date(order.orderDate).toLocaleDateString("fr-CH")} •{" "}
                  {(order.shippedCount ?? 0)}/{order._count?.shipments ?? 0} shipped •{" "}
                  {order.fulfilledCount ?? 0}/{order._count?.shipments ?? 0} fulfilled •{" "}
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
            onAfterAction={async () => {
              if (selectedOrderId) await loadOrderDetail(selectedOrderId);
              await loadOrders();
            }}
          />
          <div className="flex justify-end">
            <button
              onClick={resendOrdr}
              disabled={sendingOrdr || !selectedOrderId}
              className="px-3 py-1.5 bg-gray-900 text-white rounded text-xs"
            >
              {sendingOrdr ? "Sending ORDR..." : "Resend ORDR"}
            </button>
          </div>

          {loadingOrder ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : selectedOrder ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm text-gray-600 min-w-0">
                  {selectedOrder.galaxusOrderId} · {selectedOrder.orderNumber ?? "—"}
                  {selectedOrder.cancelledAt ? (
                    <span className="block text-xs text-red-600 mt-0.5">
                      Cancelled in DB · {new Date(selectedOrder.cancelledAt).toLocaleString()}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
                    ORDR: {selectedOrder.ordrSentAt ? "SENT" : selectedOrder.ordrStatus ?? "PENDING"}
                  </span>
                  <button
                    type="button"
                    title="Permanently delete this order from the database."
                    className="text-xs px-2 py-1.5 rounded bg-red-950 text-white disabled:opacity-50"
                    onClick={purgeSelectedOrderFromDb}
                    disabled={purgingOrder || loadingOrder}
                  >
                    {purgingOrder ? "Removing…" : "Remove from DB"}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {(selectedOrder.lines || []).map((line: any) => {
                  const match = matchesByLine.get(line.id);
                  const proc = line.procurement;
                  const procOk = Boolean(proc?.ok || match);
                  const priceRaw = line.priceLineAmount ?? line.lineNetAmount ?? null;
                  const priceNumber = typeof priceRaw === "number" ? priceRaw : Number(priceRaw);
                  const priceText = Number.isFinite(priceNumber)
                    ? `CHF ${priceNumber.toFixed(2)}`
                    : "—";
                  return (
                    <div
                      key={line.id}
                      className={`border rounded p-3 text-xs ${procOk ? "border-green-400 bg-green-50/40" : ""}`}
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
                          <div className="text-gray-600 font-medium flex items-center gap-1.5 flex-wrap">
                            {procOk ? (
                              <span className="text-green-600" title="Procurement linked">
                                ✓
                              </span>
                            ) : (
                              <span className="text-gray-300">○</span>
                            )}
                            {buildLineTitle(line)}
                            {proc?.warehouseStockHint === "MAISON" ? (
                              <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-violet-100 text-violet-900">
                                THE / your stock
                              </span>
                            ) : proc?.warehouseStockHint === "NER_STOCK" ? (
                              <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-amber-100 text-amber-950">
                                NER_ · partner stock
                              </span>
                            ) : null}
                          </div>
                          <div className="text-gray-500">
                            Supplier PID: {line.supplierPid ?? "—"}
                          </div>
                          <div className="text-gray-500">
                            Size raw: {line.sizeRaw ?? "—"} · Size: {line.size ?? "—"} · SKU: {line.supplierSku ?? "—"} ·
                            Qty: {line.quantity}
                          </div>
                          <div className="text-gray-500">Sell price: {priceText}</div>
                        </div>
                        <div className="text-right">
                          {(() => {
                            const sellRaw = line.priceLineAmount ?? line.lineNetAmount ?? null;
                            const sell = typeof sellRaw === "number" ? sellRaw : Number(sellRaw);
                            const cost = Number(match?.stockxAmount ?? NaN);
                            const hasMargin = Number.isFinite(sell) && Number.isFinite(cost);
                            const margin = hasMargin ? sell - cost : null;
                            const marginPct = hasMargin && sell > 0 ? ((sell - cost) / sell) * 100 : null;
                            return (
                              <>
                          <div className={`font-medium ${procOk ? "text-green-700" : "text-red-600"}`}>
                            {procOk
                              ? proc?.warehouseStockHint === "MAISON" || proc?.warehouseStockHint === "NER_STOCK"
                                ? proc?.warehouseStockHint === "MAISON"
                                  ? "THE_/the_ your stock (no StockX)"
                                  : "NER_ partner stock (no StockX)"
                                : proc?.source === "stx_sync"
                                  ? `Linked (sync)${proc?.awb ? ` · AWB ${proc.awb}` : ""}`
                                  : match
                                    ? `Linked ${match.stockxOrderNumber}`
                                    : "Linked"
                              : "Not linked"}
                          </div>
                          <div className="text-gray-500">
                            ETA: {match?.stockxEstimatedDelivery ? new Date(match.stockxEstimatedDelivery).toLocaleDateString("fr-CH") : "—"}
                          </div>
                          <div className="text-gray-500">
                            Cost: {match?.stockxAmount != null ? `CHF ${match.stockxAmount}` : "—"}
                          </div>
                          <div className="text-gray-500">
                            Margin: {margin != null ? `CHF ${margin.toFixed(2)}` : "—"}
                            {marginPct != null ? ` (${marginPct.toFixed(1)}%)` : ""}
                          </div>
                              </>
                            );
                          })()}
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
                        <button
                          onClick={() => void generateDirectSwissPostLabel()}
                          disabled={orderFulfilled}
                          className="px-2 py-1 bg-gray-900 text-white rounded disabled:opacity-50"
                        >
                          {orderFulfilled ? "Already fulfilled" : "Generate Swiss Post label"}
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
        onClose={() =>
          setManualEntryModal({ isOpen: false, mode: "create", line: null, orderId: null, unitIndex: 0, initialData: {} })
        }
      />
    </div>
  );
}
