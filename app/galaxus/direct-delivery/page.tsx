"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GalaxusManualEntryModal from "@/app/components/GalaxusManualEntryModal";
import { PhysicalStockBadge, PhysicalStockHintText } from "@/app/components/PhysicalStockBadge";
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
  hasPhysicalStock?: boolean;
  physicalStockLineCount?: number;
  physicalStockLabel?: string | null;
  _count?: { lines: number; shipments: number };
};

const ORDERS_LIST_CACHE_TTL_MS = 30_000;
const ORDER_DETAIL_CACHE_TTL_MS = 30_000;

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
  const ordersListCacheRef = useRef<{ at: number; key: string; items: OrderListItem[] } | null>(null);
  const orderDetailCacheRef = useRef<Map<string, { at: number; order: any }>>(new Map());
  const selectedOrderIdRef = useRef<string | null>(null);
  const detailLoadSeq = useRef(0);
  const [polling, setPolling] = useState(false);
  const [bulkStockxSyncing, setBulkStockxSyncing] = useState(false);
  const [sendingOrdr, setSendingOrdr] = useState(false);
  const [purgingOrder, setPurgingOrder] = useState(false);
  const [stockxToolsOpen, setStockxToolsOpen] = useState(false);
  const [leftTab, setLeftTab] = useState<"to_process" | "fulfilled">("to_process");
  const [orderSearch, setOrderSearch] = useState("");
  const [debouncedOrderSearch, setDebouncedOrderSearch] = useState("");
  const [manualEntryModal, setManualEntryModal] = useState<{
    isOpen: boolean;
    mode: "create" | "edit";
    line: any | null;
    orderId: string | null;
    unitIndex: number;
    initialData: any;
  }>({ isOpen: false, mode: "create", line: null, orderId: null, unitIndex: 0, initialData: {} });

  selectedOrderIdRef.current = selectedOrderId;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedOrderSearch(orderSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [orderSearch]);

  const loadOrders = useCallback(async (opts?: { selectFirstIfEmpty?: boolean; force?: boolean }) => {
    const force = Boolean(opts?.force);
    const query = debouncedOrderSearch;
    const cacheKey = query.toLowerCase();
    const cached = ordersListCacheRef.current;
    if (!force && cached && cached.key === cacheKey && Date.now() - cached.at < ORDERS_LIST_CACHE_TTL_MS) {
      const items = cached.items;
      setOrders(items);
      const current = selectedOrderIdRef.current;
      if (opts?.selectFirstIfEmpty && !current && items[0]?.id) {
        setSelectedOrderId(items[0].id);
      }
      setLoadingOrders(false);
      return;
    }
    setLoadingOrders(true);
    setError(null);
    try {
      const buildUrl = (limit: number, offset: number, view: "active" | "all") => {
        const params = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
          view,
          sort: "orderDate",
          deliveryType: "direct_delivery",
          includeInvoice: "0",
        });
        if (query) params.set("q", query);
        return `/api/galaxus/orders?${params.toString()}`;
      };
      const items: OrderListItem[] = [];
      const pageLimit = 200;
      const maxRows = 5000;
      let offset = 0;
      while (items.length < maxRows) {
        const res = await fetch(buildUrl(pageLimit, offset, "active"), { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load orders");
        const page: OrderListItem[] = Array.isArray(data.items) ? data.items : [];
        if (page.length === 0) break;
        items.push(...page);
        const nextOffset = Number(data.nextOffset ?? NaN);
        if (!Number.isFinite(nextOffset) || nextOffset <= offset) break;
        offset = nextOffset;
        if (page.length < pageLimit) break;
      }
      const fresh = new Set<string>();
      for (const item of items) {
        if (!knownOrderIds.current.has(item.id)) fresh.add(item.id);
      }
      setNewOrderIds(fresh.size > 0 ? fresh : new Set());
      knownOrderIds.current = new Set(items.map((item) => item.id));
      ordersListCacheRef.current = { at: Date.now(), items, key: cacheKey };
      setOrders(items);

      const current = selectedOrderIdRef.current;
      if (opts?.selectFirstIfEmpty && !current && items[0]?.id) {
        setSelectedOrderId(items[0].id);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingOrders(false);
    }
  }, [debouncedOrderSearch]);

  const loadOrderDetail = useCallback(async (orderId: string, opts?: { force?: boolean }) => {
    const force = Boolean(opts?.force);
    const cached = orderDetailCacheRef.current.get(orderId);
    if (!force && cached && Date.now() - cached.at < ORDER_DETAIL_CACHE_TTL_MS) {
      setSelectedOrder(cached.order);
      setLoadingOrder(false);
      return;
    }
    const seq = ++detailLoadSeq.current;
    setLoadingOrder(true);
    setError(null);
    try {
      // ensureLocal=1 so warehouse in-stock lane (Essentials/Bape/AP/boxers) auto-links
      const res = await fetch(
        `/api/galaxus/orders/${orderId}?view=minimal&ensureLocal=1&reserveStx=0`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (seq !== detailLoadSeq.current) return;
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load order");
      orderDetailCacheRef.current.set(orderId, { at: Date.now(), order: data.order });
      setSelectedOrder(data.order);
    } catch (err: any) {
      if (seq !== detailLoadSeq.current) return;
      setError(err.message);
    } finally {
      if (seq === detailLoadSeq.current) setLoadingOrder(false);
    }
  }, []);

  const ingestNewOrders = async () => {
    setPolling(true);
    setError(null);
    try {
      await fetch("/api/galaxus/edi/poll", { cache: "no-store" });
    } catch (err: any) {
      setError(err?.message ?? "Ingest failed");
    } finally {
      await loadOrders({ force: true });
      setPolling(false);
    }
  };

  useEffect(() => {
    void loadOrders({ selectFirstIfEmpty: true });
  }, [loadOrders]);

  useEffect(() => {
    if (!selectedOrderId) {
      setSelectedOrder(null);
      return;
    }
    void loadOrderDetail(selectedOrderId);
  }, [selectedOrderId, loadOrderDetail]);

  useEffect(() => {
    if (
      manualEntryModal.isOpen &&
      manualEntryModal.orderId &&
      selectedOrderId &&
      manualEntryModal.orderId !== selectedOrderId
    ) {
      setManualEntryModal({
        isOpen: false,
        mode: "create",
        line: null,
        orderId: null,
        unitIndex: 0,
        initialData: {},
      });
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

  const packingSlipUrl = useMemo(() => {
    const shipments = Array.isArray(selectedOrder?.shipments) ? selectedOrder.shipments : [];
    const withSlip = shipments.find(
      (shipment: any) => String(shipment?.deliveryNotePdfUrl ?? "").trim().length > 0
    );
    return withSlip?.deliveryNotePdfUrl ?? null;
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

  const runBulkStockxSyncVisible = async () => {
    const targets = ordersByTab;
    if (!targets.length) {
      setError("No visible orders to sync.");
      return;
    }
    setBulkStockxSyncing(true);
    setError(null);
    setOpsLog(null);
    let success = 0;
    let failed = 0;
    let skipped = 0;
    const failures: Array<{ orderId: string; error: string }> = [];
    try {
      for (const order of targets) {
        const orderId = String(order.id ?? "").trim();
        if (!orderId) {
          skipped += 1;
          continue;
        }
        try {
          const res = await fetch(`/api/galaxus/orders/${orderId}/stx/sync`, {
            method: "POST",
            cache: "no-store",
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data?.ok) {
            failed += 1;
            failures.push({
              orderId,
              error: String(data?.error ?? `HTTP ${res.status}`),
            });
          } else {
            success += 1;
          }
        } catch (err: any) {
          failed += 1;
          failures.push({
            orderId,
            error: String(err?.message ?? "Sync failed"),
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
      setOpsLog(
        JSON.stringify(
          {
            ok: failed === 0,
            mode: "galaxus_direct_bulk_stockx_sync_visible",
            tab: leftTab,
            total: targets.length,
            success,
            failed,
            skipped,
            failures: failures.slice(0, 25),
          },
          null,
          2
        )
      );
      await loadOrders({ force: true });
      if (selectedOrderIdRef.current) await loadOrderDetail(selectedOrderIdRef.current, { force: true });
    } finally {
      setBulkStockxSyncing(false);
    }
  };

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
      await loadOrderDetail(selectedOrderId, { force: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSendingOrdr(false);
    }
  };

  const generateDirectSwissPostLabel = async () => {
    if (!selectedOrderId) return;
    setError(null);
    setOpsLog(null);
    try {
      const res = await fetch(`/api/galaxus/orders/${selectedOrderId}/direct-swiss-post-label`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ includeLabelData: true, allowReprint: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Direct Swiss Post label failed");
      setOpsLog(JSON.stringify(data, null, 2));
      if (data.status === "CREATED" || data.status === "REPRINT" || data.status === "ALREADY_FULFILLED") {
        setLeftTab("fulfilled");
      }
      await loadOrders({ force: true });
      if (selectedOrderId) await loadOrderDetail(selectedOrderId, { force: true });
      if (data?.url) {
        window.open(String(data.url), "_blank", "noopener,noreferrer");
      }
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
    const proc = line.procurement;
    const priceRaw = line.priceLineAmount ?? line.lineNetAmount ?? null;
    const priceNumber = typeof priceRaw === "number" ? priceRaw : Number(priceRaw);
    const unitsList: any[] = proc?.units ?? [];
    const totalUnitCost = unitsList
      .filter((u: any) => u.linked && u.stockxAmount != null)
      .reduce((sum: number, u: any) => sum + Number(u.stockxAmount), 0);
    const savedCost =
      match?.stockxAmount != null
        ? Number(match.stockxAmount)
        : totalUnitCost > 0
          ? totalUnitCost
          : proc?.stockxCostChf != null
            ? Number(proc.stockxCostChf)
            : null;
    const resolvedCost = Number.isFinite(savedCost as number) ? (savedCost as number) : null;
    const marginAmount =
      Number.isFinite(priceNumber) && resolvedCost != null ? priceNumber - resolvedCost : null;
    const marginPercent =
      Number.isFinite(priceNumber) && priceNumber > 0 && resolvedCost != null
        ? ((priceNumber - resolvedCost) / priceNumber) * 100
        : null;
    const title = buildLineTitle(line);
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
      stockxOrderNumber: match?.stockxOrderNumber ?? proc?.stockxOrderNumber ?? "",
      stockxChainId: String(line.supplierPid ?? "").trim(),
      stockxOrderId: match?.stockxOrderId ?? proc?.stockxOrderId ?? "",
      stockxProductName: match?.stockxProductName ?? "",
      stockxSizeEU: match?.stockxSizeEU ?? "",
      stockxSkuKey: match?.stockxSkuKey ?? "",
      stockxPurchaseDate: match?.stockxPurchaseDate ?? null,
      stockxStatus: match?.stockxStatus ?? "MANUAL",
      stockxAwb: match?.stockxAwb ?? proc?.awb ?? "",
      stockxTrackingUrl: match?.stockxTrackingUrl ?? "",
      stockxEstimatedDelivery:
        match?.stockxEstimatedDelivery ?? proc?.stockxEstimatedDelivery ?? null,
      stockxLatestEstimatedDelivery:
        match?.stockxLatestEstimatedDelivery ?? proc?.stockxLatestEstimatedDelivery ?? null,
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
        await loadOrders({ selectFirstIfEmpty: true, force: true });
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
      const enrich = json.stockxEnrich;
      if (enrich?.attempted && !enrich.ok) {
        setOpsLog(
          `Saved link, but StockX auto-fill failed (${enrich.reason ?? "unknown"}).\n` +
            JSON.stringify(json, null, 2)
        );
      } else {
        setOpsLog(JSON.stringify(json, null, 2));
      }
      setManualEntryModal({
        isOpen: false,
        mode: "create",
        line: null,
        orderId: null,
        unitIndex: 0,
        initialData: {},
      });
      await loadOrderDetail(orderId, { force: true });
      await loadOrders({ force: true });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const lineStatusLabel = (line: any, match: any, proc: any, procOk: boolean) => {
    if (!procOk) return "Not linked";
    if (proc?.warehouseStockHint === "GOLDEN") {
      if (proc?.buySourceOverride) {
        return `BUY GLD${
          proc.buySourceOverride.buyPriceChf != null
            ? ` @ CHF ${Number(proc.buySourceOverride.buyPriceChf).toFixed(2)}`
            : ""
        }`;
      }
      return "GLD/Golden — no StockX";
    }
    if (proc?.warehouseStockHint === "MAISON") return "THE_ your stock";
    if (proc?.warehouseStockHint === "NER_STOCK") return "NER_ partner stock";
    if (line.physicalStock) return "Warehouse stock";
    if (proc?.source === "stx_sync") return `Linked (sync)${proc?.awb ? ` · AWB ${proc.awb}` : ""}`;
    if (match) return `Linked ${match.stockxOrderNumber}`;
    return "Linked";
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Galaxus Direct Delivery</h1>
          <p className="text-sm text-gray-500">StockX link · Swiss Post · warehouse pairs</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/galaxus" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Ops
          </a>
          <a href="/galaxus/warehouse-shipments" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Warehouse
          </a>
          <button
            type="button"
            onClick={() => void loadOrders({ force: true })}
            disabled={loadingOrders || polling || bulkStockxSyncing}
            className="px-3 py-2 bg-white border border-gray-300 rounded text-sm disabled:opacity-50"
          >
            {loadingOrders ? "Refreshing…" : "Refresh list"}
          </button>
          <button
            type="button"
            onClick={() => void ingestNewOrders()}
            disabled={loadingOrders || polling || bulkStockxSyncing}
            className="px-3 py-2 bg-gray-900 text-white rounded text-sm disabled:opacity-50"
          >
            {polling ? "Ingesting…" : "Ingest EDI"}
          </button>
          <button
            type="button"
            onClick={() => void runBulkStockxSyncVisible()}
            disabled={loadingOrders || polling || bulkStockxSyncing}
            className="px-3 py-2 bg-blue-700 text-white rounded text-sm disabled:opacity-50"
            title="StockX sync on visible tab (sequential)"
          >
            {bulkStockxSyncing ? "Bulk sync…" : "Bulk StockX sync"}
          </button>
        </div>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {bulkStockxSyncing ? (
        <div className="text-xs text-gray-500">Sequential StockX sync on visible orders…</div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border rounded p-3">
          <div className="font-semibold mb-2">Orders</div>
          <input
            className="w-full border rounded px-2 py-1 text-xs mb-2"
            placeholder="Search order, SKU, GTIN, product..."
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
          />
          <div className="mb-2 grid grid-cols-2 gap-1 text-xs">
            <button
              type="button"
              className={`rounded border px-2 py-1 ${
                leftTab === "to_process"
                  ? "bg-black text-white border-black"
                  : "bg-white border-gray-300"
              }`}
              onClick={() => setLeftTab("to_process")}
            >
              À traiter
            </button>
            <button
              type="button"
              className={`rounded border px-2 py-1 ${
                leftTab === "fulfilled"
                  ? "bg-black text-white border-black"
                  : "bg-white border-gray-300"
              }`}
              onClick={() => setLeftTab("fulfilled")}
            >
              Fulfilled
            </button>
          </div>
          <div className="space-y-2 max-h-[70vh] overflow-auto">
            {ordersByTab.map((order) => {
              const selected = selectedOrderId === order.id;
              return (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => setSelectedOrderId(order.id)}
                  className={`w-full text-left border rounded p-2 text-sm ${
                    selected
                      ? "border-black ring-1 ring-black"
                      : needsLinking(order)
                        ? "border-red-400 bg-red-50"
                        : order.hasPhysicalStock
                          ? "border-green-500 bg-green-50/60"
                          : newOrderIds.has(order.id)
                            ? "border-emerald-400 bg-emerald-50"
                            : "border-gray-200"
                  }`}
                >
                  <div className="font-medium flex items-center gap-1.5 flex-wrap">
                    <span>{order.orderNumber ?? order.galaxusOrderId}</span>
                    {order.hasPhysicalStock ? (
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-600 text-white"
                        title={order.physicalStockLabel ?? "Pair in warehouse stock"}
                      >
                        WH
                        {order.physicalStockLineCount && order.physicalStockLineCount > 1
                          ? ` ×${order.physicalStockLineCount}`
                          : ""}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(order.orderDate).toLocaleDateString("fr-CH")} ·{" "}
                    {order.linkedCount ?? 0}/{order._count?.lines ?? 0} linked
                    {order.hasPhysicalStock && order.physicalStockLabel ? (
                      <span className="block text-green-800 mt-0.5">{order.physicalStockLabel}</span>
                    ) : null}
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
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">Order detail</div>
            {loadingOrder ? <span className="text-xs text-gray-400">Loading…</span> : null}
          </div>

          <div className="rounded border border-amber-200 bg-amber-50/50">
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm font-medium text-gray-900"
              onClick={() => setStockxToolsOpen((v) => !v)}
            >
              StockX tools {stockxToolsOpen ? "▾" : "▸"}
            </button>
            {stockxToolsOpen ? (
              <div className="px-3 pb-3">
                <StockxOrderTools
                  orderId={selectedOrderId}
                  onAfterAction={async () => {
                    if (selectedOrderId) await loadOrderDetail(selectedOrderId, { force: true });
                    await loadOrders({ force: true });
                  }}
                />
              </div>
            ) : null}
          </div>

          {!selectedOrderId ? (
            <div className="text-sm text-gray-500">Select an order.</div>
          ) : !selectedOrder && loadingOrder ? (
            <div className="text-sm text-gray-500">Loading order…</div>
          ) : selectedOrder ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm min-w-0">
                  <div className="font-medium text-gray-900">
                    {selectedOrder.recipientName ?? "—"}
                  </div>
                  <div className="text-gray-500 text-xs">
                    {selectedOrder.recipientAddress1 ?? ""} {selectedOrder.recipientAddress2 ?? ""}
                  </div>
                  <div className="text-gray-500 text-xs">
                    {selectedOrder.recipientPostalCode ?? ""} {selectedOrder.recipientCity ?? ""}{" "}
                    {selectedOrder.recipientCountryCode ?? selectedOrder.recipientCountry ?? ""}
                  </div>
                  <div className="text-gray-600 mt-1">
                    {selectedOrder.galaxusOrderId} · {selectedOrder.orderNumber ?? "—"}
                  </div>
                  {selectedOrder.cancelledAt ? (
                    <span className="block text-xs text-red-600 mt-0.5">
                      Cancelled · {new Date(selectedOrder.cancelledAt).toLocaleString()}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
                    ORDR: {selectedOrder.ordrSentAt ? "SENT" : selectedOrder.ordrStatus ?? "PENDING"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void resendOrdr()}
                    disabled={sendingOrdr || !selectedOrderId}
                    className="px-2 py-1.5 bg-gray-900 text-white rounded text-xs disabled:opacity-50"
                  >
                    {sendingOrdr ? "ORDR…" : "Resend ORDR"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void generateDirectSwissPostLabel()}
                    disabled={orderFulfilled}
                    className="px-2 py-1.5 bg-indigo-700 text-white rounded text-xs disabled:opacity-50"
                  >
                    {orderFulfilled ? "Fulfilled" : "Swiss Post label"}
                  </button>
                  {selectedOrder?.physicalDeliveryNoteRequired && packingSlipUrl ? (
                    <a
                      href={packingSlipUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2 py-1.5 bg-amber-600 text-white rounded text-xs"
                    >
                      Packing slip
                    </a>
                  ) : null}
                  <button
                    type="button"
                    title="Permanently delete this order from the database."
                    className="text-xs px-2 py-1.5 rounded bg-red-950 text-white disabled:opacity-50"
                    onClick={purgeSelectedOrderFromDb}
                    disabled={purgingOrder || loadingOrder}
                  >
                    {purgingOrder ? "…" : "Remove"}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {(selectedOrder.lines || []).map((line: any) => {
                  const match = matchesByLine.get(line.id);
                  const proc = line.procurement;
                  const procOk = Boolean(proc?.ok || match || line.physicalStock);
                  const priceRaw = line.priceLineAmount ?? line.lineNetAmount ?? null;
                  const priceNumber = typeof priceRaw === "number" ? priceRaw : Number(priceRaw);
                  const priceText = Number.isFinite(priceNumber)
                    ? `CHF ${priceNumber.toFixed(2)}`
                    : "—";
                  const unitsList: any[] = proc?.units ?? [];
                  const totalUnitCost = unitsList
                    .filter((u: any) => u.linked && u.stockxAmount != null)
                    .reduce((sum: number, u: any) => sum + Number(u.stockxAmount), 0);
                  const costFromMatch =
                    match?.stockxAmount != null ? Number(match.stockxAmount) : NaN;
                  const cost = Number.isFinite(costFromMatch)
                    ? costFromMatch
                    : totalUnitCost > 0
                      ? totalUnitCost
                      : proc?.stockxCostChf != null && Number.isFinite(Number(proc.stockxCostChf))
                        ? Number(proc.stockxCostChf)
                        : NaN;
                  const hasMargin = Number.isFinite(priceNumber) && Number.isFinite(cost);
                  const margin = hasMargin ? priceNumber - cost : null;
                  const marginPct =
                    hasMargin && priceNumber > 0 ? ((priceNumber - cost) / priceNumber) * 100 : null;
                  const etaRaw =
                    match?.stockxEstimatedDelivery ?? proc?.stockxEstimatedDelivery ?? null;

                  return (
                    <div
                      key={line.id}
                      className={`border rounded p-3 text-xs ${
                        line.physicalStock
                          ? "border-green-500 bg-green-50/40"
                          : procOk
                            ? "border-green-400 bg-green-50/20"
                            : "border-gray-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="font-medium text-sm text-gray-900 flex items-center gap-1.5 flex-wrap">
                            {procOk ? (
                              <span className="text-green-600">✓</span>
                            ) : (
                              <span className="text-gray-300">○</span>
                            )}
                            {buildLineTitle(line)}
                            <PhysicalStockBadge
                              physicalStock={line.physicalStock}
                              avoidStockxHint={!procOk || Boolean(line.physicalStock)}
                            />
                            {proc?.warehouseStockHint === "MAISON" ? (
                              <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-violet-100 text-violet-900">
                                THE_
                              </span>
                            ) : null}
                            {proc?.warehouseStockHint === "NER_STOCK" ? (
                              <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-amber-100 text-amber-950">
                                NER_
                              </span>
                            ) : null}
                            {proc?.warehouseStockHint === "GOLDEN" ? (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-200 text-orange-950">
                                GLD
                              </span>
                            ) : null}
                          </div>
                          <PhysicalStockHintText
                            physicalStock={line.physicalStock}
                            avoidStockxHint={Boolean(line.physicalStock)}
                          />
                          <div className="text-gray-500">
                            Size {line.size ?? line.sizeRaw ?? "—"} ·{" "}
                            {line.styleSku ?? line.supplierSku ?? "—"} · Qty {line.quantity} ·{" "}
                            {priceText}
                          </div>
                          <div className="text-[11px] text-gray-500">
                            Key:{" "}
                            <span className="font-mono text-[10px]">
                              {String(line.productKey ?? line.providerKey ?? "").trim() ||
                                String(line.supplierKey ?? "").trim() ||
                                "—"}
                            </span>
                            {" · "}
                            GTIN:{" "}
                            <span className="font-mono text-[10px]">
                              {String(line.gtin ?? "").trim() || "—"}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0 space-y-0.5">
                          <div
                            className={`font-medium ${procOk ? "text-green-700" : "text-red-600"}`}
                          >
                            {lineStatusLabel(line, match, proc, procOk)}
                          </div>
                          <div className="text-gray-500">
                            ETA: {etaRaw ? new Date(etaRaw).toLocaleDateString("fr-CH") : "—"}
                          </div>
                          <div className="text-gray-500">
                            Cost: {Number.isFinite(cost) ? `CHF ${cost.toFixed(2)}` : "—"}
                          </div>
                          <div className="text-gray-500">
                            Margin: {margin != null ? `CHF ${margin.toFixed(2)}` : "—"}
                            {marginPct != null ? ` (${marginPct.toFixed(1)}%)` : ""}
                          </div>
                          <button
                            type="button"
                            onClick={() => openManualEntry(line)}
                            disabled={
                              loadingOrder ||
                              !selectedOrder ||
                              String(selectedOrder?.id ?? "") !== String(selectedOrderId)
                            }
                            className="mt-1 px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
                          >
                            Manual entry
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">Could not load order.</div>
          )}
        </div>
      </div>

      {opsLog ? (
        <pre className="text-xs bg-gray-50 border rounded p-3 whitespace-pre-wrap max-h-48 overflow-auto">
          {opsLog}
        </pre>
      ) : null}
      <GalaxusManualEntryModal
        isOpen={manualEntryModal.isOpen}
        mode={manualEntryModal.mode}
        initialData={manualEntryModal.initialData}
        stockxLookupOrderId={manualEntryModal.orderId ?? selectedOrderId ?? null}
        shopifyItem={{
          orderName: manualEntryModal.initialData?.shopifyOrderName ?? "",
          title: manualEntryModal.initialData?.shopifyProductTitle ?? "",
          sku: manualEntryModal.initialData?.shopifySku ?? "",
          sizeEU: manualEntryModal.initialData?.shopifySizeEU ?? "",
          createdAt: manualEntryModal.initialData?.shopifyCreatedAt ?? null,
        }}
        onSave={(data) => saveManualEntry(data)}
        onClose={() =>
          setManualEntryModal({
            isOpen: false,
            mode: "create",
            line: null,
            orderId: null,
            unitIndex: 0,
            initialData: {},
          })
        }
      />
    </div>
  );
}
