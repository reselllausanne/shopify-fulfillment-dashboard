"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GalaxusManualEntryModal from "@/app/components/GalaxusManualEntryModal";
import { StockxOrderTools } from "@/app/galaxus/_components/StockxOrderTools";
import {
  decathlonGrossLineAmount,
  decathlonMarginFromGrossAndCost,
  decathlonOrderMarginRollup,
} from "@/decathlon/orders/margin";

type OrderListItem = {
  id: string;
  orderId: string;
  orderNumber?: string | null;
  orderDate: string;
  shippedCount?: number;
  linkedCount?: number;
  orderState?: string | null;
  partnerKey?: string | null;
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
  const [leftTab, setLeftTab] = useState<"to_process" | "fulfilled" | "canceled">("to_process");
  const [manualEntryModal, setManualEntryModal] = useState<{
    isOpen: boolean;
    mode: "create" | "edit";
    line: any | null;
    orderId: string | null;
    initialData: any;
  }>({ isOpen: false, mode: "create", line: null, orderId: null, initialData: {} });
  const [partners, setPartners] = useState<Array<{ id: string; key: string; name: string }>>([]);
  const [assigningPartner, setAssigningPartner] = useState(false);
  const [selectedPartnerKey, setSelectedPartnerKey] = useState("");

  const downloadPdf = async (url: string, fallbackName: string) => {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      const data = ct.includes("application/json") ? await res.json().catch(() => ({})) : {};
      throw new Error((data as any).error ?? `Download failed (${res.status})`);
    }
    const blob = await res.blob();
    const dispo = res.headers.get("Content-Disposition") ?? "";
    const m = /filename\*?=(?:UTF-8''|)([^";\n]+)|filename="([^"]+)"/i.exec(dispo);
    const rawName = (m?.[1] || m?.[2] || "").trim();
    const filename = rawName.replace(/^["']|["']$/g, "") || fallbackName;
    const urlObj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = urlObj;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(urlObj);
    return filename;
  };

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

  const loadPartners = async () => {
    try {
      const res = await fetch("/api/partners/list", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPartners(Array.isArray(data.items) ? data.items : []);
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to load partners");
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

  const assignPartner = async () => {
    if (!selectedOrderId || !selectedPartnerKey) return;
    setAssigningPartner(true);
    setError(null);
    try {
      const res = await fetch(`/api/decathlon/orders/${selectedOrderId}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ partnerKey: selectedPartnerKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Assignment failed");
      await Promise.all([loadOrderDetail(selectedOrderId), loadOrders()]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAssigningPartner(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, [leftTab]);

  useEffect(() => {
    loadPartners();
  }, []);

  useEffect(() => {
    if (selectedOrderId) {
      setSelectedOrder(null);
      loadOrderDetail(selectedOrderId);
    }
  }, [selectedOrderId]);

  useEffect(() => {
    setSelectedPartnerKey(selectedOrder?.partnerKey ?? "");
  }, [selectedOrder?.partnerKey]);

  const matchesByLine = useMemo(() => {
    const map = new Map<string, any>();
    (selectedOrder?.stockxMatches || []).forEach((m: any) => {
      map.set(m.decathlonOrderLineId, m);
    });
    return map;
  }, [selectedOrder]);

  const buildLineTitle = (line: any) => line.productTitle || line.description || line.offerSku || "—";
  const normalizeState = (state?: string | null) => String(state ?? "").trim().toUpperCase();
  const canceledStates = useMemo(
    () => new Set(["CANCELED", "CANCELLED", "ORDER_CANCELLED", "CLOSED"]),
    []
  );

  const orderedList = useMemo(() => {
    if (newOrderIds.size === 0) return orders;
    const fresh = orders.filter((o) => newOrderIds.has(o.id));
    const rest = orders.filter((o) => !newOrderIds.has(o.id));
    return [...fresh, ...rest];
  }, [orders, newOrderIds]);

  const ordersByTab = useMemo(() => {
    return orderedList.filter((order) => {
      const state = normalizeState(order.orderState);
      const shippedCount = order._count?.shipments ?? order.shippedCount ?? 0;
      const isShipped = shippedCount > 0;
      const isCanceled = canceledStates.has(state);
      const isOpen = !state || (!isShipped && !isCanceled);
      if (leftTab === "fulfilled") return isShipped;
      if (leftTab === "canceled") return isCanceled;
      return isOpen;
    });
  }, [orderedList, leftTab, canceledStates]);

  const needsLinking = (order: OrderListItem) => {
    if (order.partnerKey) return false;
    const lines = order._count?.lines ?? 0;
    const linked = order.linkedCount ?? 0;
    return lines > 0 && linked < lines;
  };

  /** Same idea as Galaxus `proc?.ok || match`: StockX row counts as linked only with a real buy reference. */
  const isStockxMatchLinked = (match: any) => {
    if (!match) return false;
    const onum = String(match.stockxOrderNumber ?? "").trim();
    const oid = String(match.stockxOrderId ?? "").trim();
    return onum.length > 0 || oid.length > 0;
  };

  const orderMarginRollup = useMemo(() => {
    const lines = selectedOrder?.lines;
    if (!Array.isArray(lines) || lines.length === 0) return null;
    return decathlonOrderMarginRollup(lines, (lineId) => {
      const m = matchesByLine.get(lineId);
      if (!isStockxMatchLinked(m)) return null;
      const c = Number(m?.stockxAmount);
      return Number.isFinite(c) ? c : null;
    });
  }, [selectedOrder?.lines, matchesByLine]);

  const canFulfill = useMemo(() => {
    const state = normalizeState(selectedOrder?.orderState);
    const hasShipment =
      Array.isArray(selectedOrder?.shipments) && selectedOrder.shipments.length > 0;
    if (hasShipment) return false;
    if (!state) return true;
    return !hasShipment && !canceledStates.has(state);
  }, [selectedOrder?.orderState, selectedOrder?.shipments?.length, canceledStates]);

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
    const grossLine = decathlonGrossLineAmount(line);
    const savedCost = match?.stockxAmount != null ? Number(match.stockxAmount) : null;
    const resolvedCost = Number.isFinite(savedCost as number) ? (savedCost as number) : null;
    const marginBreakdown =
      grossLine != null && resolvedCost != null
        ? decathlonMarginFromGrossAndCost(grossLine, resolvedCost)
        : null;
    const marginAmount =
      marginBreakdown != null ? Number(marginBreakdown.margin.toFixed(2)) : null;
    const marginPercent =
      marginBreakdown?.marginPercentOfLineAfter != null
        ? Number(marginBreakdown.marginPercentOfLineAfter.toFixed(2))
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
      shopifyTotalPrice: grossLine ?? null,
      shopifyCurrencyCode: selectedOrder?.currencyCode ?? "CHF",
      stockxOrderNumber: match?.stockxOrderNumber ?? "",
      stockxChainId: match?.stockxChainId ?? "",
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
      await Promise.all([loadOrderDetail(orderId), loadOrders()]);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const generatePackingSlip = async () => {
    if (!selectedOrderId) return;
    setOpsLog(null);
    setError(null);
    try {
      const filename = await downloadPdf(
        `/api/decathlon/orders/${selectedOrderId}/documents/packing-slip`,
        `decathlon-delivery_${selectedOrderId}.pdf`
      );
      setOpsLog(`Saved to Downloads: ${filename}`);
      await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const downloadLabel = async () => {
    if (!selectedOrderId) return;
    const filename = await downloadPdf(
      `/api/decathlon/orders/${selectedOrderId}/documents/label`,
      `decathlon-label_${selectedOrderId}.pdf`
    );
    setOpsLog(`Saved to Downloads: ${filename}`);
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
      await downloadLabel();
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
          <div className="mb-2 grid grid-cols-3 gap-1 text-xs">
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
            <button
              className={`rounded border px-2 py-1 ${leftTab === "canceled" ? "bg-black text-white border-black" : "bg-white border-gray-300"}`}
              onClick={() => setLeftTab("canceled")}
            >
              Canceled
            </button>
          </div>
          <div className="space-y-2 max-h-[500px] overflow-auto">
            {ordersByTab.map((order) => {
              const lineCount = order._count?.lines ?? 0;
              const linked = order.linkedCount ?? 0;
              const allLinesLinked = lineCount > 0 && linked >= lineCount;
              const isPartnerOrder = Boolean(order.partnerKey);
              const state = normalizeState(order.orderState);
              const isCanceled = canceledStates.has(state);
              const partnerTone =
                state === "SHIPPED"
                  ? "border-emerald-500 bg-emerald-50"
                  : isCanceled
                    ? "border-amber-500 bg-amber-50"
                    : "border-blue-500 bg-blue-50";
              const baseTone = isPartnerOrder
                ? partnerTone
                : isCanceled
                  ? "border-amber-500 bg-amber-50"
                  : needsLinking(order)
                    ? "border-red-500 bg-red-50"
                    : allLinesLinked
                      ? "border-green-500 bg-green-50"
                      : newOrderIds.has(order.id)
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-gray-200";
              return (
              <button
                key={order.id}
                onClick={() => setSelectedOrderId(order.id)}
                className={`w-full text-left border rounded p-2 text-sm ${
                  selectedOrderId === order.id ? "border-black" : baseTone
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{order.orderNumber ?? order.orderId}</div>
                  {order.partnerKey ? (
                    <span
                      className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        order.orderState === "SHIPPED" ? "bg-emerald-600 text-white" : "bg-blue-600 text-white"
                      }`}
                    >
                      Partner {order.partnerKey}
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(order.orderDate).toLocaleDateString("fr-CH")} •{" "}
                  {order.partnerKey ? `${lineCount} lines` : `${linked}/${lineCount} linked`}
                </div>
              </button>
            );
            })}
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
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-600">Assign partner</span>
            <select
              value={selectedPartnerKey}
              onChange={(event) => setSelectedPartnerKey(event.target.value)}
              disabled={!selectedOrderId}
              className="border rounded px-2 py-1 text-xs"
            >
              <option value="">Select partner...</option>
              {partners.map((partner) => (
                <option key={partner.id} value={partner.key}>
                  {partner.name} ({partner.key})
                </option>
              ))}
            </select>
            <button
              onClick={assignPartner}
              disabled={!selectedOrderId || !selectedPartnerKey || assigningPartner}
              className="px-2 py-1 bg-gray-900 text-white rounded text-xs"
            >
              {assigningPartner ? "Assigning..." : "Assign"}
            </button>
            {selectedOrder?.partnerKey ? (
              <span className="text-gray-500">Current: {selectedOrder.partnerKey}</span>
            ) : null}
          </div>
          <p className="text-xs text-gray-600">
            StockX sync updates every line that already has a buy reference: it re-fetches by saved order # (or
            chain/order id) for AWB, ETAs, and tracking—no variant matching. After that, it still tries to link
            pending catalog STX lines from recent PENDING buys.
          </p>
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
              disabled={!selectedOrderId || !canFulfill}
              title={!canFulfill ? "Canceled orders cannot be fulfilled" : undefined}
              className="px-3 py-1.5 bg-gray-900 text-white rounded text-xs"
            >
              Generate label + ship
            </button>
          </div>
          {!canFulfill && selectedOrder ? (
            <div className="text-xs text-amber-600">This order is canceled and cannot be fulfilled.</div>
          ) : null}

          {loadingOrder ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : selectedOrder ? (
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                {selectedOrder.orderId} · {selectedOrder.orderNumber ?? "—"}
              </div>
              <div className="text-xs text-gray-500 border-b border-gray-100 pb-2 space-y-0.5">
                <div className="font-medium text-gray-700">{selectedOrder.recipientName ?? "—"}</div>
                <div>
                  {selectedOrder.recipientAddress1 ?? ""} {selectedOrder.recipientAddress2 ?? ""}
                </div>
                <div>
                  {selectedOrder.recipientPostalCode ?? ""} {selectedOrder.recipientCity ?? ""}{" "}
                  {selectedOrder.recipientCountryCode ?? selectedOrder.recipientCountry ?? ""}
                </div>
              </div>
              {orderMarginRollup && orderMarginRollup.linesNetAfterDecathlon > 0 ? (
                <div className="text-xs text-gray-600">
                  CHF {orderMarginRollup.marginAfterFeeAndKnownCosts.toFixed(2)}
                  {orderMarginRollup.marginPercentOfNetOrder != null
                    ? ` · ${orderMarginRollup.marginPercentOfNetOrder.toFixed(1)}%`
                    : ""}
                </div>
              ) : null}
              <div className="space-y-2">
                {(selectedOrder.lines || []).map((line: any) => {
                  const match = matchesByLine.get(line.id);
                  const cat = line.catalog ?? null;
                  const lineOk = isStockxMatchLinked(match);
                  const grossLine = decathlonGrossLineAmount(line);
                  const cost = Number(match?.stockxAmount ?? NaN);
                  const lineMargin =
                    lineOk && grossLine != null && Number.isFinite(cost)
                      ? decathlonMarginFromGrossAndCost(grossLine, cost)
                      : null;
                  const catalogPrice = cat?.catalogPrice ?? null;
                  const costVsCatalog =
                    lineOk && catalogPrice != null && Number.isFinite(cost)
                      ? cost - catalogPrice
                      : null;
                  const matchType = String(match?.matchType ?? "").toUpperCase();
                  const linkedLabel =
                    lineOk
                      ? matchType === "SYNC" || matchType === "STOCKX_SYNC_DECATHLON"
                        ? `Linked (sync)${match?.stockxAwb ? ` · AWB ${match.stockxAwb}` : ""}`
                        : match?.stockxOrderNumber
                          ? `Linked ${match.stockxOrderNumber}`
                          : "Linked"
                      : "Not linked";
                  const sizeDisplay =
                    cat?.sizeRaw ??
                    line.kickdb?.sizeRaw ??
                    line.kickdb?.sizeEu ??
                    line.kickdb?.sizeUs ??
                    line.size ??
                    "—";
                  const catalogPriceText =
                    catalogPrice != null ? `CHF ${Number(catalogPrice).toFixed(2)}` : "—";
                  const catalogSyncHint = cat?.lastSyncAt
                    ? `Feed ${new Date(cat.lastSyncAt).toLocaleString("fr-CH", { dateStyle: "short", timeStyle: "short" })}`
                    : null;
                  return (
                    <div
                      key={line.id}
                      className={`border rounded p-3 text-xs ${lineOk ? "border-green-400 bg-green-50/40" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-1.5 min-w-0">
                          <div className="text-gray-600 font-medium flex items-center gap-1.5 flex-wrap">
                            {lineOk ? (
                              <span
                                className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-green-600 text-white shrink-0"
                                title="StockX linked"
                              >
                                STX
                              </span>
                            ) : (
                              <span className="text-gray-300">○</span>
                            )}
                            {buildLineTitle(line)}
                          </div>
                          <div className="text-gray-500 text-[11px] leading-snug flex flex-wrap gap-x-3 gap-y-0.5">
                            <span>
                              Size: <span className="text-gray-800 font-medium">{sizeDisplay}</span>
                            </span>
                            <span className="min-w-0">
                              Variant: {line.kickdb?.variantName ?? "—"}
                            </span>
                            <span className="min-w-0">
                              Style: {line.kickdb?.styleId ?? line.productSku ?? "—"}
                            </span>
                            <span className="text-gray-400">Qty {line.quantity ?? "—"}</span>
                          </div>
                          <div className="text-[11px] border-t border-gray-100 pt-1.5 mt-1 space-y-0.5">
                            <div className="font-medium text-gray-700">Catalog (supplier feed)</div>
                            <div className="text-gray-600 flex flex-wrap gap-x-3 gap-y-0.5">
                              <span>
                                Feed price: <span className="font-mono text-[10px]">{catalogPriceText}</span>
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
                              <div className="text-gray-400 text-[10px]">{catalogSyncHint}</div>
                            ) : null}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`font-medium ${lineOk ? "text-green-700" : "text-red-600"}`}>
                            {linkedLabel}
                          </div>
                          <div className="text-gray-500">
                            ETA:{" "}
                            {match?.stockxEstimatedDelivery
                              ? new Date(match.stockxEstimatedDelivery).toLocaleDateString("fr-CH")
                              : "—"}
                          </div>
                          <div className="text-gray-500">
                            StockX cost:{" "}
                            {match?.stockxAmount != null ? `CHF ${Number(match.stockxAmount).toFixed(2)}` : "—"}
                          </div>
                          {grossLine != null ? (
                            <div className="text-gray-500">
                              Gross (line): CHF {grossLine.toFixed(2)}
                            </div>
                          ) : null}
                          {lineOk && lineMargin ? (
                            <div className="text-gray-700 font-medium">
                              CHF {lineMargin.margin.toFixed(2)}
                              {lineMargin.marginPercentOfLineAfter != null
                                ? ` · ${lineMargin.marginPercentOfLineAfter.toFixed(1)}%`
                                : ""}
                            </div>
                          ) : null}
                          {costVsCatalog != null && Number.isFinite(costVsCatalog) ? (
                            <div
                              className={`text-[10px] mt-0.5 ${costVsCatalog > 0 ? "text-amber-700" : "text-gray-500"}`}
                              title="StockX settled cost minus catalog feed price"
                            >
                              vs catalog: {costVsCatalog >= 0 ? "+" : ""}
                              {costVsCatalog.toFixed(2)} CHF
                            </div>
                          ) : null}
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
        context="decathlon"
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
