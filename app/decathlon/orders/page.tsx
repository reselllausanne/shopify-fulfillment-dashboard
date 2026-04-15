"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GalaxusManualEntryModal from "@/app/components/GalaxusManualEntryModal";
import { StockxOrderTools } from "@/app/galaxus/_components/StockxOrderTools";
import {
  decathlonMarginFromGrossAndCost,
  decathlonMiraklSellTotal,
  decathlonOrderMarginRollup,
  decathlonPayoutLineAmount,
} from "@/decathlon/orders/margin";

type OrderListItem = {
  id: string;
  orderId: string;
  orderNumber?: string | null;
  orderDate: string;
  shippedCount?: number;
  shippedUnits?: number;
  totalUnits?: number;
  remainingUnits?: number;
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
    unitIndex: number;
    initialData: any;
  }>({ isOpen: false, mode: "create", line: null, orderId: null, unitIndex: 0, initialData: {} });
  const [partners, setPartners] = useState<Array<{ id: string; key: string; name: string }>>([]);
  const [assigningPartner, setAssigningPartner] = useState(false);
  const [selectedPartnerKey, setSelectedPartnerKey] = useState("");
  const [productSearchInput, setProductSearchInput] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [splitQuantities, setSplitQuantities] = useState<Record<string, number>>({});
  const [splitSubmitting, setSplitSubmitting] = useState(false);
  const [partnerFeeStats, setPartnerFeeStats] = useState<{
    spreadChf: number;
    decathlonShippedChf: number;
    partnerCatalogChf: number;
    shippedLineCount: number;
    currency: string;
  } | null>(null);
  const [partnerFeeStatsErr, setPartnerFeeStatsErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/decathlon/partner-shipped-fees", { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load partner fee stats");
        setPartnerFeeStats({
          spreadChf: Number(data.spreadChf ?? 0),
          decathlonShippedChf: Number(data.decathlonShippedChf ?? 0),
          partnerCatalogChf: Number(data.partnerCatalogChf ?? 0),
          shippedLineCount: Number(data.shippedLineCount ?? 0),
          currency: String(data.currency ?? "CHF"),
        });
        setPartnerFeeStatsErr(null);
      } catch (e: any) {
        if (!cancelled) {
          setPartnerFeeStats(null);
          setPartnerFeeStatsErr(e?.message ?? "Failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setProductSearch(productSearchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [productSearchInput]);

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

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: "50", view: leftTab });
      if (productSearch) qs.set("product", productSearch);
      const res = await fetch(`/api/decathlon/orders?${qs.toString()}`, { cache: "no-store" });
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
      setSelectedOrderId((prev) => {
        if (items.length === 0) return null;
        if (prev && items.some((i) => i.id === prev)) return prev;
        return items[0].id;
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingOrders(false);
    }
  }, [leftTab, productSearch]);

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
      const order = data.order;
      setSelectedOrder(order);
      if (order) {
        const shippedCount = Array.isArray(order.shipments)
          ? order.shipments.filter((s: any) => Boolean(s?.shippedAt)).length
          : 0;
        const shipmentCount = Array.isArray(order.shipments) ? order.shipments.length : 0;
        const summary = buildShipmentSummary(order);
        setOrders((prev) =>
          prev.map((item) =>
            item.id === order.id
              ? {
                  ...item,
                  orderState: order.orderState ?? item.orderState ?? null,
                  shippedCount,
                  shippedUnits: summary.shippedUnits,
                  totalUnits: summary.totalUnits,
                  remainingUnits: summary.remainingUnits,
                  _count: { ...(item._count ?? { lines: 0, shipments: 0 }), shipments: shipmentCount },
                }
              : item
          )
        );
      }
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
    void loadOrders();
  }, [loadOrders]);

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
  const buildShipmentSummary = (order: any) => {
    const lines = Array.isArray(order?.lines) ? order.lines : [];
    const shipments = Array.isArray(order?.shipments) ? order.shipments : [];
    const shipmentLines = shipments.flatMap((shipment: any) => shipment.lines ?? []);
    const lineTotals = new Map<string, number>();
    if (shipmentLines.length === 0 && shipments.some((shipment: any) => shipment?.shippedAt)) {
      for (const line of lines) {
        lineTotals.set(line.id, Number(line.quantity ?? 0));
      }
    } else {
      for (const line of shipmentLines) {
        const lineId = String(line.orderLineId ?? "").trim();
        if (!lineId) continue;
        const qty = Number(line.quantity ?? 0);
        lineTotals.set(lineId, (lineTotals.get(lineId) ?? 0) + (Number.isFinite(qty) ? qty : 0));
      }
    }
    const totalUnits = lines.reduce((sum: number, line: any) => sum + Number(line.quantity ?? 0), 0);
    const shippedUnits = lines.reduce((sum: number, line: any) => sum + (lineTotals.get(line.id) ?? 0), 0);
    const remainingUnits = Math.max(totalUnits - shippedUnits, 0);
    return { lineTotals, totalUnits, shippedUnits, remainingUnits };
  };

  const selectedShipmentSummary = buildShipmentSummary(selectedOrder);

  const miraklTrackingByLineId = useMemo(() => {
    const map = new Map<string, string>();
    const shipments = Array.isArray(selectedOrder?.shipments) ? selectedOrder.shipments : [];
    for (const s of shipments) {
      const tn = String(s?.trackingNumber ?? "").trim();
      if (!tn) continue;
      for (const sl of s.lines ?? []) {
        const lid = String(sl?.orderLineId ?? "").trim();
        if (lid) map.set(lid, tn);
      }
    }
    return map;
  }, [selectedOrder?.shipments]);

  const miraklShipmentRows = useMemo(
    () =>
      (Array.isArray(selectedOrder?.shipments) ? selectedOrder.shipments : []).filter((s: any) =>
        String(s?.miraklShipmentId ?? "").trim()
      ),
    [selectedOrder?.shipments]
  );
  const packingSlipNeedsShipmentPick = miraklShipmentRows.length > 1;

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
      const totalUnits = order.totalUnits ?? 0;
      const shippedUnits = order.shippedUnits ?? 0;
      const remainingUnits =
        order.remainingUnits ?? Math.max(totalUnits - shippedUnits, 0);
      const isShipped = totalUnits > 0 ? remainingUnits <= 0 : shippedCount > 0;
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
    const chain = String(match.stockxChainId ?? "").trim();
    return onum.length > 0 || oid.length > 0 || chain.length > 0;
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
    if (!selectedOrder) return false;
    const state = normalizeState(selectedOrder?.orderState);
    const remainingUnits = selectedShipmentSummary.remainingUnits ?? 0;
    if (remainingUnits <= 0) return false;
    if (!state) return true;
    return !canceledStates.has(state);
  }, [selectedOrder, selectedOrder?.orderState, selectedShipmentSummary.remainingUnits, canceledStates]);

  const canSplitShipment = useMemo(() => {
    if (!selectedOrder) return false;
    const lineCount = Array.isArray(selectedOrder?.lines) ? selectedOrder.lines.length : 0;
    if (lineCount < 2) return false;
    const remainingUnits = selectedShipmentSummary.remainingUnits ?? 0;
    if (remainingUnits <= 0) return false;
    const state = normalizeState(selectedOrder?.orderState);
    return !canceledStates.has(state);
  }, [selectedOrder, selectedOrder?.orderState, selectedShipmentSummary.remainingUnits, canceledStates]);

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
    const payoutLine = decathlonPayoutLineAmount(line);
    const savedCost = match?.stockxAmount != null ? Number(match.stockxAmount) : null;
    const resolvedCost = Number.isFinite(savedCost as number) ? (savedCost as number) : null;
    const marginBreakdown =
      payoutLine != null && resolvedCost != null
        ? decathlonMarginFromGrossAndCost(payoutLine, resolvedCost)
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
      shopifyTotalPrice: payoutLine ?? null,
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
      unitIndex: 0,
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
      setManualEntryModal({ isOpen: false, mode: "create", line: null, orderId: null, unitIndex: 0, initialData: {} });
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

  const openSplitShipment = () => {
    if (!selectedOrder) return;
    const next: Record<string, number> = {};
    for (const line of selectedOrder.lines ?? []) {
      const ordered = Number(line.quantity ?? 0);
      const shipped = selectedShipmentSummary.lineTotals.get(line.id) ?? 0;
      const remaining = Math.max(ordered - shipped, 0);
      if (remaining > 0) {
        next[line.id] = 0;
      }
    }
    setSplitQuantities(next);
    setSplitModalOpen(true);
  };

  const updateSplitQuantity = (lineId: string, value: number, max: number) => {
    const nextValue = Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0;
    setSplitQuantities((prev) => ({ ...prev, [lineId]: nextValue }));
  };

  const submitSplitShipment = async () => {
    if (!selectedOrderId || !selectedOrder) return;
    setError(null);
    setOpsLog(null);
    const items: Array<{ lineId: string; quantity: number }> = [];
    for (const line of selectedOrder.lines ?? []) {
      const ordered = Number(line.quantity ?? 0);
      const shipped = selectedShipmentSummary.lineTotals.get(line.id) ?? 0;
      const remaining = Math.max(ordered - shipped, 0);
      const quantity = Number(splitQuantities[line.id] ?? 0);
      if (quantity <= 0) continue;
      if (quantity > remaining) {
        setError("Split shipment exceeds remaining quantity.");
        return;
      }
      items.push({ lineId: line.id, quantity });
    }
    if (items.length === 0) {
      setError("Select at least one line to ship.");
      return;
    }
    try {
      setSplitSubmitting(true);
      const res = await fetch(`/api/decathlon/orders/${selectedOrderId}/ship`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Split shipment failed");
      setOpsLog(JSON.stringify(data, null, 2));
      setSplitModalOpen(false);
      setSplitQuantities({});
      await Promise.all([loadOrderDetail(selectedOrderId), loadOrders()]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSplitSubmitting(false);
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
          {partnerFeeStats ? (
            <div
              className="max-w-md rounded border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-left text-xs text-emerald-950"
              title="Decathlon Mirakl line price × shipped qty minus partner catalog feed price × qty. NER excluded."
            >
              <div className="font-semibold text-emerald-900">Partner fees (reference)</div>
              <div>
                Spread {partnerFeeStats.currency} {partnerFeeStats.spreadChf.toFixed(2)} · Decathlon{" "}
                {partnerFeeStats.decathlonShippedChf.toFixed(2)} vs catalog {partnerFeeStats.partnerCatalogChf.toFixed(
                  2
                )}{" "}
                · {partnerFeeStats.shippedLineCount} lines
              </div>
              <div className="mt-0.5 text-[10px] text-emerald-800/85">
                If catalog ≈ 90% of Decathlon sell, implied fee band ≈{" "}
                {(partnerFeeStats.decathlonShippedChf * 0.1).toFixed(2)} {partnerFeeStats.currency} on shipped
                revenue.
              </div>
            </div>
          ) : partnerFeeStatsErr ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Fee stats: {partnerFeeStatsErr}
            </div>
          ) : (
            <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500">
              Loading partner fee stats…
            </div>
          )}
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
          <label className="block mt-2">
            <span className="sr-only">Search by product name</span>
            <input
              type="search"
              enterKeyHint="search"
              placeholder="Search product name…"
              value={productSearchInput}
              onChange={(e) => setProductSearchInput(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </label>
          {productSearch ? (
            <div className="text-[11px] text-gray-500 mt-1">
              Filter: “{productSearch}” · {loadingOrders ? "…" : `${ordersByTab.length} order(s)`}
            </div>
          ) : null}
          <div className="space-y-2 max-h-[500px] overflow-auto mt-2">
            {ordersByTab.map((order) => {
              const lineCount = order._count?.lines ?? 0;
              const linked = order.linkedCount ?? 0;
              const totalUnits = order.totalUnits ?? 0;
              const shippedUnits = order.shippedUnits ?? 0;
              const unitTotal = totalUnits > 0 ? totalUnits : lineCount;
              const unitShipped = totalUnits > 0 ? shippedUnits : Math.min(shippedUnits, unitTotal);
              const shipmentProgress = unitTotal > 0 ? `${unitShipped}/${unitTotal} shipped` : null;
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
                  {shipmentProgress ? ` • ${shipmentProgress}` : ""}
                </div>
              </button>
            );
            })}
            {ordersByTab.length === 0 ? (
              <div className="text-xs text-gray-500">
                {productSearch ? "No orders match this product name." : "No orders in this tab."}
              </div>
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
              disabled={!selectedOrderId || packingSlipNeedsShipmentPick}
              title={
                packingSlipNeedsShipmentPick
                  ? "Multiple Mirakl shipments: use Packing slip on a parcel below."
                  : undefined
              }
              className="px-3 py-1.5 bg-gray-100 rounded text-xs"
            >
              Download packing slip
            </button>
            {canSplitShipment ? (
              <button
                onClick={openSplitShipment}
                disabled={!selectedOrderId || splitSubmitting}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs"
              >
                Split shipment
              </button>
            ) : null}
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
              {selectedShipmentSummary.totalUnits > 0 ? (
                <div className="text-xs text-gray-500">
                  Shipped {selectedShipmentSummary.shippedUnits}/{selectedShipmentSummary.totalUnits}
                  {selectedShipmentSummary.remainingUnits > 0
                    ? ` · Remaining ${selectedShipmentSummary.remainingUnits}`
                    : " · Fully shipped"}
                </div>
              ) : null}
              {Array.isArray(selectedOrder.shipments) &&
              selectedOrder.shipments.some((s: any) => Boolean(s?.shippedAt)) ? (
                <div className="text-xs border border-gray-200 rounded p-2 space-y-1.5 bg-gray-50/60">
                  <div className="font-medium text-gray-700">Parcels (packing slip per shipment)</div>
                  {selectedOrder.shipments
                    .filter((s: any) => Boolean(s?.shippedAt))
                    .map((s: any) => (
                      <div
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-600"
                      >
                        <div className="min-w-0">
                          <span className="font-mono text-gray-900">{s.trackingNumber ?? "—"}</span>
                          {s.miraklShipmentId ? (
                            <span className="text-gray-400 ml-2 break-all">
                              Mirakl {String(s.miraklShipmentId)}
                            </span>
                          ) : (
                            <span className="text-gray-400 ml-2">Legacy shipment (no Mirakl id)</span>
                          )}
                        </div>
                        {s.miraklShipmentId ? (
                          <button
                            type="button"
                            className="px-2 py-0.5 bg-white border border-gray-300 rounded shrink-0"
                            onClick={async () => {
                              try {
                                setOpsLog(null);
                                setError(null);
                                const fn = await downloadPdf(
                                  `/api/decathlon/orders/${selectedOrderId}/documents/packing-slip?shipmentId=${encodeURIComponent(s.id)}`,
                                  `decathlon-delivery_${selectedOrder?.orderId ?? selectedOrderId}_${s.id}.pdf`
                                );
                                setOpsLog(`Saved to Downloads: ${fn}`);
                                await loadOrderDetail(selectedOrderId!);
                              } catch (err: any) {
                                setError(err.message);
                              }
                            }}
                          >
                            Packing slip (OR72/73)
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="px-2 py-0.5 bg-white border border-gray-300 rounded shrink-0"
                            onClick={async () => {
                              try {
                                setOpsLog(null);
                                setError(null);
                                const fn = await downloadPdf(
                                  `/api/decathlon/orders/${selectedOrderId}/documents/packing-slip`,
                                  `decathlon-delivery_${selectedOrder?.orderId ?? selectedOrderId}.pdf`
                                );
                                setOpsLog(`Saved to Downloads: ${fn}`);
                                await loadOrderDetail(selectedOrderId!);
                              } catch (err: any) {
                                setError(err.message);
                              }
                            }}
                          >
                            Packing slip (order)
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              ) : null}
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
                <div className="text-xs text-gray-600 space-y-0.5 border-t border-gray-100 pt-2">
                  <div>
                    <span className="text-gray-500">Payout Decathlon (est.)</span>{" "}
                    <span className="font-semibold text-gray-900">
                      CHF {orderMarginRollup.linesNetAfterDecathlon.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Marge (coûts StockX liés)</span>{" "}
                    <span className="font-medium text-gray-800">
                      CHF {orderMarginRollup.marginAfterFeeAndKnownCosts.toFixed(2)}
                      {orderMarginRollup.marginPercentOfNetOrder != null
                        ? ` · ${orderMarginRollup.marginPercentOfNetOrder.toFixed(1)}% du payout`
                        : ""}
                    </span>
                  </div>
                </div>
              ) : null}
              <div className="space-y-2">
                {(selectedOrder.lines || []).map((line: any) => {
                  const match = matchesByLine.get(line.id);
                  const cat = line.catalog ?? null;
                  const lineOk = isStockxMatchLinked(match);
                  const sellBrut = decathlonMiraklSellTotal(line);
                  const payoutLine = decathlonPayoutLineAmount(line);
                  const cost = Number(match?.stockxAmount ?? NaN);
                  const lineMargin =
                    lineOk && payoutLine != null && Number.isFinite(cost)
                      ? decathlonMarginFromGrossAndCost(payoutLine, cost)
                      : null;
                  const catalogPrice = cat?.catalogPrice ?? null;
                  const costVsCatalog =
                    lineOk && catalogPrice != null && Number.isFinite(cost)
                      ? cost - catalogPrice
                      : null;
                  const matchType = String(match?.matchType ?? "").toUpperCase();
                  const orderedQty = Number(line.quantity ?? 0);
                  const shippedQty = selectedShipmentSummary.lineTotals.get(line.id) ?? 0;
                  const remainingQty = Math.max(orderedQty - shippedQty, 0);
                  const lineFullyMiraklShipped =
                    Number.isFinite(orderedQty) && orderedQty > 0 && shippedQty >= orderedQty;
                  const lineShipTracking = miraklTrackingByLineId.get(line.id) ?? null;
                  const stockxAwb = match?.stockxAwb ? String(match.stockxAwb).trim() : "";
                  const stxAwbExtra =
                    stockxAwb && stockxAwb !== lineShipTracking ? ` · StockX AWB ${stockxAwb}` : "";
                  const linkedLabel =
                    lineOk
                      ? matchType === "SYNC" || matchType === "STOCKX_SYNC_DECATHLON"
                        ? `Linked (sync)${
                            lineShipTracking && shippedQty > 0 ? ` · Mirakl ship ${lineShipTracking}` : ""
                          }${stxAwbExtra}`
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
                      className={`border rounded p-3 text-xs ${
                        lineFullyMiraklShipped
                          ? "border-emerald-600 bg-emerald-50/90 ring-1 ring-emerald-200"
                          : lineOk
                            ? "border-green-400 bg-green-50/40"
                            : ""
                      }`}
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
                            <span className="text-gray-400">
                              Qty {Number.isFinite(orderedQty) && orderedQty > 0 ? orderedQty : "—"} · Shipped{" "}
                              {shippedQty}/{Number.isFinite(orderedQty) && orderedQty > 0 ? orderedQty : "—"}
                              {remainingQty > 0 ? ` · Remaining ${remainingQty}` : ""}
                              {lineFullyMiraklShipped ? (
                                <span className="ml-1 text-emerald-700 font-semibold">· Fulfilled (parcel)</span>
                              ) : null}
                            </span>
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
                          {sellBrut != null ? (
                            <div className="text-gray-400 text-[10px]">
                              Sell Mirakl (ligne): CHF {sellBrut.toFixed(2)}
                            </div>
                          ) : null}
                          {payoutLine != null ? (
                            <div className="text-gray-800 font-medium">
                              Payout Decathlon: CHF {payoutLine.toFixed(2)}
                            </div>
                          ) : null}
                          {lineOk && lineMargin ? (
                            <div className="text-gray-700 font-medium">
                              Marge: CHF {lineMargin.margin.toFixed(2)}
                              {lineMargin.marginPercentOfLineAfter != null
                                ? ` · ${lineMargin.marginPercentOfLineAfter.toFixed(1)}% du payout`
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

      {splitModalOpen ? (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-4 py-3 flex justify-between items-center">
              <div>
                <div className="text-lg font-semibold">Split shipment</div>
                <div className="text-xs text-gray-500">
                  Select the quantities to ship now.
                </div>
              </div>
              <button
                onClick={() => {
                  setSplitModalOpen(false);
                  setSplitQuantities({});
                }}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4 space-y-3">
              {(selectedOrder?.lines ?? []).map((line: any) => {
                const ordered = Number(line.quantity ?? 0);
                const shipped = selectedShipmentSummary.lineTotals.get(line.id) ?? 0;
                const remaining = Math.max(ordered - shipped, 0);
                if (remaining <= 0) return null;
                const value = splitQuantities[line.id] ?? 0;
                return (
                  <div key={line.id} className="border rounded px-3 py-2 text-sm flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{buildLineTitle(line)}</div>
                      <div className="text-xs text-gray-500">
                        Remaining {remaining} / {ordered || "—"}
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={remaining}
                      step={1}
                      value={value}
                      onChange={(event) =>
                        updateSplitQuantity(line.id, Number(event.target.value), remaining)
                      }
                      className="w-20 px-2 py-1 border rounded text-sm text-right"
                    />
                  </div>
                );
              })}
              {(selectedOrder?.lines ?? []).every((line: any) => {
                const ordered = Number(line.quantity ?? 0);
                const shipped = selectedShipmentSummary.lineTotals.get(line.id) ?? 0;
                return Math.max(ordered - shipped, 0) <= 0;
              }) ? (
                <div className="text-sm text-gray-500">No remaining items to ship.</div>
              ) : null}
            </div>
            <div className="border-t px-4 py-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  setSplitModalOpen(false);
                  setSplitQuantities({});
                }}
                className="px-3 py-1.5 text-sm bg-gray-100 rounded"
              >
                Cancel
              </button>
              <button
                onClick={submitSplitShipment}
                disabled={splitSubmitting}
                className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded"
              >
                {splitSubmitting ? "Shipping..." : "Ship selected"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
        onClose={() =>
          setManualEntryModal({ isOpen: false, mode: "create", line: null, orderId: null, unitIndex: 0, initialData: {} })
        }
      />
    </div>
  );
}
