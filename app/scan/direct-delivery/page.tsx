"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type OrderLine = {
  id: string;
  productName?: string | null;
  description?: string | null;
  supplierPid?: string | null;
  size?: string | null;
  sizeRaw?: string | null;
  supplierSku?: string | null;
  styleSku?: string | null;
  gtin?: string | null;
  quantity: number;
  priceLineAmount?: number | null;
  lineNetAmount?: number | null;
  procurement?: {
    ok?: boolean;
    source?: string | null;
    stockxOrderNumber?: string | null;
    awb?: string | null;
    stockxEstimatedDelivery?: string | null;
  } | null;
};

type Shipment = {
  id: string;
  trackingNumber?: string | null;
  delrStatus?: string | null;
  delrSentAt?: string | null;
  deliveryNotePdfUrl?: string | null;
  shippingLabelPdfUrl?: string | null;
};

type OrderDetail = {
  id: string;
  galaxusOrderId: string;
  orderNumber?: string | null;
  orderDate: string;
  recipientName?: string | null;
  recipientAddress1?: string | null;
  recipientAddress2?: string | null;
  recipientPostalCode?: string | null;
  recipientCity?: string | null;
  recipientCountryCode?: string | null;
  recipientCountry?: string | null;
  physicalDeliveryNoteRequired?: boolean;
  ordrSentAt?: string | null;
  ordrStatus?: string | null;
  cancelledAt?: string | null;
  currencyCode?: string;
  shipments?: Shipment[];
  lines?: OrderLine[];
};

const ORDERS_LIST_CACHE_TTL_MS = 30_000;
const ORDER_DETAIL_CACHE_TTL_MS = 30_000;

export default function LogisticsDirectDeliveryPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [labelBusy, setLabelBusy] = useState(false);
  const [opsLog, setOpsLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ordersListCacheRef = useRef<{ at: number; key: string; items: OrderListItem[] } | null>(null);
  const orderDetailCacheRef = useRef<Map<string, { at: number; order: OrderDetail }>>(new Map());
  const selectedOrderIdRef = useRef<string | null>(null);
  const detailLoadSeq = useRef(0);
  const [leftTab, setLeftTab] = useState<"to_process" | "fulfilled">("to_process");
  const [orderSearch, setOrderSearch] = useState("");
  const [debouncedOrderSearch, setDebouncedOrderSearch] = useState("");

  selectedOrderIdRef.current = selectedOrderId;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedOrderSearch(orderSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [orderSearch]);

  const loadOrders = useCallback(
    async (opts?: { selectFirstIfEmpty?: boolean; force?: boolean }) => {
      const force = Boolean(opts?.force);
      const query = debouncedOrderSearch;
      const cacheKey = query.toLowerCase();
      const cached = ordersListCacheRef.current;
      if (!force && cached && cached.key === cacheKey && Date.now() - cached.at < ORDERS_LIST_CACHE_TTL_MS) {
        setOrders(cached.items);
        const current = selectedOrderIdRef.current;
        if (opts?.selectFirstIfEmpty && !current && cached.items[0]?.id) {
          setSelectedOrderId(cached.items[0].id);
        }
        setLoadingOrders(false);
        return;
      }
      setLoadingOrders(true);
      setError(null);
      try {
        const buildUrl = (limit: number, offset: number) => {
          const params = new URLSearchParams({
            limit: String(limit),
            offset: String(offset),
            view: "active",
            sort: "orderDate",
            deliveryType: "direct_delivery",
            supplierScope: "stx",
            includeInvoice: "0",
            includeWarehouse: "0",
          });
          if (query) params.set("q", query);
          return `/api/galaxus/orders?${params.toString()}`;
        };
        const items: OrderListItem[] = [];
        const pageLimit = 200;
        const maxRows = 5000;
        let offset = 0;
        while (items.length < maxRows) {
          const res = await fetch(buildUrl(pageLimit, offset), { cache: "no-store" });
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
    },
    [debouncedOrderSearch]
  );

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
      const res = await fetch(
        `/api/galaxus/orders/${orderId}?view=minimal&ensureLocal=1&reserveStx=0&supplierScope=stx`,
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

  const orderFulfilled = useMemo(() => {
    const shipments = Array.isArray(selectedOrder?.shipments) ? selectedOrder!.shipments! : [];
    return shipments.some((shipment) => {
      const delrStatus = String(shipment?.delrStatus ?? "").toUpperCase();
      return Boolean(shipment?.delrSentAt) || delrStatus === "UPLOADED" || delrStatus === "SENT";
    });
  }, [selectedOrder]);

  const packingSlipUrl = useMemo(() => {
    const shipments = Array.isArray(selectedOrder?.shipments) ? selectedOrder!.shipments! : [];
    const withSlip = shipments.find(
      (shipment) => String(shipment?.deliveryNotePdfUrl ?? "").trim().length > 0
    );
    return withSlip?.deliveryNotePdfUrl ?? null;
  }, [selectedOrder]);

  const shippingLabelUrl = useMemo(() => {
    const shipments = Array.isArray(selectedOrder?.shipments) ? selectedOrder!.shipments! : [];
    const withLabel = shipments.find(
      (shipment) => String(shipment?.shippingLabelPdfUrl ?? "").trim().length > 0
    );
    return withLabel?.shippingLabelPdfUrl ?? null;
  }, [selectedOrder]);

  const buildLineTitle = (line: OrderLine) =>
    line.productName || line.description || line.supplierPid || "—";

  const ordersByTab = useMemo(() => {
    return orders.filter((order) => {
      const state = order.fulfillmentState ?? "to_process";
      if (leftTab === "fulfilled") return state === "fulfilled";
      return state === "to_process";
    });
  }, [orders, leftTab]);

  const needsLinking = (order: OrderListItem) => {
    const lines = order._count?.lines ?? 0;
    const linked = order.linkedCount ?? 0;
    return lines > 0 && linked < lines;
  };

  const isFullyLinked = (order: OrderListItem) => {
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
    return linkTone;
  };

  const printSwissPostLabel = async (opts?: { reprint?: boolean }) => {
    if (!selectedOrderId) return;
    const reprint = Boolean(opts?.reprint);
    setError(null);
    setOpsLog(null);
    setLabelBusy(true);
    try {
      const res = await fetch(`/api/galaxus/orders/${selectedOrderId}/direct-swiss-post-label`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ includeLabelData: true, allowReprint: reprint }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Swiss Post label failed");
      if (!reprint && data.status === "ALREADY_FULFILLED") {
        setError("Already fulfilled — use Reprint docs.");
        setOpsLog(JSON.stringify(data, null, 2));
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
        const bits: string[] = [];
        if (data.printJobResult?.ok) bits.push("Label → Brother");
        if (data.deliveryNotePrintResult?.ok) bits.push("Delivery note → HP");
        if (bits.length) window.alert(bits.join(" · "));
        if (data.printJobResult && !data.printJobResult.ok && !data.printJobResult.skipped) {
          setError(`Label print: ${data.printJobResult.error || data.printJobResult.message}`);
        }
      } else if (data?.url) {
        window.open(String(data.url), "_blank", "noopener,noreferrer");
        if (reprint && packingSlipUrl) {
          window.open(packingSlipUrl, "_blank", "noopener,noreferrer");
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLabelBusy(false);
    }
  };

  const lineStatusLabel = (line: OrderLine) => {
    const proc = line.procurement;
    const procOk = Boolean(proc?.ok);
    if (!procOk) return "Not linked to StockX";
    if (proc?.source === "stx_sync") return `Linked (sync)${proc?.awb ? ` · AWB ${proc.awb}` : ""}`;
    if (proc?.stockxOrderNumber) return `Linked ${proc.stockxOrderNumber}`;
    return "Linked";
  };

  const packingSlipRequired = Boolean(selectedOrder?.physicalDeliveryNoteRequired);

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Direct delivery — StockX</h1>
          <p className="text-sm text-gray-500">
            Galaxus orders shipped by StockX. Fulfill and print Swiss Post label.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/scan" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Scan
          </a>
          <button
            type="button"
            onClick={() => void loadOrders({ force: true })}
            disabled={loadingOrders}
            className="px-3 py-2 bg-white border border-gray-300 rounded text-sm disabled:opacity-50"
          >
            {loadingOrders ? "Refreshing…" : "Refresh list"}
          </button>
        </div>
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border rounded p-3">
          <div className="font-semibold mb-2">Orders (STX only)</div>
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
                  <div className="font-medium">
                    {order.orderNumber ?? order.galaxusOrderId}
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

          {!selectedOrderId ? (
            <div className="text-sm text-gray-500">Select an order.</div>
          ) : !selectedOrder && loadingOrder ? (
            <div className="text-sm text-gray-500">Loading order…</div>
          ) : selectedOrder ? (
            <div className="space-y-3">
              {packingSlipRequired ? (
                <div className="rounded border-2 border-amber-500 bg-amber-50 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-amber-900">
                    Packing slip REQUIRED — must be included in parcel.
                  </div>
                  {packingSlipUrl ? (
                    <a
                      href={packingSlipUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-medium"
                    >
                      Download packing slip
                    </a>
                  ) : (
                    <span className="text-xs text-amber-800">
                      Not generated yet — will appear after label print.
                    </span>
                  )}
                </div>
              ) : (
                <div className="rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
                  No packing slip required.
                </div>
              )}

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
                    onClick={() => void printSwissPostLabel({ reprint: false })}
                    disabled={orderFulfilled || labelBusy}
                    className="px-3 py-2 bg-indigo-700 text-white rounded text-sm font-medium disabled:opacity-50"
                  >
                    {labelBusy && !orderFulfilled
                      ? "Printing…"
                      : orderFulfilled
                        ? "Fulfilled"
                        : "Print Swiss Post label"}
                  </button>
                  {(orderFulfilled || shippingLabelUrl || packingSlipUrl) && (
                    <button
                      type="button"
                      onClick={() => void printSwissPostLabel({ reprint: true })}
                      disabled={labelBusy}
                      className="px-3 py-2 bg-amber-700 text-white rounded text-sm font-medium disabled:opacity-50"
                      title="Reprint Swiss Post label + delivery note if present"
                    >
                      {labelBusy ? "Reprint…" : "Reprint docs"}
                    </button>
                  )}
                  {shippingLabelUrl ? (
                    <a
                      href={shippingLabelUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 bg-gray-800 text-white rounded text-sm"
                    >
                      Label PDF
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                {(selectedOrder.lines || []).map((line) => {
                  const procOk = Boolean(line.procurement?.ok);
                  const priceRaw = line.priceLineAmount ?? line.lineNetAmount ?? null;
                  const priceNumber = typeof priceRaw === "number" ? priceRaw : Number(priceRaw);
                  const priceText = Number.isFinite(priceNumber)
                    ? `CHF ${priceNumber.toFixed(2)}`
                    : "—";
                  const etaRaw = line.procurement?.stockxEstimatedDelivery ?? null;
                  return (
                    <div
                      key={line.id}
                      className={`border rounded p-3 text-xs ${
                        procOk ? "border-green-400 bg-green-50/20" : "border-red-300 bg-red-50/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="font-medium text-sm text-gray-900 flex items-center gap-1.5 flex-wrap">
                            {procOk ? (
                              <span className="text-green-600">✓</span>
                            ) : (
                              <span className="text-red-600">✗</span>
                            )}
                            {buildLineTitle(line)}
                          </div>
                          <div className="text-gray-500">
                            Size {line.size ?? line.sizeRaw ?? "—"} ·{" "}
                            {line.styleSku ?? line.supplierSku ?? "—"} · Qty {line.quantity} ·{" "}
                            {priceText}
                          </div>
                          <div className="text-[11px] text-gray-500">
                            GTIN:{" "}
                            <span className="font-mono text-[10px]">
                              {String(line.gtin ?? "").trim() || "—"}
                            </span>
                            {" · "}
                            SupplierPID:{" "}
                            <span className="font-mono text-[10px]">
                              {String(line.supplierPid ?? "").trim() || "—"}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0 space-y-0.5">
                          <div
                            className={`font-medium ${procOk ? "text-green-700" : "text-red-700"}`}
                          >
                            {lineStatusLabel(line)}
                          </div>
                          <div className="text-gray-500">
                            ETA: {etaRaw ? new Date(etaRaw).toLocaleDateString("fr-CH") : "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {(selectedOrder.lines ?? []).length === 0 ? (
                  <div className="text-xs text-gray-500">No STX lines on this order.</div>
                ) : null}
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
    </div>
  );
}
