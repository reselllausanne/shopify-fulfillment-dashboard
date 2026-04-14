"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GalaxusManualEntryModal from "@/app/components/GalaxusManualEntryModal";
import { StockxOrderTools } from "@/app/galaxus/_components/StockxOrderTools";
import { runPurgeGalaxusOrderFromDbUi } from "@/galaxus/_lib/purgeGalaxusOrderClient";
import { galaxusLineNetRevenueChf, galaxusProfitFromRevenueAndStockxCost } from "@/galaxus/orders/margin";

type OrderListItem = {
  id: string;
  galaxusOrderId: string;
  orderDate: string;
  deliveryType: string | null;
  shippedCount: number;
  fulfilledCount: number;
  _count?: { shipments: number; lines: number };
};

type OrderDetail = {
  id: string;
  galaxusOrderId: string;
  orderDate: string;
  orderNumber?: string | null;
  deliveryType: string | null;
  currencyCode?: string | null;
  ordrSentAt?: string | null;
  cancelledAt?: string | null;
  recipientName?: string | null;
  recipientAddress1?: string | null;
  recipientAddress2?: string | null;
  recipientPostalCode?: string | null;
  recipientCity?: string | null;
  recipientCountry?: string | null;
  recipientCountryCode?: string | null;
  lines: any[];
  stockxMatches?: any[];
};

export default function WarehouseBulkPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoOrdrAttempted = useRef<Set<string>>(new Set());
  const [manualEntryModal, setManualEntryModal] = useState<{
    isOpen: boolean;
    mode: "create" | "edit";
    line: any | null;
    orderId: string | null;
    unitIndex: number;
    initialData: any;
  }>({ isOpen: false, mode: "create", line: null, orderId: null, unitIndex: 0, initialData: {} });

  const selected = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  const matchesByLine = useMemo(() => {
    const map = new Map<string, any>();
    (detail?.stockxMatches || []).forEach((m: any) => {
      if (m?.galaxusOrderLineId) map.set(m.galaxusOrderLineId, m);
    });
    return map;
  }, [detail]);

  const buildLineTitle = (line: any) =>
    line.productName || line.description || line.supplierPid || "—";

  const loadOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/galaxus/orders?view=active&limit=100", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Failed to load orders");
      const items = Array.isArray(data.items)
        ? data.items.filter((item: any) => String(item?.deliveryType ?? "").toLowerCase() !== "direct_delivery")
        : [];
      setOrders(items);
      if (!selectedOrderId && items[0]?.id) {
        setSelectedOrderId(items[0].id);
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to load orders");
    } finally {
      setLoading(false);
    }
  };

  const ingestNewOrders = async () => {
    setBusy("ingest");
    setError(null);
    try {
      await fetch("/api/galaxus/edi/poll", { cache: "no-store" });
      await loadOrders();
      if (selectedOrderId) await loadDetail(selectedOrderId);
    } catch (err: any) {
      setError(err?.message ?? "Ingest failed");
    } finally {
      setBusy(null);
    }
  };

  const loadDetail = async (orderId: string) => {
    if (!orderId) {
      setDetail(null);
      return;
    }
    setBusy("detail");
    setError(null);
    try {
      const res = await fetch(`/api/galaxus/orders/${orderId}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Failed to load order detail");
      setDetail(data.order ?? null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load order detail");
    } finally {
      setBusy(null);
    }
  };

  const sendOrdrIfNeeded = async (orderId: string, order: OrderDetail | null) => {
    if (!orderId || !order) return;
    if (!Array.isArray(order.lines) || order.lines.length === 0) return;
    if (order.cancelledAt) return;
    if (order.ordrSentAt) return;
    if (autoOrdrAttempted.current.has(orderId)) return;
    if (busy !== null) return;
    autoOrdrAttempted.current.add(orderId);

    setBusy(`ordr-${orderId}`);
    setError(null);
    try {
      const res = await fetch("/api/galaxus/edi/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, types: ["ORDR"], force: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? "ORDR send failed");
      await loadDetail(orderId);
    } catch (err: any) {
      setError(err?.message ?? "ORDR send failed");
    } finally {
      setBusy(null);
    }
  };

  const markWarehouseShipped = async (lineId: string) => {
    if (!selectedOrderId) return;
    setBusy(`ship-${lineId}`);
    setError(null);
    try {
      const res = await fetch(`/api/galaxus/orders/${selectedOrderId}/lines/${lineId}/warehouse-shipped`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not mark shipped");
      await loadDetail(selectedOrderId);
      await loadOrders();
    } catch (err: any) {
      setError(err?.message ?? "Could not mark shipped");
    } finally {
      setBusy(null);
    }
  };

  const openManualEntry = (line: any, unitIndex: number = 0) => {
    if (!selectedOrderId || !detail) {
      setError("Order detail not loaded yet");
      return;
    }
    if (String(detail?.id ?? "") !== String(selectedOrderId)) {
      setError("Order detail is still loading (please retry)");
      return;
    }
    const match = matchesByLine.get(line.id) ?? null;
    const priceRaw = line.priceLineAmount ?? line.lineNetAmount ?? null;
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
    const skuPrefill = String(line.supplierSku ?? "N/A");
    const sizePrefill = String(line.size ?? "");
    const orderLabel = `${detail?.galaxusOrderId ?? ""}${detail?.recipientName ? ` · ${detail.recipientName}` : ""}`;
    const initialData = {
      shopifyOrderId: detail?.id ?? "",
      shopifyOrderName: orderLabel,
      shopifyCreatedAt: detail?.orderDate ?? null,
      shopifyLineItemId: line.id,
      shopifyProductTitle: title,
      shopifySku: skuPrefill,
      shopifySizeEU: sizePrefill || "N/A",
      shopifyTotalPrice: Number.isFinite(priceNumber) ? priceNumber : null,
      shopifyCurrencyCode: detail?.currencyCode ?? "CHF",
      stockxOrderNumber: match?.stockxOrderNumber ?? "",
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
      unitIndex,
      initialData,
    });
  };

  const purgeOrderFromDbInteractive = () => {
    if (!detail?.galaxusOrderId) {
      setError("Wait for order details to load, then try again.");
      return;
    }
    void runPurgeGalaxusOrderFromDbUi({
      orderId: selectedOrderId,
      galaxusOrderId: detail.galaxusOrderId,
      setError,
      setPurging: (v) => setBusy(v ? `purge-${selectedOrderId}` : null),
      onSuccess: async () => {
        setSelectedOrderId("");
        setDetail(null);
        await loadOrders();
      },
    });
  };

  const saveManualEntry = async (data: any) => {
    const orderId = manualEntryModal.orderId ?? selectedOrderId;
    if (!orderId || !manualEntryModal.line) return;
    setError(null);
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
      if (json.stockxEnrich?.attempted && !json.stockxEnrich?.ok) {
        setError(
          `StockX lookup: ${json.stockxEnrich.reason ?? "failed"} (saved your form values). Check order # and .data/stockx-token-galaxus.json.`
        );
      }
      setManualEntryModal({ isOpen: false, mode: "create", line: null, orderId: null, initialData: {} });
      await loadDetail(orderId);
      await loadOrders();
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    void loadOrders();
  }, []);

  useEffect(() => {
    void loadDetail(selectedOrderId);
  }, [selectedOrderId]);

  useEffect(() => {
    if (!selectedOrderId || !detail) return;
    void sendOrdrIfNeeded(selectedOrderId, detail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrderId, detail?.id, detail?.ordrSentAt, detail?.cancelledAt]);

  useEffect(() => {
    if (
      manualEntryModal.isOpen &&
      manualEntryModal.orderId &&
      selectedOrderId &&
      manualEntryModal.orderId !== selectedOrderId
    ) {
      setManualEntryModal({ isOpen: false, mode: "create", line: null, orderId: null, initialData: {} });
    }
  }, [selectedOrderId, manualEntryModal.isOpen, manualEntryModal.orderId]);

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Warehouse</h1>
          <p className="text-sm text-gray-600">
            Link procurement (StockX / manual), then mark lines shipped when you send the product.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/galaxus" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Ops &amp; Data
          </a>
          <a href="/galaxus/direct-delivery" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Direct delivery
          </a>
          <a href="/galaxus/warehouse-shipments" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Warehouse shipments
          </a>
          <a href="/galaxus/pricing" className="px-3 py-2 rounded bg-gray-100 text-sm">
            Pricing &amp; DB
          </a>
          <a href="/galaxus/invoices" className="px-3 py-2 rounded bg-gray-900 text-white text-sm">
            Invoices
          </a>
          <a href="/decathlon" className="px-3 py-2 rounded bg-teal-700 text-white text-sm">
            Decathlon
          </a>
        </div>
      </div>

      <section className="border rounded bg-white p-4 space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          <button
            className="px-3 py-2 rounded bg-gray-100 text-sm"
            onClick={() => void ingestNewOrders()}
            disabled={loading || busy !== null}
          >
            {busy === "ingest" ? "Ingesting..." : "Ingest new orders"}
          </button>
          {detail && !detail.ordrSentAt && !detail.cancelledAt ? (
            <span className="text-xs text-amber-700">
              ORDR missing{busy === `ordr-${selectedOrderId}` ? " · sending…" : ""}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
          <div className="border rounded p-2 max-h-[620px] overflow-auto">
            <div className="text-xs text-gray-500 mb-2">
              Active orders ({orders.length}) {loading ? "· loading..." : ""}
            </div>
            <div className="space-y-2">
              {orders.map((order) => {
                const selectedRow = order.id === selectedOrderId;
                return (
                  <button
                    key={order.id}
                    className={`w-full text-left border rounded p-2 text-xs ${
                      selectedRow ? "border-indigo-500 bg-indigo-50" : "border-gray-200"
                    }`}
                    onClick={() => setSelectedOrderId(order.id)}
                  >
                    <div className="font-semibold">{order.galaxusOrderId}</div>
                    <div className="text-gray-600">
                      {order.deliveryType ?? "—"} · {order._count?.lines ?? 0} lines
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border rounded p-3 min-h-[420px]">
            {!selected ? (
              <div className="text-sm text-gray-500">Select an order.</div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="text-sm min-w-0">
                    <span className="font-semibold">{selected.galaxusOrderId}</span>
                    <span className="text-gray-600"> · {selected.deliveryType ?? "—"}</span>
                    {detail?.cancelledAt ? (
                      <span className="block text-xs text-red-600 mt-0.5">
                        Cancelled in DB · {new Date(detail.cancelledAt).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    title="Permanently delete this order from the database (Galaxus canceled / abandoned)."
                    className="px-3 py-1.5 rounded bg-red-950 text-white text-xs shrink-0 disabled:opacity-50"
                    onClick={() => void purgeOrderFromDbInteractive()}
                    disabled={busy !== null || !detail}
                  >
                    {busy === `purge-${selectedOrderId}` ? "Removing…" : "Remove from DB"}
                  </button>
                </div>

                <StockxOrderTools
                  orderId={selectedOrderId}
                  onAfterAction={async () => {
                    await loadOrders();
                    await loadDetail(selectedOrderId);
                  }}
                />

                {busy === "detail" ? (
                  <div className="text-xs text-gray-500">Loading order…</div>
                ) : null}

                <div className="border rounded p-2">
                  <div className="font-medium mb-2 text-xs">Products</div>
                  <div className="max-h-[520px] overflow-auto space-y-2">
                    {(detail?.lines ?? []).map((line: any) => {
                      const proc = line.procurement;
                      const unitsList: any[] = proc?.units ?? [];
                      const allUnitsLinked = unitsList.length > 0 && unitsList.every((u: any) => u.linked);
                      const linked = allUnitsLinked || Boolean(proc?.ok);
                      const shippedAt = line.warehouseMarkedShippedAt;
                      const isShipped = Boolean(shippedAt);
                      const shipBusy = busy === `ship-${line.id}`;
                      const revenueChf = galaxusLineNetRevenueChf(line);
                      const totalUnitCost = unitsList
                        .filter((u: any) => u.linked && u.stockxAmount != null)
                        .reduce((sum: number, u: any) => sum + Number(u.stockxAmount), 0);
                      const costChf =
                        totalUnitCost > 0
                          ? totalUnitCost
                          : proc?.stockxCostChf != null && Number.isFinite(Number(proc.stockxCostChf))
                            ? Number(proc.stockxCostChf)
                            : null;
                      const costCur =
                        proc?.stockxCostCurrency != null
                          ? String(proc.stockxCostCurrency).trim()
                          : null;
                      const profitRow =
                        linked && revenueChf != null && costChf != null
                          ? galaxusProfitFromRevenueAndStockxCost(revenueChf, costChf)
                          : null;
                      return (
                        <div
                          key={line.id}
                          className={`border rounded p-2 ${linked ? "border-green-400 bg-green-50/50" : "border-gray-200"}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="font-medium text-gray-900 flex items-center gap-1.5 flex-wrap">
                                {linked ? (
                                  <span className="text-green-600 shrink-0" title="Linked">
                                    ✓
                                  </span>
                                ) : (
                                  <span className="text-gray-300 shrink-0">○</span>
                                )}
                                <span className="truncate">{buildLineTitle(line)}</span>
                                {isShipped ? (
                                  <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 shrink-0">
                                    Shipped
                                    {shippedAt
                                      ? ` · ${new Date(shippedAt).toLocaleDateString("fr-CH")}`
                                      : ""}
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-gray-600 text-xs">
                                Size raw: {line.sizeRaw ?? "—"} · Size: {line.size ?? "—"}
                              </div>
                              <div className="text-gray-600 text-xs">
                                SKU: {line.supplierSku ?? "—"} · GTIN: {line.gtin ?? "—"}
                              </div>
                              <div className="text-gray-500 text-xs">
                                Qty {line.quantity}
                                {line.unitNetPrice != null ? (
                                  <span className="ml-2">
                                    Sell: <span className="font-mono">{line.currencyCode ?? "CHF"} {Number(line.unitNetPrice).toFixed(2)}</span>
                                    {line.lineNetAmount != null ? (
                                      <span className="text-gray-400 ml-1">(line {Number(line.lineNetAmount).toFixed(2)})</span>
                                    ) : null}
                                  </span>
                                ) : null}
                                {line.catalogPrice != null ? (
                                  <span className="ml-2 text-blue-600">
                                    DB: <span className="font-mono">{Number(line.catalogPrice).toFixed(2)}</span>
                                  </span>
                                ) : null}
                              </div>
                              {linked && proc && !isShipped ? (
                                <div className="text-green-800 text-[11px] space-y-0.5">
                                  <div>
                                    {proc.source === "galaxus_match" ? "Saved match" : "StockX sync"} · AWB:{" "}
                                    {proc.awb ?? "—"}
                                  </div>
                                  {profitRow ? (
                                    <div className="text-gray-800">
                                      Galaxus net {detail?.currencyCode ?? "CHF"} {profitRow.revenueChf.toFixed(2)} ·
                                      StockX {costCur || "CHF"} {profitRow.stockxCostChf.toFixed(2)} · Profit{" "}
                                      {profitRow.profitChf.toFixed(2)}
                                      {profitRow.profitPercentOfRevenue != null
                                        ? ` (${profitRow.profitPercentOfRevenue.toFixed(1)}% of net line)`
                                        : ""}
                                    </div>
                                  ) : linked && revenueChf != null && costChf == null ? (
                                    <div className="text-amber-900">
                                      StockX cost not stored: add amount in manual supplier, or run{" "}
                                      <span className="font-medium">Sync orders + AWB</span> (needs buys visible in
                                      StockX — not only archived / other tabs).
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              {proc?.units && proc.units.length > 1 ? (
                                <div className="mt-1 space-y-1">
                                  {proc.units.map((unit: any) => (
                                    <div
                                      key={unit.unitIndex}
                                      className={`text-[11px] flex items-center gap-2 px-1.5 py-0.5 rounded ${
                                        unit.linked ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"
                                      }`}
                                    >
                                      <span className="font-medium">Unit {unit.unitIndex + 1}/{proc.units.length}</span>
                                      {unit.linked ? (
                                        <>
                                          <span>✓ {unit.stockxOrderNumber ?? "linked"}</span>
                                          {unit.stockxAmount != null ? (
                                            <span className="font-mono">{unit.stockxCurrencyCode ?? "CHF"} {Number(unit.stockxAmount).toFixed(2)}</span>
                                          ) : null}
                                          {unit.awb ? <span>AWB: {unit.awb}</span> : null}
                                        </>
                                      ) : (
                                        <span>Not linked</span>
                                      )}
                                      {!unit.linked ? (
                                        <button
                                          type="button"
                                          onClick={() => openManualEntry(line, unit.unitIndex)}
                                          disabled={busy !== null || !detail}
                                          className="ml-auto px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px] disabled:opacity-50"
                                        >
                                          Link
                                        </button>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              ) : !linked ? (
                                <div className="text-amber-800 text-[11px]">
                                  Sync or manual supplier entry to link, then you can mark shipped.
                                </div>
                              ) : null}
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              {linked && !isShipped ? (
                                <button
                                  type="button"
                                  onClick={() => void markWarehouseShipped(line.id)}
                                  disabled={busy !== null}
                                  className="px-2 py-1 rounded bg-slate-800 text-white text-[10px] whitespace-nowrap disabled:opacity-50"
                                >
                                  {shipBusy ? "…" : "Mark shipped"}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => openManualEntry(line)}
                                disabled={busy !== null || !detail}
                                className="px-2 py-1 rounded bg-blue-600 text-white text-[10px] disabled:opacity-50"
                              >
                                Manual supplier
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}

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
          setManualEntryModal({ isOpen: false, mode: "create", line: null, orderId: null, initialData: {} })
        }
      />
    </main>
  );
}
