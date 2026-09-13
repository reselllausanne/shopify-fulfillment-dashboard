"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GalaxusManualEntryModal from "@/app/components/GalaxusManualEntryModal";
import { PhysicalStockBadge, PhysicalStockHintText } from "@/app/components/PhysicalStockBadge";
import { StockxOrderTools } from "@/app/galaxus/_components/StockxOrderTools";
import GalaxusExternalBuyPanel, {
  isExternalBuyLine,
} from "@/app/galaxus/_components/GalaxusExternalBuyPanel";
import { runPurgeGalaxusOrderFromDbUi } from "@/galaxus/_lib/purgeGalaxusOrderClient";

type OrderListItem = {
  id: string;
  galaxusOrderId: string;
  orderNumber?: string | null;
  orderDate: string;
  shippedCount?: number;
  fulfilledCount?: number;
  linkedCount?: number;
  /** STX/external lines still missing a buy — drives red card (not total line count). */
  needsBuyCount?: number;
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
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [opsLog, setOpsLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const knownOrderIds = useRef<Set<string>>(new Set());
  const ordersListCacheRef = useRef<{ at: number; key: string; items: OrderListItem[] } | null>(null);
  const orderDetailCacheRef = useRef<Map<string, { at: number; order: any }>>(new Map());
  const selectedOrderIdRef = useRef<string | null>(null);
  const detailLoadSeq = useRef(0);
  const ordersLoadSeq = useRef(0);
  const [polling, setPolling] = useState(false);
  const [bulkStockxSyncing, setBulkStockxSyncing] = useState(false);
  const [sendingOrdr, setSendingOrdr] = useState(false);
  const [reprintBusy, setReprintBusy] = useState(false);
  const [partialShipBusyLineId, setPartialShipBusyLineId] = useState<string | null>(null);
  const [partialPackageBusy, setPartialPackageBusy] = useState(false);
  const [reopenBusy, setReopenBusy] = useState(false);
  const [partialQtyByLineId, setPartialQtyByLineId] = useState<Record<string, string>>({});
  const [partialSelectedLineIds, setPartialSelectedLineIds] = useState<Record<string, boolean>>({});
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
    const seq = ++ordersLoadSeq.current;
    const force = Boolean(opts?.force);
    const query = debouncedOrderSearch;
    const fulfillmentState = leftTab === "fulfilled" ? "fulfilled" : "to_process";
    const cacheKey = `${fulfillmentState}::${query.toLowerCase()}`;
    const cached = ordersListCacheRef.current;
    if (!force && cached && cached.key === cacheKey && Date.now() - cached.at < ORDERS_LIST_CACHE_TTL_MS) {
      const items = cached.items;
      setOrders(items);
      const current = selectedOrderIdRef.current;
      if (opts?.selectFirstIfEmpty && !current && items[0]?.id) {
        setSelectedOrderId(items[0].id);
      }
      setLoadingOrders(false);
      setLoadingMoreOrders(false);
      return;
    }
    setLoadingOrders(true);
    setLoadingMoreOrders(false);
    setError(null);
    try {
      const buildUrl = (limit: number, offset: number) => {
        const params = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
          view: "active",
          sort: "orderDate",
          deliveryType: "direct_delivery",
          includeInvoice: "0",
          includeWarehouse: "0",
          fulfillmentState,
        });
        if (query) params.set("q", query);
        return `/api/galaxus/orders?${params.toString()}`;
      };
      const fetchPage = async (limit: number, offset: number) => {
        const res = await fetch(buildUrl(limit, offset), { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load orders");
        return {
          items: (Array.isArray(data.items) ? data.items : []) as OrderListItem[],
          nextOffset: Number.isFinite(Number(data.nextOffset)) ? Number(data.nextOffset) : null,
        };
      };

      const firstPage = await fetchPage(120, 0);
      if (seq !== ordersLoadSeq.current) return;

      let items = firstPage.items;
      setOrders(items);
      setLoadingOrders(false);

      const current = selectedOrderIdRef.current;
      if (opts?.selectFirstIfEmpty && !current && items[0]?.id) {
        setSelectedOrderId(items[0].id);
      }

      let offset = firstPage.nextOffset;
      if (offset != null) {
        setLoadingMoreOrders(true);
        while (offset != null) {
          const page = await fetchPage(200, offset);
          if (seq !== ordersLoadSeq.current) return;
          items = [...items, ...page.items];
          setOrders(items);
          offset = page.nextOffset;
        }
        setLoadingMoreOrders(false);
      }

      const fresh = new Set<string>();
      for (const item of items) {
        if (!knownOrderIds.current.has(item.id)) fresh.add(item.id);
      }
      setNewOrderIds(fresh.size > 0 ? fresh : new Set());
      knownOrderIds.current = new Set(items.map((item) => item.id));
      ordersListCacheRef.current = { at: Date.now(), items, key: cacheKey };
    } catch (err: any) {
      if (seq !== ordersLoadSeq.current) return;
      setError(err.message);
    } finally {
      if (seq === ordersLoadSeq.current) {
        setLoadingOrders(false);
        setLoadingMoreOrders(false);
      }
    }
  }, [debouncedOrderSearch, leftTab]);

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

  const openDirectLineCount = useMemo(() => {
    return (selectedOrder?.lines ?? []).filter(
      (line: any) => Math.max(0, Number(line?.remaining ?? line?.quantity ?? 0)) > 0
    ).length;
  }, [selectedOrder?.lines]);

  const orderFulfilled = useMemo(() => {
    const lines = Array.isArray(selectedOrder?.lines) ? selectedOrder.lines : [];
    if (lines.length === 0) return false;
    return lines.every((line: any) => Math.max(0, Number(line?.remaining ?? 0)) <= 0);
  }, [selectedOrder?.lines]);

  const multiLineDirectOrder = (selectedOrder?.lines?.length ?? 0) > 1;
  const hasMultiQtyLine = (selectedOrder?.lines ?? []).some(
    (line: any) => Math.max(1, Math.round(Number(line?.quantity ?? 1))) > 1
  );
  const needsPartialShipFlow =
    openDirectLineCount > 0 && (multiLineDirectOrder || hasMultiQtyLine);

  const packingSlipUrl = useMemo(() => {
    const shipments = Array.isArray(selectedOrder?.shipments) ? selectedOrder.shipments : [];
    const withSlip = shipments.find(
      (shipment: any) => String(shipment?.deliveryNotePdfUrl ?? "").trim().length > 0
    );
    return withSlip?.deliveryNotePdfUrl ?? null;
  }, [selectedOrder]);

  const shippingLabelUrl = useMemo(() => {
    const shipments = Array.isArray(selectedOrder?.shipments) ? selectedOrder.shipments : [];
    const withLabel = shipments.find(
      (shipment: any) => String(shipment?.shippingLabelPdfUrl ?? "").trim().length > 0
    );
    return withLabel?.shippingLabelPdfUrl ?? null;
  }, [selectedOrder]);

  const buildLineTitle = (line: any) =>
    line.productName || line.description || line.supplierPid || "—";

  const directLineRemaining = (line: any) =>
    Math.max(0, Number(line?.remaining ?? line?.quantity ?? 0));

  const directLineShipped = (line: any) => Math.max(0, Number(line?.shipped ?? 0));

  const directLineReserved = (line: any) => Math.max(0, Number(line?.reserved ?? 0));

  const findPendingDraftForLine = (line: any) => {
    const shipments = Array.isArray(selectedOrder?.shipments) ? selectedOrder.shipments : [];
    const pending = shipments.find((shipment: any) => {
      const status = String(shipment?.status ?? "").toUpperCase();
      const delrStatus = String(shipment?.delrStatus ?? "").toUpperCase();
      if (status !== "MANUAL") return false;
      if (shipment?.delrSentAt) return false;
      if (delrStatus === "UPLOADED" || delrStatus === "SENT") return false;
      if (String(shipment?.trackingNumber ?? "").trim()) return false;
      return true;
    });
    if (!pending?.id) return null;
    return {
      shipmentDbId: String(pending.id),
      quantity: directLineReserved(line),
    };
  };

  const labelPendingDraftForLine = useCallback(
    async (line: any) => {
      const orderId = selectedOrderId;
      const pendingDraft = findPendingDraftForLine(line);
      if (!orderId || !pendingDraft?.shipmentDbId) {
        setError("No unlabeled draft parcel found for this line.");
        return;
      }
      setPartialShipBusyLineId(String(line?.id ?? ""));
      setError(null);
      setOpsLog(null);
      try {
        const labelRes = await fetch(`/api/galaxus/orders/${orderId}/direct-swiss-post-label`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            includeLabelData: true,
            allowReprint: false,
            waitForEdi: true,
            shipmentId: pendingDraft.shipmentDbId,
          }),
        });
        const labelData = await labelRes.json().catch(() => ({}));
        if (!labelRes.ok || !labelData?.ok) {
          throw new Error(labelData?.error ?? "Swiss Post label failed");
        }
        setOpsLog(JSON.stringify({ mode: "label_pending_draft", ...labelData }, null, 2));
        const serverPrinted = labelData.browserPrintConfig?.enabled === false;
        if (serverPrinted) {
          const labelFail =
            labelData.printJobResult && !labelData.printJobResult.ok && !labelData.printJobResult.skipped;
          if (labelFail) {
            setError(`Label print: ${labelData.printJobResult.error || labelData.printJobResult.message || "failed"}`);
          }
        } else if (labelData?.url) {
          window.open(String(labelData.url), "_blank", "noopener,noreferrer");
        }
        await loadOrders({ force: true });
        await loadOrderDetail(orderId, { force: true });
      } catch (err: any) {
        setError(err?.message ?? "Label pending draft failed");
      } finally {
        setPartialShipBusyLineId(null);
      }
    },
    [selectedOrderId, selectedOrder?.shipments, loadOrders, loadOrderDetail]
  );

  type DirectUnitRow = {
    line: any;
    unitIndex: number;
    unitState: "shipped" | "reserved" | "open";
  };

  const buildDirectUnitRows = (line: any): DirectUnitRow[] => {
    const qty = Math.max(1, Math.round(Number(line?.quantity ?? 1)));
    const shipped = directLineShipped(line);
    const reserved = directLineReserved(line);
    if (qty <= 1) {
      const unitState: DirectUnitRow["unitState"] =
        directLineRemaining(line) <= 0 ? "shipped" : reserved > 0 ? "reserved" : "open";
      return [{ line, unitIndex: 0, unitState }];
    }
    const rows: DirectUnitRow[] = [];
    for (let unitIndex = 0; unitIndex < qty; unitIndex += 1) {
      const unitState: DirectUnitRow["unitState"] =
        unitIndex < shipped ? "shipped" : unitIndex < shipped + reserved ? "reserved" : "open";
      rows.push({ line, unitIndex, unitState });
    }
    return rows;
  };

  const resolveDirectLineProviderKey = (line: any) => {
    const fromField = String(line?.providerKey ?? line?.supplierKey ?? "").trim().toUpperCase();
    if (fromField) return fromField.split("_")[0] ?? fromField;
    const pid = String(line?.supplierPid ?? "").trim();
    return pid.split("_")[0]?.toUpperCase() || "UNKNOWN";
  };

  const runDirectPartialPackAndLabel = useCallback(
    async (params: {
      orderId: string;
      items: Array<{ lineId: string; quantity: number }>;
      replacePendingDraft?: boolean;
    }) => {
      const packRes = await fetch(`/api/galaxus/orders/${params.orderId}/shipments/pack`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmReplace: true,
          replacePendingDraft: Boolean(params.replacePendingDraft),
          packages: [{ items: params.items }],
        }),
      });
      const packData = await packRes.json().catch(() => ({}));
      if (!packRes.ok || !packData?.ok) {
        throw new Error(packData?.error ?? "Partial pack failed");
      }
      const shipmentId = Array.isArray(packData?.shipmentIds)
        ? String(packData.shipmentIds[0] ?? "").trim()
        : "";

      const labelRes = await fetch(`/api/galaxus/orders/${params.orderId}/direct-swiss-post-label`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          includeLabelData: true,
          allowReprint: false,
          waitForEdi: true,
          shipmentId: shipmentId || undefined,
        }),
      });
      const labelData = await labelRes.json().catch(() => ({}));
      if (!labelRes.ok || !labelData?.ok) {
        throw new Error(labelData?.error ?? "Swiss Post label failed");
      }

      const serverPrinted = labelData.browserPrintConfig?.enabled === false;
      if (serverPrinted) {
        const labelFail =
          labelData.printJobResult && !labelData.printJobResult.ok && !labelData.printJobResult.skipped;
        if (labelFail) {
          setError(`Label print: ${labelData.printJobResult.error || labelData.printJobResult.message || "failed"}`);
        }
      } else if (labelData?.url) {
        window.open(String(labelData.url), "_blank", "noopener,noreferrer");
      }

      return { packData, labelData, shipmentId };
    },
    []
  );

  const shipDirectPartialForLine = useCallback(
    async (line: any, qtyOverride?: number, options?: { replacePendingDraft?: boolean }) => {
      const orderId = selectedOrderId;
      const orderDbId = String(selectedOrder?.id ?? "").trim();
      const lineId = String(line?.id ?? "").trim();
      if (!orderId || !orderDbId || !lineId) return;

      const pendingDraft = findPendingDraftForLine(line);
      if (pendingDraft?.shipmentDbId && !options?.replacePendingDraft) {
        setError(
          `Unlabeled draft parcel (${pendingDraft.quantity} units) already packed. Label it first, or use Replace draft.`
        );
        return;
      }

      const maxQty = directLineRemaining(line);
      if (maxQty <= 0) {
        setError("No remaining quantity to ship on this line.");
        return;
      }
      const raw = qtyOverride != null ? String(qtyOverride) : partialQtyByLineId[lineId] ?? "1";
      const qty = Math.floor(Number(raw));
      if (!Number.isFinite(qty) || qty <= 0 || qty > maxQty) {
        setError(
          `Only ${maxQty} unit(s) left to pack (max ${maxQty}). Label the pending draft first if those units are already packed.`
        );
        return;
      }

      if (options?.replacePendingDraft && pendingDraft?.shipmentDbId) {
        const ok = window.confirm(
          `Replace unlabeled draft (${pendingDraft.quantity} units) and pack ${qty} instead?`
        );
        if (!ok) return;
      }

      setPartialShipBusyLineId(lineId);
      setError(null);
      setOpsLog(null);
      try {
        const result = await runDirectPartialPackAndLabel({
          orderId,
          items: [{ lineId, quantity: qty }],
          replacePendingDraft: Boolean(options?.replacePendingDraft),
        });
        setOpsLog(
          JSON.stringify(
            {
              mode: "direct_partial_ship",
              orderId,
              items: [{ lineId, quantity: qty }],
              pack: { created: result.packData?.created, shipmentIds: result.packData?.shipmentIds },
              label: {
                status: result.labelData?.status,
                trackingNumber: result.labelData?.trackingNumber,
                shipmentId: result.shipmentId,
              },
            },
            null,
            2
          )
        );
        setPartialSelectedLineIds({});
        await loadOrders({ force: true });
        await loadOrderDetail(orderId, { force: true });
      } catch (err: any) {
        setError(err?.message ?? "Direct partial ship failed");
      } finally {
        setPartialShipBusyLineId(null);
      }
    },
    [
      selectedOrderId,
      selectedOrder?.id,
      partialQtyByLineId,
      loadOrders,
      loadOrderDetail,
      runDirectPartialPackAndLabel,
    ]
  );

  const shipDirectPartialPackage = useCallback(async () => {
    const orderId = selectedOrderId;
    const orderDbId = String(selectedOrder?.id ?? "").trim();
    if (!orderId || !orderDbId) return;

    const openLines = (selectedOrder?.lines ?? []).filter((line: any) => directLineRemaining(line) > 0);
    const selectedLines = openLines.filter((line: any) => partialSelectedLineIds[String(line.id)]);

    setPartialPackageBusy(true);
    setError(null);
    setOpsLog(null);
    try {
      const items: Array<{ lineId: string; quantity: number; line: any }> = [];
      for (const line of selectedLines) {
        const lineId = String(line?.id ?? "").trim();
        if (!lineId) continue;
        const maxQty = directLineRemaining(line);
        const raw = partialQtyByLineId[lineId] ?? "1";
        const qty = Math.floor(Number(raw));
        if (!Number.isFinite(qty) || qty <= 0 || qty > maxQty) {
          throw new Error(`Invalid qty for line ${line?.lineNumber ?? "?"}. Allowed: 1..${maxQty}`);
        }
        items.push({ lineId, quantity: qty, line });
      }
      if (items.length === 0) {
        throw new Error("Select at least one open line to ship in this parcel.");
      }
      const providers = new Set(items.map(({ line }) => resolveDirectLineProviderKey(line)));
      if (providers.size > 1) {
        throw new Error(
          `Selected lines mix supplier channels (${Array.from(providers).join(", ")}). Ship STX and NER in separate parcels.`
        );
      }
      const gtins = new Set(
        items.map(({ line }) => String(line?.gtin ?? "").trim().replace(/\D/g, "")).filter(Boolean)
      );
      if (gtins.size > 1) {
        throw new Error(
          "Direct delivery: one product (GTIN) per parcel. Ship Kayano 39 and 39.5 separately — tick only one line."
        );
      }

      const result = await runDirectPartialPackAndLabel({
        orderId,
        items: items.map(({ lineId, quantity }) => ({ lineId, quantity })),
      });
      setOpsLog(
        JSON.stringify(
          {
            mode: "direct_partial_parcel",
            orderId,
            items: items.map(({ lineId, quantity }) => ({ lineId, quantity })),
            pack: { created: result.packData?.created, shipmentIds: result.packData?.shipmentIds },
            label: {
              status: result.labelData?.status,
              trackingNumber: result.labelData?.trackingNumber,
              shipmentId: result.shipmentId,
            },
          },
          null,
          2
        )
      );
      setPartialSelectedLineIds({});
      await loadOrders({ force: true });
      await loadOrderDetail(orderId, { force: true });
    } catch (err: any) {
      setError(err?.message ?? "Direct parcel ship failed");
    } finally {
      setPartialPackageBusy(false);
    }
  }, [
    selectedOrderId,
    selectedOrder,
    partialQtyByLineId,
    partialSelectedLineIds,
    loadOrders,
    loadOrderDetail,
    runDirectPartialPackAndLabel,
  ]);

  const orderedList = useMemo(() => {
    if (newOrderIds.size === 0) return orders;
    const fresh = orders.filter((o) => newOrderIds.has(o.id));
    const rest = orders.filter((o) => !newOrderIds.has(o.id));
    return [...fresh, ...rest];
  }, [orders, newOrderIds]);

  useEffect(() => {
    const lines: any[] = Array.isArray(selectedOrder?.lines) ? selectedOrder.lines : [];
    if (lines.length === 0) {
      setPartialQtyByLineId({});
      return;
    }
    const next: Record<string, string> = {};
    for (const line of lines) {
      const id = String(line?.id ?? "").trim();
      if (!id) continue;
      next[id] = partialQtyByLineId[id] ?? "1";
    }
    setPartialQtyByLineId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrder?.id]);

  const ordersByTab = orderedList;

  const runBulkStockxSyncVisible = async () => {
    const targets = ordersByTab;
    if (!targets.length) {
      setError("No visible orders to sync.");
      return;
    }
    setBulkStockxSyncing(true);
    setError(null);
    setOpsLog(null);
    try {
      const orderIds = targets
        .map((order) => String(order.id ?? "").trim())
        .filter(Boolean);
      const res = await fetch("/api/galaxus/orders/stx/bulk-sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderIds }),
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(String(data?.error ?? `Bulk sync failed (HTTP ${res.status})`));
      }
      setOpsLog(
        JSON.stringify(
          {
            ...data,
            tab: leftTab,
            requested: orderIds.length,
          },
          null,
          2
        )
      );
      await loadOrders({ force: true });
      if (selectedOrderIdRef.current) await loadOrderDetail(selectedOrderIdRef.current, { force: true });
    } catch (err: any) {
      setError(String(err?.message ?? "Bulk sync failed"));
    } finally {
      setBulkStockxSyncing(false);
    }
  };

  const needsLinking = (order: OrderListItem) => {
    if (typeof order.needsBuyCount === "number") return order.needsBuyCount > 0;
    const lines = order._count?.lines ?? 0;
    const linked = order.linkedCount ?? 0;
    return lines > 0 && linked < lines;
  };

  const isFullyLinked = (order: OrderListItem) => {
    if (typeof order.needsBuyCount === "number") {
      return order.needsBuyCount === 0 && (order.linkedCount ?? 0) > 0;
    }
    const lines = order._count?.lines ?? 0;
    const linked = order.linkedCount ?? 0;
    return lines > 0 && linked >= lines;
  };

  const orderListCardClass = (order: OrderListItem, selected: boolean) => {
    const linkTone = needsLinking(order)
      ? "border-red-500 bg-red-50"
      : isFullyLinked(order)
        ? "border-green-500 bg-green-50"
        : "border-gray-200 bg-white";
    if (selected) return `${linkTone} ring-2 ring-black`;
    if (order.hasPhysicalStock && isFullyLinked(order)) {
      return "border-green-600 bg-green-50";
    }
    if (newOrderIds.has(order.id) && !needsLinking(order) && !isFullyLinked(order)) {
      return "border-emerald-400 bg-emerald-50";
    }
    return linkTone;
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

  const voidPhantomShipmentAndReopen = async () => {
    if (!selectedOrderId) return;
    const ok = window.confirm(
      "Void local shipment + DELR rows for this order?\n\n" +
        "Use when Galaxus vendor portal still shows UNSHIPPED but our UI says closed.\n" +
        "Then ship partial qty with Ship qty."
    );
    if (!ok) return;
    setReopenBusy(true);
    setError(null);
    setOpsLog(null);
    try {
      const res = await fetch(
        `/api/galaxus/orders/${encodeURIComponent(selectedOrderId)}/shipments/reopen`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Void/reopen failed");
      setOpsLog(JSON.stringify(data, null, 2));
      setLeftTab("to_process");
      await loadOrders({ force: true });
      await loadOrderDetail(selectedOrderId, { force: true });
    } catch (err: any) {
      setError(err?.message ?? "Void/reopen failed");
    } finally {
      setReopenBusy(false);
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
        body: JSON.stringify({ includeLabelData: true, allowReprint: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Direct Swiss Post label failed");
      if (data.status === "ALREADY_FULFILLED") {
        setError("Order already fulfilled — use Reprint docs.");
        setOpsLog(JSON.stringify(data, null, 2));
        await loadOrderDetail(selectedOrderId, { force: true });
        return;
      }
      setOpsLog(JSON.stringify(data, null, 2));
      if (data.status === "CREATED" || data.status === "REPRINT") {
        setLeftTab("fulfilled");
      }
      await loadOrders({ force: true });
      if (selectedOrderId) await loadOrderDetail(selectedOrderId, { force: true });
      const serverPrinted = data.browserPrintConfig?.enabled === false;
      if (serverPrinted) {
        const labelFail = data.printJobResult && !data.printJobResult.ok && !data.printJobResult.skipped;
        if (labelFail) {
          setError(`Label print: ${data.printJobResult.error || data.printJobResult.message || "failed"}`);
        }
      } else if (data?.url) {
        window.open(String(data.url), "_blank", "noopener,noreferrer");
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const reprintDirectDocuments = async () => {
    if (!selectedOrderId) return;
    setReprintBusy(true);
    setError(null);
    setOpsLog(null);
    try {
      const res = await fetch(`/api/galaxus/orders/${selectedOrderId}/direct-swiss-post-label`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ includeLabelData: true, allowReprint: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Reprint failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrderDetail(selectedOrderId, { force: true });

      const serverPrinted = data.browserPrintConfig?.enabled === false;
      const notes: string[] = [];
      if (data.printJobResult?.ok) notes.push("Swiss Post label → Brother");
      else if (data.printJobResult && !data.printJobResult.skipped) {
        notes.push(`Label print fail: ${data.printJobResult.error || data.printJobResult.message}`);
      }
      if (data.deliveryNotePrintResult?.ok) notes.push("Delivery note → HP");
      else if (data.deliveryNotePrintResult && !data.deliveryNotePrintResult.skipped) {
        notes.push(
          `Delivery note fail: ${data.deliveryNotePrintResult.error || data.deliveryNotePrintResult.message}`
        );
      } else if (!data.deliveryNotePrintResult && packingSlipUrl) {
        notes.push("Delivery note on file — open Packing slip if HP skipped");
      } else if (!packingSlipUrl && !selectedOrder?.physicalDeliveryNoteRequired) {
        notes.push("No delivery note required");
      }

      if (serverPrinted) {
        window.alert(
          notes.length
            ? `Reprint ${selectedOrder?.galaxusOrderId ?? ""}\n${notes.join("\n")}`
            : "Reprint queued (check printers)."
        );
      } else if (data?.url) {
        window.open(String(data.url), "_blank", "noopener,noreferrer");
        if (packingSlipUrl && selectedOrder?.physicalDeliveryNoteRequired) {
          window.open(packingSlipUrl, "_blank", "noopener,noreferrer");
        }
      } else {
        window.alert(notes.join("\n") || "Reprint done.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReprintBusy(false);
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

  const lineNeedsManualTracking = (line: any, match: any, proc: any, procOk: boolean) => {
    if (!procOk || line.physicalStock) return false;
    const hint = proc?.warehouseStockHint;
    if (hint === "GOLDEN" || hint === "MAISON" || hint === "NER_STOCK") return false;
    const status = String(match?.stockxStatus ?? "").trim().toUpperCase();
    if (status === "LOCAL_STOCK" || status === "ESSENTIAL_STOCK") return false;
    const awb = String(match?.stockxAwb ?? proc?.awb ?? "").trim();
    if (awb) return false;
    const ref = String(match?.stockxOrderNumber ?? proc?.stockxOrderNumber ?? "").trim();
    if (/^LOCAL-/i.test(ref)) return false;
    return true;
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
    if (proc?.source === "external_buy") {
      return `Linked ${proc?.supplierKey ?? "EXT"} ${proc?.stockxOrderNumber ?? ""}`.trim();
    }
    if (proc?.source === "stx_sync") return `Linked (sync)${proc?.awb ? ` · AWB ${proc.awb}` : ""}`;
    if (match) {
      const base = `Linked ${match.stockxOrderNumber}`;
      if (lineNeedsManualTracking(line, match, proc, procOk)) {
        const goat = String(match.stockxStatus ?? "").toUpperCase() === "GOAT_VERIFY";
        return goat ? `${base} · GOAT verify — add AWB` : `${base} · add AWB`;
      }
      return base;
    }
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
            title="One shared StockX crawl for all visible orders (PENDING + recent all-state)"
          >
            {bulkStockxSyncing ? "Bulk sync…" : "Bulk StockX sync"}
          </button>
        </div>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {bulkStockxSyncing ? (
        <div className="text-xs text-gray-500">
          Shared StockX crawl + link across visible orders (not per-order)…
        </div>
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
                  className={`w-full text-left border rounded p-2 text-sm ${orderListCardClass(
                    order,
                    selected
                  )}`}
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
                  <div className="text-xs text-gray-600">
                    {new Date(order.orderDate).toLocaleDateString("fr-CH")} ·{" "}
                    <span
                      className={
                        needsLinking(order)
                          ? "font-semibold text-red-700"
                          : isFullyLinked(order)
                            ? "font-semibold text-green-700"
                            : "text-gray-500"
                      }
                    >
                      {order.linkedCount ?? 0}/{order._count?.lines ?? 0} linked
                    </span>
                    {order.hasPhysicalStock && order.physicalStockLabel ? (
                      <span className="block text-green-800 mt-0.5">{order.physicalStockLabel}</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
            {ordersByTab.length === 0 && !loadingOrders ? (
              <div className="text-xs text-gray-500">No orders in this tab.</div>
            ) : null}
            {loadingMoreOrders ? (
              <div className="text-xs text-gray-400 pt-1">Loading more orders…</div>
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
                  {orderFulfilled ? (
                    <span className="text-xs px-2 py-1.5 rounded bg-violet-100 text-violet-900">
                      Fulfilled
                    </span>
                  ) : needsPartialShipFlow ? (
                    <span
                      className="text-xs px-2 py-1.5 rounded bg-emerald-100 text-emerald-900"
                      title="Ship with Ship qty below — set quantity before label (e.g. 3 of 5)"
                    >
                      Partial ship only
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void generateDirectSwissPostLabel()}
                      className="px-2 py-1.5 bg-indigo-700 text-white rounded text-xs disabled:opacity-50"
                    >
                      Swiss Post label
                    </button>
                  )}
                  {!orderFulfilled && (selectedOrder?.shipments?.length ?? 0) > 0 ? (
                    <button
                      type="button"
                      onClick={() => void voidPhantomShipmentAndReopen()}
                      disabled={reopenBusy || loadingOrder}
                      className="px-2 py-1.5 bg-red-800 text-white rounded text-xs disabled:opacity-50"
                      title="Galaxus portal still unshipped? Clear phantom local DELR/shipment"
                    >
                      {reopenBusy ? "Voiding…" : "Void phantom ship"}
                    </button>
                  ) : null}
                  {orderFulfilled && (selectedOrder?.shipments?.length ?? 0) > 0 ? (
                    <button
                      type="button"
                      onClick={() => void voidPhantomShipmentAndReopen()}
                      disabled={reopenBusy || loadingOrder}
                      className="px-2 py-1.5 bg-red-800 text-white rounded text-xs disabled:opacity-50"
                      title="Reopen when Galaxus vendor portal still shows unshipped"
                    >
                      {reopenBusy ? "Voiding…" : "Void & reopen"}
                    </button>
                  ) : null}
                  {(orderFulfilled || shippingLabelUrl || packingSlipUrl) && (
                    <button
                      type="button"
                      onClick={() => void reprintDirectDocuments()}
                      disabled={reprintBusy || !selectedOrderId}
                      title="Reprint Swiss Post label (Brother) + delivery note (HP) if present"
                      className="px-2 py-1.5 bg-amber-700 text-white rounded text-xs disabled:opacity-50"
                    >
                      {reprintBusy ? "Reprint…" : "Reprint docs"}
                    </button>
                  )}
                  {packingSlipUrl && selectedOrder?.physicalDeliveryNoteRequired ? (
                    <a
                      href={packingSlipUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2 py-1.5 bg-amber-600 text-white rounded text-xs"
                    >
                      Packing slip PDF
                    </a>
                  ) : null}
                  {shippingLabelUrl ? (
                    <a
                      href={shippingLabelUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2 py-1.5 bg-gray-700 text-white rounded text-xs"
                    >
                      Label PDF
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
              <div className="text-[11px] text-gray-600">
                Partial fulfill: tick lines for one parcel, set qty, then{" "}
                <span className="font-medium">Ship parcel</span>. Or use{" "}
                <span className="font-medium">Ship qty</span> on a single line.
              </div>
              {(needsPartialShipFlow || hasMultiQtyLine) && openDirectLineCount > 0 ? (
                <div className="flex flex-wrap items-center gap-2 rounded border border-emerald-200 bg-emerald-50/60 px-2 py-2 text-[11px]">
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded border border-emerald-300 bg-white"
                    onClick={() => {
                      const next: Record<string, boolean> = {};
                      for (const line of selectedOrder?.lines ?? []) {
                        if (directLineRemaining(line) <= 0) continue;
                        next[String(line.id)] = true;
                      }
                      setPartialSelectedLineIds(next);
                    }}
                  >
                    Select all open
                  </button>
                  <button
                    type="button"
                    className="px-2 py-0.5 rounded border border-emerald-300 bg-white"
                    onClick={() => setPartialSelectedLineIds({})}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => void shipDirectPartialPackage()}
                    disabled={
                      partialPackageBusy ||
                      partialShipBusyLineId !== null ||
                      loadingOrder ||
                      !selectedOrderId ||
                      Object.values(partialSelectedLineIds).every((v) => !v)
                    }
                    className="px-2 py-1 rounded bg-emerald-800 text-white font-semibold disabled:opacity-50"
                  >
                    {partialPackageBusy
                      ? "Shipping parcel…"
                      : `Ship parcel (${Object.values(partialSelectedLineIds).filter(Boolean).length} line${
                          Object.values(partialSelectedLineIds).filter(Boolean).length === 1 ? "" : "s"
                        })`}
                  </button>
                </div>
              ) : null}

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
                            {lineNeedsManualTracking(line, match, proc, procOk) ? (
                              <span
                                className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-200 text-amber-950"
                                title="Linked buy has no tracking yet — paste AWB in Manual entry after GOAT/StockX ships"
                              >
                                {String(match?.stockxStatus ?? "").toUpperCase() === "GOAT_VERIFY"
                                  ? "GOAT → add AWB"
                                  : "Add AWB"}
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
                          <div className="text-gray-500">
                            Qty ordered {line.quantity ?? "—"}
                            {directLineShipped(line) > 0 ? ` · shipped ${directLineShipped(line)}` : ""}
                            {directLineReserved(line) > 0 ? ` · packed ${directLineReserved(line)}` : ""}
                            {directLineRemaining(line) !== Number(line.quantity ?? 0)
                              ? ` · remaining ${directLineRemaining(line)}`
                              : ""}
                          </div>
                          {Math.max(1, Math.round(Number(line?.quantity ?? 1))) > 1 ? (
                            <div className="mt-2 space-y-1 border-t border-gray-200 pt-2 text-left">
                              {buildDirectUnitRows(line).map(({ unitIndex, unitState }) => (
                                <div
                                  key={`${line.id}-unit-${unitIndex}`}
                                  className="flex items-center justify-between gap-2 text-[10px]"
                                >
                                  <span
                                    className={
                                      unitState === "shipped"
                                        ? "text-gray-400"
                                        : unitState === "reserved"
                                          ? "text-amber-700"
                                          : "text-emerald-800"
                                    }
                                  >
                                    Unit {unitIndex + 1}
                                    {unitState === "shipped"
                                      ? " · shipped"
                                      : unitState === "reserved"
                                        ? " · packed (label pending)"
                                        : " · to ship"}
                                  </span>
                                  {unitState === "reserved" ? (
                                    <button
                                      type="button"
                                      onClick={() => void labelPendingDraftForLine(line)}
                                      disabled={
                                        partialShipBusyLineId !== null ||
                                        partialPackageBusy ||
                                        loadingOrder ||
                                        !selectedOrderId
                                      }
                                      className="px-1.5 py-0.5 bg-amber-700 text-white rounded disabled:opacity-50"
                                    >
                                      Label draft
                                    </button>
                                  ) : unitState === "open" ? (
                                    <button
                                      type="button"
                                      onClick={() => void shipDirectPartialForLine(line, 1)}
                                      disabled={
                                        partialShipBusyLineId !== null ||
                                        partialPackageBusy ||
                                        loadingOrder ||
                                        !selectedOrderId
                                      }
                                      className="px-1.5 py-0.5 bg-emerald-700 text-white rounded disabled:opacity-50"
                                    >
                                      Ship 1
                                    </button>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {directLineRemaining(line) > 0 || findPendingDraftForLine(line) ? (
                          <div className="mt-1 flex items-center justify-end gap-1 flex-wrap">
                            {findPendingDraftForLine(line) ? (
                              <button
                                type="button"
                                onClick={() => void labelPendingDraftForLine(line)}
                                disabled={
                                  partialShipBusyLineId !== null ||
                                  partialPackageBusy ||
                                  loadingOrder ||
                                  !selectedOrderId
                                }
                                className="px-2 py-1 bg-amber-700 text-white rounded text-[11px] disabled:opacity-50"
                                title="Generate Swiss Post label for the packed draft parcel"
                              >
                                {partialShipBusyLineId === String(line.id)
                                  ? "Labeling…"
                                  : `Label draft (${findPendingDraftForLine(line)?.quantity ?? "?"})`}
                              </button>
                            ) : null}
                            {directLineRemaining(line) > 0 ? (
                              <>
                            <label className="inline-flex items-center gap-1 text-[10px] text-gray-600 mr-1">
                              <input
                                type="checkbox"
                                checked={Boolean(partialSelectedLineIds[String(line.id)])}
                                onChange={(e) =>
                                  setPartialSelectedLineIds((prev) => ({
                                    ...prev,
                                    [String(line.id)]: e.target.checked,
                                  }))
                                }
                              />
                              Parcel
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={Math.max(1, directLineRemaining(line))}
                              step={1}
                              value={partialQtyByLineId[String(line.id)] ?? "1"}
                              onChange={(e) =>
                                setPartialQtyByLineId((prev) => ({
                                  ...prev,
                                  [String(line.id)]: e.target.value,
                                }))
                              }
                              className="w-14 rounded border px-1 py-0.5 text-right text-[11px]"
                              title="Qty to ship now"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                void shipDirectPartialForLine(line, undefined, {
                                  replacePendingDraft: Boolean(findPendingDraftForLine(line)),
                                })
                              }
                              disabled={
                                partialShipBusyLineId !== null ||
                                partialPackageBusy ||
                                loadingOrder ||
                                !selectedOrderId
                              }
                              className="px-2 py-1 bg-emerald-700 text-white rounded text-[11px] disabled:opacity-50"
                              title={
                                findPendingDraftForLine(line)
                                  ? "Drop unlabeled draft and pack a new quantity"
                                  : isExternalBuyLine(line)
                                    ? "REI/WEL direct — set qty (e.g. 3 of 5) then Ship qty"
                                    : "Create partial shipment for this quantity and generate Swiss Post label"
                              }
                            >
                              {partialShipBusyLineId === String(line.id)
                                ? "Shipping…"
                                : findPendingDraftForLine(line)
                                  ? "Replace draft"
                                  : "Ship qty"}
                            </button>
                              </>
                            ) : null}
                          </div>
                          ) : (
                            <div className="mt-1 text-[11px] text-gray-500 text-right">Fully shipped</div>
                          )}
                          <button
                            type="button"
                            onClick={() => openManualEntry(line)}
                            disabled={
                              loadingOrder ||
                              !selectedOrder ||
                              String(selectedOrder?.id ?? "") !== String(selectedOrderId) ||
                              isExternalBuyLine(line)
                            }
                            className="mt-1 px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
                            title={
                              isExternalBuyLine(line)
                                ? "Use REI/WEL link panel below (not StockX)"
                                : undefined
                            }
                          >
                            Manual entry
                          </button>
                        </div>
                      </div>
                      {isExternalBuyLine(line) ? (
                        <GalaxusExternalBuyPanel
                          orderId={selectedOrderId}
                          line={line}
                          onSaved={async () => {
                            if (selectedOrderId) await loadOrderDetail(selectedOrderId, { force: true });
                            await loadOrders({ force: true });
                          }}
                        />
                      ) : null}
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
