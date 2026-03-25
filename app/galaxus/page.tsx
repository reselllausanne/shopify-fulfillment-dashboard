"use client";

import { useEffect, useState } from "react";
import {
  galaxusShipmentHasTrackingSignal,
  isGalaxusShipmentDispatchConfirmed,
} from "@/galaxus/orders/shipmentDispatch";

type PreviewItem = {
  supplierVariantId: string;
  supplierSku: string;
  price: number | null;
  stock: number | null;
  sizeRaw: string | null;
  productName: string;
  brand: string;
  sizeUs: string;
  sizeEu: string | null;
  barcode: string | null;
};

type SupplierVariant = {
  supplierVariantId: string;
  supplierSku: string;
  providerKey?: string | null;
  gtin?: string | null;
  price: string;
  stock: number;
  sizeRaw: string | null;
  images: unknown;
  leadTimeDays: number | null;
  updatedAt: string;
};

type MappingRow = {
  id: string;
  status: string | null;
  updatedAt: string | null;
  supplierVariantId: string;
  providerKey: string | null;
  gtin: string | null;
  supplierSku: string | null;
  supplierBrand: string | null;
  supplierProductName: string | null;
  sizeRaw: string | null;
  price: any;
  stock: any;
  lastSyncAt: string | null;
  kickdbProductId: string | null;
  kickdbBrand: string | null;
  kickdbName: string | null;
  kickdbStyleId: string | null;
  kickdbImageUrl: string | null;
  kickdbLastFetchedAt: string | null;
  kickdbNotFound: boolean | null;
  kickdbDescription?: string | null;
  kickdbGender?: string | null;
  kickdbColorway?: string | null;
  kickdbCountryOfManufacture?: string | null;
  kickdbReleaseDate?: string | null;
  kickdbRetailPrice?: number | string | null;
};

type EnrichDebugInfo = {
  reason?: string;
  query?: string;
  productName?: string | null;
  raw?: boolean;
  rawSearch?: unknown;
  rawProduct?: unknown;
  searchMeta?: { total?: number };
  searchTop?: { id?: string; slug?: string; title?: string; sku?: string } | null;
  productSummary?: { id?: string; slug?: string; title?: string; sku?: string; variantCount?: number } | null;
  matchedVariant?: { id?: string; size?: string; size_us?: string; size_eu?: string } | null;
  variantSizes?: string[];
  error?: string;
};

type EnrichResult = {
  supplierVariantId: string;
  status: string;
  gtin?: string | null;
  error?: string;
  debug?: EnrichDebugInfo;
};

type OrderSummary = {
  id: string;
  galaxusOrderId: string;
  orderNumber?: string | null;
  orderDate: string;
  deliveryType?: string | null;
  customerName?: string | null;
  recipientName?: string | null;
  createdAt: string;
  ordrSentAt?: string | null;
  ordrMode?: string | null;
  archivedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  shippedCount?: number | null;
  _count: { lines: number; shipments: number };
};

type OrderLine = {
  id: string;
  lineNumber: number;
  productName: string;
  quantity: number;
  gtin?: string | null;
  supplierSku?: string | null;
  supplierPid?: string | null;
  buyerPid?: string | null;
  size?: string | null;
  providerKey?: string | null;
  supplierVariantId?: string | null;
};

/** Mirrors galaxus/stx/purchaseUnits `isStxLine` — used for UI labels only */
function isStxOrderLine(line: {
  supplierPid?: string | null;
  supplierVariantId?: string | null;
  providerKey?: string | null;
}): boolean {
  const supplierPid = String(line?.supplierPid ?? "").trim().toUpperCase();
  if (supplierPid.startsWith("STX_")) return true;
  const supplierVariantId = String(line?.supplierVariantId ?? "").trim().toLowerCase();
  if (supplierVariantId.startsWith("stx_")) return true;
  const providerKeyRaw = String(line?.providerKey ?? "").trim().toUpperCase();
  if (providerKeyRaw === "STX" || providerKeyRaw.startsWith("STX_")) return true;
  return false;
}

/** Rough channel bucket for packing validation (must match one parcel — no STX + TRM mixed). */
function packChannelForLine(line: OrderLine): string {
  const pk = String(line.providerKey ?? "").trim().toUpperCase();
  if (pk.startsWith("STX") || pk === "STX") return "STX";
  if (pk) {
    const head = pk.split(/[:_]/)[0];
    return head || pk;
  }
  const sv = String(line.supplierVariantId ?? "").trim().toLowerCase();
  if (sv.startsWith("stx_")) return "STX";
  return "OTHER";
}

type ShipmentItem = {
  id: string;
  supplierPid: string;
  gtin14: string;
  buyerPid?: string | null;
  quantity: number;
  manualBoughtQty?: number | null;
};

type Shipment = {
  id: string;
  shipmentId: string;
  providerKey?: string | null;
  supplierOrderRef?: string | null;
  status?: string | null;
  boxStatus?: string | null;
  dispatchNotificationId?: string | null;
  packageId?: string | null;
  trackingNumber?: string | null;
  manualOrderRef?: string | null;
  manualEtaMin?: string | null;
  manualEtaMax?: string | null;
  manualNote?: string | null;
  carrierFinal?: string | null;
  delrStatus?: string | null;
  delrFileName?: string | null;
  delrSentAt?: string | null;
  galaxusShippedAt?: string | null;
  labelPdfUrl?: string | null;
  shippingLabelPdfUrl?: string | null;
  deliveryNotePdfUrl?: string | null;
  labelZpl?: string | null;
  shippedAt?: string | null;
  createdAt: string;
  items: ShipmentItem[];
  stx?: StxOrderStatus | null;
};

type EdiFile = {
  id: string;
  direction: string;
  docType: string;
  status: string;
  filename?: string | null;
  createdAt: string;
};

type StxLinkBucket = {
  gtin: string;
  supplierVariantId: string;
  needed: number;
  reserved: number;
  linked: number;
  linkedWithEta: number;
  linkedWithAwb: number;
};

type StxOrderStatus = {
  galaxusOrderId: string;
  hasStxItems: boolean;
  allLinked: boolean;
  allEtaPresent: boolean;
  allAwbPresent: boolean;
  buckets: StxLinkBucket[];
};

type StxImportResult = {
  ok: boolean;
  productSummary?: {
    input?: string;
    normalizedInput?: string;
    kickdbProductId?: string | null;
    slug?: string | null;
    styleId?: string | null;
    name?: string | null;
    brand?: string | null;
    image?: string | null;
  } | null;
  importedVariantsCount: number;
  eligibleVariantsCount: number;
  warnings: string[];
  errors: string[];
  variantsPreview?: Array<{
    supplierVariantId: string;
    size: string | null;
    deliveryType: string;
    price: number;
    stock: number;
  }>;
};

type OrderDetail = {
  id: string;
  galaxusOrderId: string;
  orderNumber?: string | null;
  deliveryType?: string | null;
  createdAt: string;
  ordrSentAt?: string | null;
  ordrMode?: string | null;
  archivedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  lines: OrderLine[];
  shipments: Shipment[];
  statusEvents: Array<{ id: string; type: string; createdAt: string }>;
  ediFiles: EdiFile[];
  stx?: StxOrderStatus | null;
  stxUnits?: Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    gtin: string;
    supplierVariantId: string;
    stockxOrderId: string | null;
    awb: string | null;
    etaMin: string | null;
    etaMax: string | null;
    checkoutType: string | null;
    manualTrackingRaw: string | null;
    manualNote: string | null;
    manualSetAt: string | null;
    cancelledAt?: string | null;
    cancelledReason?: string | null;
  }>;
  skuByGtin?: Record<string, string>;
  sizeByGtin?: Record<string, string>;
  productNameByGtin?: Record<string, string>;
};

export default function GalaxusDashboardPage() {
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [dbItems, setDbItems] = useState<SupplierVariant[]>([]);
  const [dbNextOffset, setDbNextOffset] = useState<number | null>(null);
  const [dbMappings, setDbMappings] = useState<MappingRow[]>([]);
  const [dbMappingsNextOffset, setDbMappingsNextOffset] = useState<number | null>(null);
  const [enrichResults, setEnrichResults] = useState<EnrichResult[]>([]);
  const [enrichDebugRaw, setEnrichDebugRaw] = useState<string | null>(null);
  const [batchLimit] = useState<number>(100);
  const [batchOffset] = useState<number>(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variantStats, setVariantStats] = useState<{
    total: number;
    withGtin: number;
    withoutGtin: number;
  } | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [ordersNextOffset, setOrdersNextOffset] = useState<number | null>(null);
  const [orderView, setOrderView] = useState<"active" | "history">("active");
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [opsLog, setOpsLog] = useState<string | null>(null);
  const [opsBusy, setOpsBusy] = useState<string | null>(null);
  const [unassignedCount, setUnassignedCount] = useState<number | null>(null);
  const [cleanupStats, setCleanupStats] = useState<any | null>(null);
  const [opsStatus, setOpsStatus] = useState<any | null>(null);
  const [feedValidation, setFeedValidation] = useState<any | null>(null);
  const [feedValidationBusy, setFeedValidationBusy] = useState<boolean>(false);
  const [enrichSku, setEnrichSku] = useState<string>("");
  // Enrich-all UI removed; enrichment is cron-driven.
  const [stxImportInput, setStxImportInput] = useState<string>("");
  const [stxImportResult, setStxImportResult] = useState<StxImportResult | null>(null);
  const [stxSlugInput, setStxSlugInput] = useState<string>("");
  const [stxSlugCounts, setStxSlugCounts] = useState<{
    pending: number;
    imported: number;
    error: number;
  } | null>(null);
  const [forceShipmentDocs, setForceShipmentDocs] = useState<Record<string, boolean>>({});
  const [stxManualVariantId, setStxManualVariantId] = useState<string>("");
  const [stxManualModalOpen, setStxManualModalOpen] = useState<boolean>(false);
  const [stxManualOrderId, setStxManualOrderId] = useState<string>("");
  const [stxManualEtaMin, setStxManualEtaMin] = useState<string>("");
  const [stxManualEtaMax, setStxManualEtaMax] = useState<string>("");
  const [stxManualAwb, setStxManualAwb] = useState<string>("");
  const [stxManualNote, setStxManualNote] = useState<string>("");
  const [stxManualCancelReason, setStxManualCancelReason] = useState<string>("");
  const [manualFulfillModalOpen, setManualFulfillModalOpen] = useState<boolean>(false);
  const [manualFulfillShipmentId, setManualFulfillShipmentId] = useState<string>("");
  const [manualFulfillLineId, setManualFulfillLineId] = useState<string>("");
  const [manualFulfillTracking, setManualFulfillTracking] = useState<string>("");
  const [manualFulfillCarrier, setManualFulfillCarrier] = useState<string>("Swiss Post");
  const [manualFulfillMarkShipped, setManualFulfillMarkShipped] = useState<boolean>(false);
  const [manualFulfillOrderRef, setManualFulfillOrderRef] = useState<string>("");
  const [manualFulfillEtaMin, setManualFulfillEtaMin] = useState<string>("");
  const [manualFulfillEtaMax, setManualFulfillEtaMax] = useState<string>("");
  const [manualFulfillNote, setManualFulfillNote] = useState<string>("");
  const [manualFulfillIsStx, setManualFulfillIsStx] = useState<boolean>(false);
  const [manualFulfillBoughtQty, setManualFulfillBoughtQty] = useState<number>(0);
  const [showArchivedShipments, setShowArchivedShipments] = useState(false);
  const [invoiceLineSelection, setInvoiceLineSelection] = useState<Record<string, boolean>>({});
  const [invoiceBusy, setInvoiceBusy] = useState<boolean>(false);
  /** Manual parcel builder: qty per order line per column (parcel). */
  const [manualPackCols, setManualPackCols] = useState(2);
  const [manualPackQty, setManualPackQty] = useState<Record<string, number[]>>({});
  const [manualPackConfirmReplace, setManualPackConfirmReplace] = useState(false);
  const [postLabelUrlByShipment, setPostLabelUrlByShipment] = useState<Record<string, string>>({});
  const [lineStockById, setLineStockById] = useState<
    Record<
      string,
      {
        status: "OK" | "OUT_OF_STOCK" | "UNKNOWN" | "NO_VARIANT";
        stock: number | null;
        requestedQty: number;
        available: boolean | null;
        supplierSku?: string | null;
        noResponseReason?: string | null;
        triedSkus?: string[];
      }
    >
  >({});
  const [exportCounts, setExportCounts] = useState<{
    supplierVariantsTotal: number;
    exportRowsAfterInvariants: number;
    pendingGtin: number;
    notFoundGtin: number;
    enrichPendingAt: string | null;
    enrichNotFoundAt: string | null;
  } | null>(null);
  const formatTime = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString() : "—";
  const opsJobLabels: Record<string, string> = {
    "partner-stock-sync": "Partner stock sync (5h)",
    "stx-refresh": "StockX/Kicks refresh (24h)",
    "edi-in": "EDI IN order polling (1h)",
    "image-sync": "Image sync + host (24h)",
  };

  const totalShipments = selectedOrder?.shipments?.length ?? 0;
  const delrUploadedCount =
    selectedOrder?.shipments?.filter(
      (s) => String(s.delrStatus ?? "").toUpperCase() === "UPLOADED" || Boolean(s.delrSentAt)
    ).length ?? 0;
  const shippedCount =
    selectedOrder?.shipments?.filter((s) => isGalaxusShipmentDispatchConfirmed(s)).length ?? 0;
  const parcelsWithTrackingOnly =
    selectedOrder?.shipments?.filter(
      (s) => galaxusShipmentHasTrackingSignal(s) && !isGalaxusShipmentDispatchConfirmed(s)
    ).length ?? 0;
  const orderGalaxusLocked = delrUploadedCount > 0;

  const resolveShippingStatus = (shipped: number, total: number) => {
    if (total === 0) return "Not shipped";
    if (shipped === 0) return "Not shipped";
    if (shipped < total) return "Partially shipped";
    return "Fully shipped";
  };

  const resolveOrderStatus = (order: {
    archivedAt?: string | null;
    cancelledAt?: string | null;
    ordrSentAt?: string | null;
    shippedCount?: number | null;
    _count?: { shipments: number };
  }) => {
    if (order.cancelledAt) return "Cancelled";
    if (order.archivedAt) return "Archived";
    const total = order._count?.shipments ?? 0;
    const shipped = order.shippedCount ?? 0;
    if (total > 0 && shipped >= total) return "Fully shipped";
    if (total > 0 && shipped > 0) return "Partially shipped";
    if (order.ordrSentAt) return "ORDR sent";
    return "ORDR pending";
  };

  const selectedOrderStatus = selectedOrder
    ? resolveOrderStatus({
        archivedAt: selectedOrder.archivedAt,
        cancelledAt: selectedOrder.cancelledAt,
        ordrSentAt: selectedOrder.ordrSentAt,
        shippedCount,
        _count: { shipments: totalShipments },
      })
    : "—";
  const selectedShippingStatus = resolveShippingStatus(shippedCount, totalShipments);
  const canArchiveSelected =
    Boolean(selectedOrder) &&
    !selectedOrder?.archivedAt &&
    !selectedOrder?.cancelledAt &&
    totalShipments > 0 &&
    shippedCount === totalShipments;
  const canCancelSelected =
    Boolean(selectedOrder) && !selectedOrder?.archivedAt && !selectedOrder?.cancelledAt;
  const canSendOrdrSelected =
    Boolean(selectedOrder) && !selectedOrder?.archivedAt && !selectedOrder?.cancelledAt && !selectedOrder?.ordrSentAt;

  const summarizeJobResult = (result: any) => {
    if (!result) return null;
    if (typeof result !== "object") return String(result);
    if (Array.isArray(result.items)) {
      const statusCounts: Record<string, number> = {};
      for (const item of result.items) {
        const status = String(item?.status ?? "unknown");
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      }
      return JSON.stringify({ items: result.items.length, status: statusCounts });
    }
    const text = JSON.stringify(result);
    return text.length > 320 ? `${text.slice(0, 320)}…` : text;
  };

  const toDateInput = (iso: string | null | undefined): string => {
    const raw = String(iso ?? "").trim();
    if (!raw) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  };

  const openStxManualModalForVariant = (variantId: string) => {
    const next = String(variantId ?? "").trim();
    setStxManualVariantId(next);

    const units = Array.isArray(selectedOrder?.stxUnits) ? selectedOrder?.stxUnits : [];
    const related = units.filter((u) => String(u?.supplierVariantId ?? "") === next);
    const best =
      related.find((u) => Boolean(u?.manualSetAt)) ??
      related.find((u) => Boolean(u?.stockxOrderId)) ??
      related[0] ??
      null;

    setStxManualOrderId(best?.stockxOrderId ? String(best.stockxOrderId) : "");
    setStxManualEtaMin(toDateInput(best?.etaMin ?? null));
    setStxManualEtaMax(toDateInput(best?.etaMax ?? null));
    setStxManualAwb(
      best?.manualTrackingRaw
        ? String(best.manualTrackingRaw)
        : best?.awb
          ? String(best.awb)
          : ""
    );
    setStxManualNote(best?.manualNote ? String(best.manualNote) : "");
    setStxManualCancelReason("");
    setStxManualModalOpen(Boolean(next));
  };

  const openManualFulfillForLine = (line: OrderLine) => {
    if (!selectedOrder) {
      setError("Select an order first.");
      return;
    }
    if (!selectedOrder.shipments?.length) {
      setError("Pack shipments first (no shipments found).");
      return;
    }
    const gtin = String(line?.gtin ?? "").trim();
    const supplierPid = String(line?.supplierPid ?? "").trim();
    const shipment =
      selectedOrder.shipments.find((s) =>
        (s.items ?? []).some(
          (it) => String(it?.gtin14 ?? "").trim() === gtin && String(it?.supplierPid ?? "").trim() === supplierPid
        )
      ) ?? null;
    if (!shipment) {
      setError("Could not find a shipment box for this line. Re-pack shipments and try again.");
      return;
    }
    setManualFulfillShipmentId(shipment.id);
    setManualFulfillLineId(line.id);
    const shipmentItem =
      shipment?.items?.find(
        (it: any) => String(it?.gtin14 ?? "").trim() === gtin && String(it?.supplierPid ?? "").trim() === supplierPid
      ) ?? null;
    setManualFulfillTracking(shipment.trackingNumber ? String(shipment.trackingNumber) : "");
    setManualFulfillCarrier(shipment.carrierFinal ? String(shipment.carrierFinal) : "Swiss Post");
    setManualFulfillMarkShipped(!shipment.shippedAt);
    setManualFulfillOrderRef(shipment.manualOrderRef ? String(shipment.manualOrderRef) : "");
    setManualFulfillEtaMin(toDateInput(shipment.manualEtaMin ?? null));
    setManualFulfillEtaMax(toDateInput(shipment.manualEtaMax ?? null));
    setManualFulfillNote(shipment.manualNote ? String(shipment.manualNote) : "");
    setManualFulfillBoughtQty(Number(shipmentItem?.manualBoughtQty ?? 0));
    const ref = shipment.manualOrderRef ? String(shipment.manualOrderRef) : "";
    setManualFulfillIsStx(isLikelyStockxOrderId(ref));
    setManualFulfillModalOpen(true);
  };

  const isLikelyStockxOrderId = (value: string): boolean => {
    const v = String(value ?? "").trim().toUpperCase();
    if (!v) return false;
    return /^(\d{2}-)?[A-Z0-9]{6,}$/.test(v);
  };

  const guessCarrierFromTrackingUrl = (url: string | null): string | null => {
    if (!url) return null;
    const u = url.toLowerCase();
    if (u.includes("dhl")) return "DHL";
    if (u.includes("ups") || u.includes("1z")) return "UPS";
    if (u.includes("dpd")) return "DPD";
    if (u.includes("fedex")) return "FedEx";
    if (u.includes("swisspost") || u.includes("post.ch")) return "Swiss Post";
    return null;
  };

  const fetchManualStockxDetails = async () => {
    const orderId = manualFulfillOrderRef.trim();
    if (!orderId) {
      setError("Enter a StockX order number first.");
      return;
    }
    setBusy("manual-stockx-lookup");
    setError(null);
    try {
      const res = await fetch(`/api/galaxus/stx/buy-order-lookup?orderId=${encodeURIComponent(orderId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "StockX lookup failed");
      const details = data.details ?? {};
      if (details.etaMin) setManualFulfillEtaMin(toDateInput(details.etaMin));
      if (details.etaMax) setManualFulfillEtaMax(toDateInput(details.etaMax));
      if (details.awb && !manualFulfillTracking.trim()) setManualFulfillTracking(String(details.awb));
      const carrierGuess = guessCarrierFromTrackingUrl(details.trackingUrl ?? null);
      if (carrierGuess && !manualFulfillCarrier.trim()) setManualFulfillCarrier(carrierGuess);
      setManualFulfillIsStx(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const saveManualFulfillOverride = async () => {
    if (!selectedOrderId) {
      setError("Select an order first.");
      return;
    }
    if (!manualFulfillShipmentId.trim()) {
      setError("No shipment selected for manual override.");
      return;
    }
    setBusy(`manual-override-${manualFulfillShipmentId}`);
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/shipments/${manualFulfillShipmentId}/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manualManaged: true,
          markShipped: manualFulfillMarkShipped,
          trackingNumber: manualFulfillTracking.trim() || null,
          carrierFinal: manualFulfillCarrier.trim() || null,
          manualOrderRef: manualFulfillOrderRef.trim() || null,
          manualEtaMin: manualFulfillEtaMin ? new Date(manualFulfillEtaMin).toISOString() : null,
          manualEtaMax: manualFulfillEtaMax ? new Date(manualFulfillEtaMax).toISOString() : null,
          manualNote: manualFulfillNote.trim() || null,
          lineId: manualFulfillLineId || null,
          manualBoughtQty: Number.isFinite(manualFulfillBoughtQty) ? manualFulfillBoughtQty : 0,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data?.error ?? "Manual override failed");
      setOpsLog(
        JSON.stringify(
          {
            ...data,
            lineId: manualFulfillLineId || null,
          },
          null,
          2
        )
      );
      await loadOrderDetail(selectedOrderId);
      setManualFulfillModalOpen(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const loadOpsStatus = async () => {
    try {
      const res = await fetch("/api/galaxus/ops/status", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) setOpsStatus(data ?? null);
    } catch {
      // silent
    }
  };

  // Enrich-all is deprecated in favor of cron-driven pipeline enrichment jobs.

  const loadRoutingSummary = async () => {
    try {
      const res = await fetch("/api/galaxus/routing-issues?status=UNASSIGNED&limit=1", {
        cache: "no-store",
      });
      const data = await res.json();
      if (data?.ok) setUnassignedCount(data.unassignedCount ?? 0);
    } catch {
      // silent
    }
  };

  const loadCleanupStats = async () => {
    setBusy("cleanup-stats");
    setError(null);
    try {
      const res = await fetch("/api/galaxus/cleanup/stats", { cache: "no-store" });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error ?? "Failed to load cleanup stats");
      setCleanupStats(data);
      setOpsLog(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const loadVariantStats = async () => {
    try {
      const res = await fetch("/api/galaxus/supplier/variants-stats", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) setVariantStats(data.stats ?? null);
    } catch {
      // silent
    }
  };

  const loadStxSlugCounts = async () => {
    try {
      const res = await fetch("/api/galaxus/stx/import-slugs", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) setStxSlugCounts(data.counts ?? null);
    } catch {
      // silent
    }
  };

  const loadExportCounts = async () => {
    try {
      const res = await fetch("/api/galaxus/export/diagnostics", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) {
        setExportCounts({
          supplierVariantsTotal: data.counts?.supplierVariantsTotal ?? 0,
          exportRowsAfterInvariants: data.counts?.exportRowsAfterInvariants ?? 0,
          pendingGtin: data.counts?.pendingGtin ?? 0,
          notFoundGtin: data.counts?.notFoundGtin ?? 0,
          enrichPendingAt: data.lastRuns?.enrichPendingAt ?? null,
          enrichNotFoundAt: data.lastRuns?.enrichNotFoundAt ?? null,
        });
      }
    } catch {
      // silent
    }
  };

  const runOpsAction = async (action: string) => {
    setOpsBusy(`ops-${action}`);
    setError(null);
    setOpsLog(null);
    try {
      const res = await fetch("/api/galaxus/ops/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Ops action failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOpsStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setOpsBusy(null);
    }
  };

  const normalizeValidationLabel = (message: string) => {
    if (message.includes("SpecificationKey is empty")) return "Specification Key is missing";
    if (message.includes("Gtin is empty")) return "GTIN is missing";
    if (message.includes("Gtin is invalid")) return "GTIN not globally valid";
    if (message.includes("ProductCategory is empty")) return "Product Type assignment is missing";
    if (message.includes("PurchasePriceExclVat") || message.includes("PurchasePriceExclVatAndFee")) {
      return "Purchase price is outside the valid range";
    }
    return message;
  };

  const buildValidationDisplay = (rows: Array<{ message: string; count: number; samples?: string[] }>) => {
    const merged = new Map<string, number>();
    const sampleMap = new Map<string, string[]>();
    for (const row of rows) {
      const label = normalizeValidationLabel(row.message);
      merged.set(label, (merged.get(label) ?? 0) + row.count);
      if (Array.isArray(row.samples) && row.samples.length > 0) {
        const existing = sampleMap.get(label) ?? [];
        for (const sample of row.samples) {
          if (existing.length >= 5) break;
          if (!existing.includes(sample)) existing.push(sample);
        }
        sampleMap.set(label, existing);
      }
    }
    return Array.from(merged.entries())
      .map(([message, count]) => ({ message, count, samples: sampleMap.get(message) ?? [] }))
      .sort((a, b) => b.count - a.count);
  };

  const loadFeedValidation = async () => {
    setFeedValidationBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/galaxus/export/check-all?all=1&summary=1", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Failed to run feed validation");
      setFeedValidation(data.report ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFeedValidationBusy(false);
    }
  };

  const backfillMappingGtins = async (apply: boolean) => {
    if (apply && !window.confirm("Backfill VariantMapping.gtin from SupplierVariant.gtin?")) {
      return;
    }
    setBusy("backfill-mapping-gtin");
    setError(null);
    try {
      const res = await fetch("/api/galaxus/cleanup/backfill-mapping-gtin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: !apply, confirm: apply }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Backfill failed");
      setOpsLog(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    // Avoid spiking DB connections on page load in production.
    // Export diagnostics is intentionally manual (button) because it's a heavy endpoint.
    (async () => {
      await loadOpsStatus();
      await loadRoutingSummary();
      await loadVariantStats();
      await loadStxSlugCounts();
    })();
  }, []);

  useEffect(() => {
    fetchOrders(0);
  }, [orderView]);

  useEffect(() => {
    if (!selectedOrder?.id || !selectedOrder.lines?.length) {
      setManualPackQty({});
      setManualPackCols(2);
      setManualPackConfirmReplace(false);
      setInvoiceLineSelection({});
      return;
    }
    setManualPackCols(2);
    setManualPackConfirmReplace(false);
    const next: Record<string, number[]> = {};
    for (const line of selectedOrder.lines) {
      next[line.id] = [0, 0];
    }
    setManualPackQty(next);
    const invoiceNext: Record<string, boolean> = {};
    for (const line of selectedOrder.lines) {
      invoiceNext[line.id] = true;
    }
    setInvoiceLineSelection(invoiceNext);
  }, [selectedOrder?.id, selectedOrder?.lines?.length, selectedOrder?.shipments?.length]);

  const importStxProduct = async () => {
    const input = stxImportInput.trim();
    if (!input) {
      setError("Enter a StockX slug or URL.");
      return;
    }
    setBusy("stx-import");
    setError(null);
    try {
      const response = await fetch("/api/galaxus/stx/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, mode: "test" }),
      });
      const data = (await response.json()) as StxImportResult;
      setStxImportResult(data);
      if (!response.ok || !data.ok) {
        throw new Error(data.errors?.[0] ?? "STX import failed");
      }
      await loadVariantStats();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const saveStxSlugs = async () => {
    if (!stxSlugInput.trim()) {
      setError("Paste at least one slug or URL.");
      return;
    }
    setBusy("stx-slug-save");
    setError(null);
    try {
      const response = await fetch("/api/galaxus/stx/import-slugs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: stxSlugInput }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Failed to save slugs");
      setStxSlugCounts(data.counts ?? null);
      setStxSlugInput("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const syncFirstStxSlugs = async () => {
    setBusy("stx-slug-sync");
    setError(null);
    try {
      const response = await fetch("/api/galaxus/stx/import-slugs/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "STX slug sync failed");
      setStxSlugCounts(data.counts ?? null);
      setOpsLog(JSON.stringify({ stxSlugSync: data }, null, 2));
      await loadVariantStats();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const reEnrichNotFound = async () => {
    setBusy("enrich-not-found");
    setError(null);
    try {
      const response = await fetch("/api/galaxus/kickdb/enrich-not-found", { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Re-enrich NOT_FOUND failed");
      setOpsLog(JSON.stringify({ enrichNotFound: data }, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const reEnrichPending = async () => {
    setBusy("enrich-pending");
    setError(null);
    try {
      const response = await fetch("/api/galaxus/kickdb/enrich-pending", { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Re-enrich PENDING failed");
      setOpsLog(JSON.stringify({ enrichPending: data }, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const clearSupplierData = async (includeKickdb: boolean) => {
    const confirmed = (window.prompt('This will DELETE supplier data. Type "YES" to confirm.') ?? "").trim().toUpperCase();
    if (confirmed !== "YES") {
      setOpsLog("Clear cancelled (confirmation not provided).");
      return;
    }
    setBusy(includeKickdb ? "supplier-clear-kickdb" : "supplier-clear");
    setError(null);
    setOpsLog(null);
    try {
      const params = new URLSearchParams({ confirm: "YES" });
      if (includeKickdb) params.set("includeKickdb", "1");
      const response = await fetch(`/api/galaxus/supplier/clear?${params.toString()}`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Clear supplier data failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadDb(0);
      await loadVariantStats();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const loadDb = async (offset = 0) => {
    setBusy("db");
    setError(null);
    try {
      const response = await fetch(
        `/api/galaxus/supplier/variants?limit=${batchLimit}&offset=${offset}`,
        {
          cache: "no-store",
        }
      );
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Load DB failed");
      setDbItems(data.items ?? []);
      setDbNextOffset(data.nextOffset ?? null);
      await loadVariantStats();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const loadMappings = async (offset = 0) => {
    setBusy("db-mappings");
    setError(null);
    try {
      const response = await fetch(
        `/api/galaxus/supplier/mappings?limit=${batchLimit}&offset=${offset}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Load mappings failed");
      setDbMappings(data.items ?? []);
      setDbMappingsNextOffset(data.nextOffset ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const enrichKickDb = async (debug = false, force = false) => {
    setBusy("enrich");
    setError(null);
    try {
      const response = await fetch(
        `/api/galaxus/kickdb/enrich?all=1&debug=${debug ? 1 : 0}&force=${force ? 1 : 0}`,
        {
          method: "POST",
        }
      );
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Enrich failed");
      setEnrichResults(data.results ?? []);
      setEnrichDebugRaw(debug ? JSON.stringify(data.results ?? [], null, 2) : null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const enrichSingleSku = async () => {
    const sku = enrichSku.trim();
    if (!sku) {
      setError("Enter a supplier SKU to enrich.");
      return;
    }
    setBusy("enrich-single");
    setError(null);
    try {
      const response = await fetch(
        `/api/galaxus/kickdb/enrich?supplierSku=${encodeURIComponent(sku)}&debug=1&force=1`,
        { method: "POST" }
      );
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Single enrich failed");
      setEnrichResults(data.results ?? []);
      setEnrichDebugRaw(JSON.stringify(data.results ?? [], null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const checkStage1 = async () => {
    setBusy("stage1-check");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(
        "/api/galaxus/export/stage1-check?all=1",
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Stage 1 check failed");
      setOpsLog(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const checkStage2 = async () => {
    setBusy("stage2-check");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(
        "/api/galaxus/export/stage2-check?all=1",
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Stage 2 check failed");
      setOpsLog(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const fetchOrders = async (offset = 0) => {
    setBusy("orders");
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: "20",
        offset: offset.toString(),
      });
      params.set("view", orderView);
      const response = await fetch(`/api/galaxus/orders?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to load orders");
      setOrders(data.items ?? []);
      setOrdersNextOffset(data.nextOffset ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const hasEdiFile = (docType: string) => {
    if (!selectedOrder) return false;
    return selectedOrder.ediFiles?.some(
      (file) => file.direction === "OUT" && file.docType === docType && file.status === "uploaded"
    );
  };

  const loadOrderDetail = async (orderId: string) => {
    if (!orderId) return;
    setBusy("order-detail");
    setError(null);
    try {
      const response = await fetch(`/api/galaxus/orders/${orderId}`, { cache: "no-store" });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to load order");
      setSelectedOrder(data.order ?? null);
      setSelectedOrderId(data.order?.id ?? orderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const closeOrderView = () => {
    setSelectedOrderId("");
    setSelectedOrder(null);
    setStxManualModalOpen(false);
    setManualFulfillModalOpen(false);
    setLineStockById({});
    setPostLabelUrlByShipment({});
    setForceShipmentDocs({});
    setManualPackQty({});
    setManualPackCols(2);
    setManualPackConfirmReplace(false);
    setInvoiceLineSelection({});
    setInvoiceBusy(false);
  };

  const closeRowActionsMenu = (el: HTMLElement) => {
    el.closest("details")?.removeAttribute("open");
  };

  const removeOrderLine = async (line: OrderLine) => {
    if (!selectedOrderId) {
      setError("Select an order first.");
      return;
    }
    const lineLabel = `Line ${line.lineNumber}${line.gtin ? ` (${line.gtin})` : ""}`;
    const confirmed = window.confirm(
      `Remove ${lineLabel} from this order?\n\nThis will drop the line from local order processing.`
    );
    if (!confirmed) return;

    setBusy(`line-remove-${line.id}`);
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/orders/${selectedOrderId}/lines/${line.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to remove order line");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrderDetail(selectedOrderId);
      await fetchOrders(0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const addManualPackColumn = () => {
    const nextCols = manualPackCols + 1;
    setManualPackCols(nextCols);
    setManualPackQty((prev) => {
      const o = { ...prev };
      for (const line of selectedOrder?.lines ?? []) {
        const base = prev[line.id] ?? Array.from({ length: manualPackCols }, () => 0);
        const row = [...base];
        while (row.length < nextCols - 1) row.push(0);
        row.push(0);
        o[line.id] = row;
      }
      return o;
    });
  };

  const removeManualPackColumn = () => {
    if (manualPackCols <= 1) return;
    const nextCols = manualPackCols - 1;
    setManualPackCols(nextCols);
    setManualPackQty((prev) => {
      const o = { ...prev };
      for (const line of selectedOrder?.lines ?? []) {
        const row = (o[line.id] ?? []).slice(0, nextCols);
        o[line.id] = row;
      }
      return o;
    });
  };

  const setManualPackCell = (lineId: string, col: number, raw: string) => {
    const qty = Math.max(0, Math.floor(Number(raw) || 0));
    setManualPackQty((prev) => {
      const row = [...(prev[lineId] ?? Array.from({ length: manualPackCols }, () => 0))];
      while (row.length < manualPackCols) row.push(0);
      row[col] = qty;
      return { ...prev, [lineId]: row };
    });
  };

  const fillOneParcelAllLines = () => {
    if (!selectedOrder?.lines?.length) return;
    const channels = new Set(selectedOrder.lines.map(packChannelForLine));
    if (channels.size > 1) {
      setError("One parcel for all lines only if every line is the same channel (e.g. all StockX). Add columns to split TRM vs STX.");
      return;
    }
    setError(null);
    setManualPackCols(1);
    const next: Record<string, number[]> = {};
    for (const line of selectedOrder.lines) {
      next[line.id] = [line.quantity];
    }
    setManualPackQty(next);
  };

  const fillOneLinePerParcel = () => {
    if (!selectedOrder?.lines?.length) return;
    setError(null);
    const lines = selectedOrder.lines;
    const n = lines.length;
    setManualPackCols(n);
    const next: Record<string, number[]> = {};
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const row = Array.from({ length: n }, () => 0);
      row[i] = line.quantity;
      next[line.id] = row;
    }
    setManualPackQty(next);
  };

  const applyManualPackages = async () => {
    if (!selectedOrder?.id || !selectedOrder.lines.length) return;
    const lines = selectedOrder.lines;
    const packages: { items: { lineId: string; quantity: number }[] }[] = [];
    for (let k = 0; k < manualPackCols; k += 1) {
      const items: { lineId: string; quantity: number }[] = [];
      for (const line of lines) {
        const q = manualPackQty[line.id]?.[k] ?? 0;
        if (q > 0) items.push({ lineId: line.id, quantity: q });
      }
      if (items.length) packages.push({ items });
    }
    if (!packages.length) {
      setError("Put at least one quantity in a parcel column.");
      return;
    }
    for (const line of lines) {
      const sum = Array.from({ length: manualPackCols }, (_, k) => manualPackQty[line.id]?.[k] ?? 0).reduce(
        (a, b) => a + b,
        0
      );
      if (sum > line.quantity) {
        setError(`Line ${line.lineNumber}: packed total (${sum}) > order qty (${line.quantity}).`);
        return;
      }
    }
    for (const pkg of packages) {
      const chans = new Set(
        pkg.items
          .map((it) => {
            const line = lines.find((l) => l.id === it.lineId);
            return line ? packChannelForLine(line) : "";
          })
          .filter(Boolean)
      );
      if (chans.size > 1) {
        setError(
          "Each column must be one supplier channel only (don’t mix StockX and TRM in the same parcel column)."
        );
        return;
      }
    }
    const hasShipments = selectedOrder.shipments.length > 0;
    if (hasShipments && !manualPackConfirmReplace) {
      setError('Tick “Replace existing draft shipments” if you want to rebuild parcels.');
      return;
    }
    setBusy("manual-pack");
    setError(null);
    try {
      const res = await fetch(`/api/galaxus/orders/${selectedOrder.id}/shipments/pack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packages,
          confirmReplace: hasShipments,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Pack failed");
      await loadOrderDetail(selectedOrder.id);
    } catch (e: any) {
      setError(e?.message ?? "Pack failed");
    } finally {
      setBusy(null);
    }
  };

  const getSelectedInvoiceLineIds = (): string[] => {
    if (!selectedOrder?.lines?.length) return [];
    return selectedOrder.lines
      .filter((line) => Boolean(invoiceLineSelection[line.id]))
      .map((line) => line.id);
  };

  const setAllInvoiceLines = (value: boolean) => {
    if (!selectedOrder?.lines?.length) return;
    const next: Record<string, boolean> = {};
    for (const line of selectedOrder.lines) {
      next[line.id] = value;
    }
    setInvoiceLineSelection(next);
  };

  const toggleInvoiceLine = (lineId: string) => {
    setInvoiceLineSelection((prev) => ({ ...prev, [lineId]: !prev[lineId] }));
  };

  const downloadInvoiceXml = () => {
    if (!selectedOrderId) return;
    const lineIds = getSelectedInvoiceLineIds();
    if (lineIds.length === 0) {
      setError("Select at least one line for invoice XML.");
      return;
    }
    const params = new URLSearchParams({
      download: "1",
      orderId: selectedOrderId,
      type: "INVO",
      lineIds: lineIds.join(","),
    });
    window.open(`/api/galaxus/edi/send?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const sendInvoiceXml = async () => {
    if (!selectedOrderId) return;
    const lineIds = getSelectedInvoiceLineIds();
    if (lineIds.length === 0) {
      setError("Select at least one line for invoice XML.");
      return;
    }
    setInvoiceBusy(true);
    setError(null);
    setOpsLog(null);
    try {
      const res = await fetch("/api/galaxus/edi/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: selectedOrderId, types: ["INVO"], lineIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "INVO failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOpsStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setInvoiceBusy(false);
    }
  };

  const downloadFeed = (type: "product" | "price" | "stock" | "specs") => {
    window.open(`/api/galaxus/feeds/preview?type=${type}&download=1`, "_blank", "noopener,noreferrer");
  };

  const downloadMappings = () => {
    const params = new URLSearchParams({ download: "1" });
    window.open(`/api/galaxus/supplier/mappings?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const sendOrdrForOrder = async (orderId: string) => {
    if (!orderId) return;
    setBusy(`ordr-${orderId}`);
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch("/api/galaxus/edi/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, types: ["ORDR"] }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "ORDR failed");
      setOpsLog(JSON.stringify(data, null, 2));
      if (selectedOrderId === orderId) {
        await loadOrderDetail(orderId);
      }
      await fetchOrders(0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const sendOrdr = async () => {
    if (!selectedOrderId) {
      setError("Select an order first.");
      return;
    }
    await sendOrdrForOrder(selectedOrderId);
  };

  const archiveOrderById = async (orderId: string) => {
    if (!orderId) return;
    const confirmed = window.confirm("Archive this order? It will move to history.");
    if (!confirmed) return;
    setBusy(`archive-${orderId}`);
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/orders/${orderId}/archive`, { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Archive failed");
      setOpsLog(JSON.stringify(data, null, 2));
      if (selectedOrderId === orderId) {
        await loadOrderDetail(orderId);
      }
      await fetchOrders(0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const cancelOrderById = async (orderId: string) => {
    if (!orderId) return;
    const confirmed = window.confirm("Cancel this order? This cannot be undone.");
    if (!confirmed) return;
    const reason = window.prompt("Cancel reason (optional)") ?? "";
    setBusy(`cancel-${orderId}`);
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, reason }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Cancel failed");
      setOpsLog(JSON.stringify(data, null, 2));
      if (selectedOrderId === orderId) {
        await loadOrderDetail(orderId);
      }
      await fetchOrders(0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const syncStockxOrdersForOrder = async () => {
    if (!selectedOrderId) {
      setError("Select an order first.");
      return;
    }
    setBusy("stx-sync-order");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/orders/${selectedOrderId}/stx/sync`, {
        method: "POST",
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to sync StockX orders");
      // Show full enriched StockX orders (A+B) in the page log.
      setOpsLog(
        JSON.stringify(
          {
            stockxBuyingOrdersEnriched: data.stockxBuyingOrdersEnriched ?? [],
          },
          null,
          2
        )
      );
      await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const recomputeStxBucketsForOrder = async () => {
    if (!selectedOrderId) {
      setError("Select an order first.");
      return;
    }
    setBusy("stx-recompute");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/orders/${selectedOrderId}/stx/sync?mode=reserve`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Failed to recompute StockX buckets");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const unlockPartialDispatchForStx = () => {
    if (!selectedOrder) return;
    const next: Record<string, boolean> = { ...forceShipmentDocs };
    selectedOrder.shipments.forEach((shipment) => {
      if (String(shipment.providerKey ?? "").toUpperCase() === "STX") {
        next[shipment.id] = true;
      }
    });
    setForceShipmentDocs(next);
  };

  const connectGalaxusStockxAccount = async () => {
    setBusy("stx-login");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch("/api/stockx/playwright", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forceLogin: true,
          headless: false,
          sessionFile: ".data/stockx-session-galaxus.json",
          tokenFile: ".data/stockx-token-galaxus.json",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error ?? "StockX login failed");
      }
      setOpsLog(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const resolveSkuForGtin = (gtin?: string | null) => {
    if (!gtin || !selectedOrder?.lines?.length) return "";
    const mapped = selectedOrder?.skuByGtin?.[gtin];
    if (mapped) return mapped;
    const match = selectedOrder.lines.find((line) => line.gtin === gtin);
    return match?.supplierSku ?? match?.supplierPid ?? "";
  };

  const resolveSizeForGtin = (gtin?: string | null) => {
    if (!gtin || !selectedOrder?.lines?.length) return "";
    const mapped = selectedOrder?.sizeByGtin?.[gtin];
    if (mapped) return mapped;
    const match = selectedOrder.lines.find((line) => line.gtin === gtin);
    return match?.size ?? "";
  };

  const resolveProductNameForGtin = (gtin?: string | null) => {
    if (!gtin || !selectedOrder?.lines?.length) return "";
    const mapped = selectedOrder?.productNameByGtin?.[gtin];
    if (mapped) return mapped;
    const match = selectedOrder.lines.find((line) => line.gtin === gtin);
    return match?.productName ?? "";
  };

  const checkLineStock = async (line: OrderLine) => {
    if (!selectedOrderId) {
      setError("Select an order first.");
      return;
    }
    setBusy(`line-stock-${line.id}`);
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(
        `/api/galaxus/orders/${selectedOrderId}/lines/${line.id}/stock`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Stock check failed");
      setLineStockById((prev) => ({
        ...prev,
        [line.id]: {
          status: data.status,
          stock: typeof data.stock === "number" ? data.stock : null,
          requestedQty: data.requestedQty ?? line.quantity,
          available: typeof data.available === "boolean" ? data.available : null,
          supplierSku: data.supplierSku ?? null,
          noResponseReason: data.noResponseReason ?? null,
          triedSkus: Array.isArray(data.triedSkus) ? data.triedSkus : [],
        },
      }));
      if (data.status === "NO_VARIANT") {
        const variants: Array<{ sizeUs?: string | null; sizeEu?: string | null; stock?: number | null }> =
          Array.isArray(data.debugVariants) ? data.debugVariants : [];
        const rows = variants.length
          ? variants
              .map((variant) => {
                const eu = variant.sizeEu ? `EU ${variant.sizeEu}` : "EU -";
                const us = variant.sizeUs ? `US ${variant.sizeUs}` : "US -";
                const stock =
                  typeof variant.stock === "number" && Number.isFinite(variant.stock)
                    ? String(variant.stock)
                    : "null";
                return `- ${eu} | ${us} | stock: ${stock}`;
              })
              .join("\n")
          : "- No variants returned by supplier API";
        const requestedSize = String(data.requestedSizeRaw ?? line.size ?? "").trim() || "N/A";
        const requestedNormalized = String(data.requestedSizeNormalized ?? "").trim() || "N/A";
        const triedSkus = Array.isArray(data.triedSkus) && data.triedSkus.length > 0
          ? data.triedSkus.join(", ")
          : "N/A";
        const reason = String(data.noResponseReason ?? "").trim();
        const reasonLine = reason === "TRM_SKU_NOT_FOUND"
          ? "Reason: TRM product endpoint returned 404 for tried SKU(s)."
          : "";
        window.alert(
          `No matching variant found on supplier API.\n\n` +
            `SKU: ${data.supplierSku ?? line.supplierSku ?? "N/A"}\n` +
            `Requested size: ${requestedSize} (normalized: ${requestedNormalized})\n\n` +
            `${reasonLine ? `${reasonLine}\nTried SKU(s): ${triedSkus}\n\n` : ""}` +
            `Supplier variants:\n${rows}`
        );
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const manualLinkStxOrder = async () => {
    if (!selectedOrderId) {
      setError("Select an order first.");
      return;
    }
    if (!stxManualVariantId.trim() || !stxManualOrderId.trim()) {
      setError("StockX order number and STX variant are required.");
      return;
    }
    if (!stxManualEtaMin.trim()) {
      setError("Estimated delivery date is required for manual override (to unlock DELR).");
      return;
    }
    setBusy("stx-manual");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/orders/${selectedOrderId}/stx/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierVariantId: stxManualVariantId.trim(),
          stockxOrderId: stxManualOrderId.trim(),
          etaMin: stxManualEtaMin ? new Date(stxManualEtaMin).toISOString() : null,
          etaMax: stxManualEtaMax ? new Date(stxManualEtaMax).toISOString() : null,
          trackingRaw: stxManualAwb.trim() || null,
          note: stxManualNote.trim() || null,
        }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Manual StockX update failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrderDetail(selectedOrderId);
      setStxManualModalOpen(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const cancelManualStxOrder = async () => {
    if (!selectedOrderId) {
      setError("Select an order first.");
      return;
    }
    if (!stxManualOrderId.trim()) {
      setError("StockX order number is required.");
      return;
    }
    setBusy("stx-cancel");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/orders/${selectedOrderId}/stx/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          stockxOrderId: stxManualOrderId.trim(),
          cancelReason: stxManualCancelReason.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Cancel StockX order failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const uploadDelrForShipment = async (shipmentId: string) => {
    setBusy(`delr-${shipmentId}`);
    setError(null);
    setOpsLog(null);
    try {
      const force = Boolean(forceShipmentDocs[shipmentId]);
      const response = await fetch(
        `/api/galaxus/shipments/${shipmentId}/delr${force ? "?force=1" : ""}`,
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        }
      );
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "DELR upload failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const deleteShipment = async (shipmentId: string) => {
    if (!confirm("Remove this package? This cannot be undone.")) return;
    setBusy(`delete-${shipmentId}`);
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/shipments/${shipmentId}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Delete shipment failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const downloadDelrXmlForShipment = (shipmentId: string) => {
    const force = Boolean(forceShipmentDocs[shipmentId]);
    const params = new URLSearchParams();
    params.set("download", "1");
    if (force) params.set("force", "1");
    window.open(
      `/api/galaxus/shipments/${shipmentId}/delr?${params.toString()}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const generatePostLabelForShipment = async (shipmentId: string, existingTracking?: string | null) => {
    const trackingNumber = (existingTracking && existingTracking.trim())
      ? existingTracking.trim()
      : (window.prompt("Tracking number (AWB) for Swiss Post label") ?? "").trim();
    if (!trackingNumber) return;
    setBusy(`postlabel-${shipmentId}`);
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/shipments/${shipmentId}/post-label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingNumber }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data?.error ?? "Post label failed");
      if (typeof data?.url === "string" && data.url.trim()) {
        setPostLabelUrlByShipment((prev) => ({ ...prev, [shipmentId]: data.url }));
      }
      setOpsLog(JSON.stringify(data, null, 2));
      if (selectedOrderId) await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const setShipmentManualManaged = async (shipmentId: string, manualManaged: boolean) => {
    setBusy(`manual-${shipmentId}`);
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/shipments/${shipmentId}/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualManaged }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data?.error ?? "Manual update failed");
      setOpsLog(JSON.stringify(data, null, 2));
      if (selectedOrderId) await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const markShipmentShippedManual = async (shipmentId: string, existingTracking?: string | null) => {
    const trackingNumber = (existingTracking && existingTracking.trim())
      ? existingTracking.trim()
      : (window.prompt("Tracking number / AWB (required to mark shipped)") ?? "").trim();
    if (!trackingNumber) return;
    const carrierFinal = (window.prompt("Carrier (optional)", "Swiss Post") ?? "").trim();

    setBusy(`manual-ship-${shipmentId}`);
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/shipments/${shipmentId}/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manualManaged: true,
          markShipped: true,
          trackingNumber,
          carrierFinal: carrierFinal || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data?.error ?? "Manual ship failed");
      setOpsLog(JSON.stringify(data, null, 2));
      if (selectedOrderId) await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const setShipmentArchived = async (shipmentId: string, archived: boolean) => {
    setBusy(`archive-${shipmentId}`);
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/shipments/${shipmentId}/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data?.error ?? "Archive update failed");
      setOpsLog(JSON.stringify(data, null, 2));
      if (selectedOrderId) await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const generateDocsForShipment = async (shipmentId: string) => {
    setBusy(`docs-${shipmentId}`);
    setError(null);
    setOpsLog(null);
    try {
      const force = Boolean(forceShipmentDocs[shipmentId]);
      const response = await fetch(
        `/api/galaxus/shipments/${shipmentId}/docs${force ? "?force=1" : ""}`,
        {
        method: "POST",
        }
      );
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to generate shipment docs");
      setOpsLog(JSON.stringify(data, null, 2));
      if (selectedOrderId) await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const regenerateLabel = async (shipmentId: string) => {
    setBusy(`label-${shipmentId}`);
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/shipments/${shipmentId}/label`, {
        method: "POST",
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Label generation failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Galaxus Supplier Dashboard</h1>
        <p className="text-sm text-gray-500">
          Preview supplier data, sync to DB, and inspect saved variants.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a
            className="inline-flex items-center rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white"
            href="/galaxus/pricing"
          >
            Pricing overrides
          </a>
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="space-y-4 border rounded p-4 bg-white">
        <div>
          <h2 className="text-lg font-semibold">Galaxus Ops Dashboard</h2>
          <p className="text-sm text-gray-500">Run the full flow without the terminal.</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded border bg-gray-50 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Operations</div>
              <div className="text-xs text-gray-500">Auto-feed sending: OFF</div>
            </div>
            <div className="rounded border bg-white p-2 text-xs text-gray-600 space-y-1">
              <div>Partner stock sync every 5 hours</div>
              <div>StockX/Kicks refresh every 24 hours</div>
              <div>EDI IN order polling every 1 hour</div>
              {opsStatus?.feeds?.running ? (
                <div className="text-amber-600">Feed push is running</div>
              ) : null}
            </div>

            <div className="rounded border bg-white p-2 text-xs text-gray-600 space-y-2">
              <div className="text-xs font-medium text-gray-700">Active jobs / schedules</div>
              {Array.isArray(opsStatus?.jobs) && opsStatus.jobs.length > 0 ? (
                <div className="space-y-2">
                  {opsStatus.jobs.map((job: any) => (
                    <div key={job.jobKey} className="border-b last:border-b-0 pb-2">
                      <div className="flex items-center justify-between">
                        <div>{opsJobLabels[job.jobKey] ?? job.jobKey}</div>
                        <div className="text-gray-500">{job.enabled ? "Enabled" : "Disabled"}</div>
                      </div>
                      <div className="text-gray-500">
                        Last run:{" "}
                        {job.lastRun
                          ? `${formatTime(job.lastRun.startedAt)} · ${job.lastRun.success ? "OK" : "FAIL"}`
                          : "—"}
                      </div>
                      <div className="text-gray-500">Next run: {formatTime(job.nextRunAt)}</div>
                      {job.lastRun?.errorMessage ? (
                        <div className="text-red-600">Last error: {job.lastRun.errorMessage}</div>
                      ) : null}
                      {job.lastRun?.resultJson ? (
                        <div className="text-gray-500">
                          Counts: {summarizeJobResult(job.lastRun.resultJson)}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div>—</div>
              )}
            </div>

            <div className="rounded border bg-white p-2 text-xs text-gray-600 space-y-2">
              <div className="text-xs font-medium text-gray-700">Feed pipeline status</div>
              <div>
                Last stock + price:{" "}
                {opsStatus?.feeds?.lastStockPrice
                  ? `${formatTime(opsStatus.feeds.lastStockPrice.startedAt)} · ${
                      opsStatus.feeds.lastStockPrice.success ? "OK" : "FAIL"
                    }`
                  : "—"}
              </div>
              {opsStatus?.feeds?.lastStockPrice?.triggerSource ? (
                <div>Stock + price trigger: {opsStatus.feeds.lastStockPrice.triggerSource}</div>
              ) : null}
              {opsStatus?.feeds?.lastStockPrice?.countsJson ? (
                <div>Stock + price counts: {JSON.stringify(opsStatus.feeds.lastStockPrice.countsJson)}</div>
              ) : null}
              <div>
                Last full push:{" "}
                {opsStatus?.feeds?.lastFull
                  ? `${formatTime(opsStatus.feeds.lastFull.startedAt)} · ${
                      opsStatus.feeds.lastFull.success ? "OK" : "FAIL"
                    }`
                  : "—"}
              </div>
              {opsStatus?.feeds?.lastFull?.triggerSource ? (
                <div>Full push trigger: {opsStatus.feeds.lastFull.triggerSource}</div>
              ) : null}
              {opsStatus?.feeds?.lastFull?.countsJson ? (
                <div>Full push counts: {JSON.stringify(opsStatus.feeds.lastFull.countsJson)}</div>
              ) : null}
              <div>
                Last master: {formatTime(opsStatus?.feeds?.lastManifests?.master?.createdAt)} ·{" "}
                {opsStatus?.feeds?.lastManifests?.master?.uploadStatus ?? "—"}
              </div>
              <div>
                Last offer: {formatTime(opsStatus?.feeds?.lastManifests?.offer?.createdAt)} ·{" "}
                {opsStatus?.feeds?.lastManifests?.offer?.uploadStatus ?? "—"}
              </div>
              <div>
                Last stock: {formatTime(opsStatus?.feeds?.lastManifests?.stock?.createdAt)} ·{" "}
                {opsStatus?.feeds?.lastManifests?.stock?.uploadStatus ?? "—"}
              </div>
              <div>
                Last specs: {formatTime(opsStatus?.feeds?.lastManifests?.specs?.createdAt)} ·{" "}
                {opsStatus?.feeds?.lastManifests?.specs?.uploadStatus ?? "—"}
              </div>
              {opsStatus?.feeds?.lastManifests?.master?.validationIssuesJson ? (
                <div>
                  Master validation issues:{" "}
                  {JSON.stringify(
                    opsStatus.feeds.lastManifests.master.validationIssuesJson.summary ?? {}
                  )}
                </div>
              ) : null}
              {opsStatus?.feeds?.lastManifests?.offer?.validationIssuesJson ? (
                <div>
                  Offer validation issues:{" "}
                  {JSON.stringify(
                    opsStatus.feeds.lastManifests.offer.validationIssuesJson.summary ?? {}
                  )}
                </div>
              ) : null}
              {opsStatus?.feeds?.lastManifests?.stock?.validationIssuesJson ? (
                <div>
                  Stock validation issues:{" "}
                  {JSON.stringify(
                    opsStatus.feeds.lastManifests.stock.validationIssuesJson.summary ?? {}
                  )}
                </div>
              ) : null}
            </div>

            <details className="rounded border bg-white p-2 text-xs text-gray-600 group">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-gray-700 [&::-webkit-details-marker]:hidden">
                <span className="font-medium text-gray-800">Order alerts</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-right text-[10px] text-gray-500 sm:text-[11px]">
                    Ingested {opsStatus?.orders?.totalIngested ?? "—"} · Missing{" "}
                    <span className="text-amber-700 font-semibold">
                      {opsStatus?.orders?.ordrMissing ?? "—"}
                    </span>
                  </span>
                  <span className="shrink-0 text-gray-400 transition-transform group-open:rotate-180">▼</span>
                </span>
              </summary>
              <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
                <div>Orders ingested: {opsStatus?.orders?.totalIngested ?? "—"}</div>
                <div>ORDR sent: {opsStatus?.orders?.ordrSent ?? "—"}</div>
                <div className="text-amber-700 font-semibold">
                  Missing ORDR: {opsStatus?.orders?.ordrMissing ?? "—"}
                </div>
                <div className="text-red-600 font-semibold">
                  ORDR failed: {opsStatus?.orders?.ordrFailed ?? "—"}
                </div>
                {Array.isArray(opsStatus?.orders?.recent) && opsStatus.orders.recent.length > 0 ? (
                  <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                    {opsStatus.orders.recent.slice(0, 8).map((order: any) => (
                      <div key={order.id} className="border-b border-gray-100 pb-1 last:border-b-0">
                        <div className="flex items-center justify-between">
                          <div className="font-medium">{order.galaxusOrderId}</div>
                          <div className="text-gray-500">{order.ordrStatus ?? "—"}</div>
                        </div>
                        <div className="text-gray-500">
                          Ingested: {formatTime(order.ingestedAt ?? order.orderDate)}
                        </div>
                        {order.source ? (
                          <div className="text-gray-500">Source: {order.source}</div>
                        ) : null}
                        {order.ordrLastError ? (
                          <div className="text-red-600">Error: {order.ordrLastError}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>—</div>
                )}
              </div>
            </details>

            <div className="rounded border bg-white p-2 text-xs text-gray-600 space-y-2">
              <div className="text-xs font-medium text-gray-700">Manual actions</div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="px-3 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
                  onClick={() => runOpsAction("partner-sync")}
                  disabled={opsBusy !== null}
                >
                  {opsBusy === "ops-partner-sync" ? "Running…" : "Run partner sync now"}
                </button>
                <button
                  className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                  onClick={() => runOpsAction("stx-refresh")}
                  disabled={opsBusy !== null}
                >
                  {opsBusy === "ops-stx-refresh" ? "Running…" : "Run StockX/Kicks refresh now"}
                </button>
                <button
                  className="px-3 py-2 rounded bg-gray-900 text-white disabled:opacity-50"
                  onClick={() => runOpsAction("edi-in")}
                  disabled={opsBusy !== null}
                >
                  {opsBusy === "ops-edi-in" ? "Polling…" : "Poll EDI IN now"}
                </button>
                <button
                  className="px-3 py-2 rounded bg-violet-600 text-white disabled:opacity-50"
                  onClick={() => runOpsAction("push-stock")}
                  disabled={opsBusy !== null}
                >
                  {opsBusy === "ops-push-stock" ? "Pushing…" : "Push stock now"}
                </button>
                <button
                  className="px-3 py-2 rounded bg-violet-700 text-white disabled:opacity-50"
                  onClick={() => runOpsAction("push-price")}
                  disabled={opsBusy !== null}
                >
                  {opsBusy === "ops-push-price" ? "Pushing…" : "Push price now"}
                </button>
                <button
                  className="px-3 py-2 rounded bg-fuchsia-600 text-white disabled:opacity-50"
                  onClick={() => runOpsAction("push-master-specs")}
                  disabled={opsBusy !== null}
                >
                  {opsBusy === "ops-push-master-specs" ? "Pushing…" : "Push master + specs now"}
                </button>
                <button
                  className="px-3 py-2 rounded bg-indigo-700 text-white disabled:opacity-50"
                  onClick={() => runOpsAction("image-sync")}
                  disabled={opsBusy !== null}
                >
                  {opsBusy === "ops-image-sync" ? "Syncing…" : "Run image sync now"}
                </button>
                <button
                  className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
                  onClick={() => fetchOrders(0)}
                  disabled={busy !== null}
                >
                  {busy === "orders" ? "Loading…" : "Refresh Orders"}
                </button>
                <button
                  className="px-3 py-2 rounded bg-violet-600 text-white disabled:opacity-50"
                  onClick={connectGalaxusStockxAccount}
                  disabled={busy !== null}
                >
                  {busy === "stx-login" ? "Logging in…" : "StockX Login (Galaxus)"}
                </button>
              </div>
              <details className="rounded border bg-gray-50 p-2">
                <summary className="cursor-pointer text-xs font-medium">Feed tools</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
                    onClick={() => downloadFeed("product")}
                    disabled={busy !== null}
                  >
                    Download Master
                  </button>
                  <button
                    className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
                    onClick={() => downloadFeed("price")}
                    disabled={busy !== null}
                  >
                    Download Offer
                  </button>
                  <button
                    className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
                    onClick={() => downloadFeed("stock")}
                    disabled={busy !== null}
                  >
                    Download Stock
                  </button>
                  <button
                    className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
                    onClick={() => downloadFeed("specs")}
                    disabled={busy !== null}
                  >
                    Download Specs
                  </button>
                </div>
              </details>
              <details className="rounded border bg-gray-50 p-2">
                <summary className="cursor-pointer text-xs font-medium">Feed validation</summary>
                <div className="mt-2 space-y-2 text-xs text-gray-600">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="px-3 py-2 rounded bg-gray-900 text-white disabled:opacity-50"
                      onClick={loadFeedValidation}
                      disabled={feedValidationBusy}
                    >
                      {feedValidationBusy ? "Checking…" : "Run validation now"}
                    </button>
                    {feedValidation?.summary ? (
                      <span>
                        Master rows: {feedValidation.summary.master?.totalRows ?? "—"} · Stock rows:{" "}
                        {feedValidation.summary.stock?.totalRows ?? "—"} · Specs rows:{" "}
                        {feedValidation.summary.specs?.totalRows ?? "—"}
                      </span>
                    ) : null}
                  </div>
                  {feedValidation?.grouped ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {["master", "stock", "specs"].map((key) => {
                        const rows = buildValidationDisplay(feedValidation.grouped?.[key] ?? []);
                        return (
                          <div key={key} className="rounded border bg-white p-2">
                            <div className="font-medium text-gray-700 mb-1 capitalize">{key} issues</div>
                            {rows.length === 0 ? (
                              <div>—</div>
                            ) : (
                              <div className="space-y-1">
                                {rows.slice(0, 15).map((row) => (
                                  <div key={`${key}-${row.message}`} className="space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="truncate pr-2">{row.message}</span>
                                      <span className="text-gray-500">{row.count}</span>
                                    </div>
                                    {row.samples?.length ? (
                                      <div className="text-[11px] text-gray-500 break-all">
                                        e.g. {row.samples.join(", ")}
                                      </div>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-gray-500">No validation report loaded.</div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
                      onClick={() =>
                        window.open(
                          "/api/galaxus/export/check-all?all=1&download=1",
                          "_blank",
                          "noopener,noreferrer"
                        )
                      }
                      disabled={feedValidationBusy}
                    >
                      Download issues CSV
                    </button>
                    <button
                      className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
                      onClick={() => backfillMappingGtins(false)}
                      disabled={busy !== null}
                    >
                      Preview GTIN backfill
                    </button>
                    <button
                      className="px-3 py-2 rounded bg-amber-600 text-white disabled:opacity-50"
                      onClick={() => backfillMappingGtins(true)}
                      disabled={busy !== null}
                    >
                      Apply GTIN backfill
                    </button>
                  </div>
                </div>
              </details>
            </div>
          </div>
          <div className="rounded border bg-gray-50 p-3 space-y-3">
            <div className="text-sm font-medium">Catalog & Feeds</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="px-3 py-2 rounded-md bg-slate-100 text-slate-900 disabled:opacity-50"
                onClick={loadExportCounts}
                disabled={busy !== null}
              >
                Refresh export stats
              </button>
                <span className="text-xs text-slate-500">
                  DB rows: {exportCounts?.supplierVariantsTotal ?? "—"} · Exportable:{" "}
                  {exportCounts?.exportRowsAfterInvariants ?? "—"}
                </span>
            </div>
            <div className="rounded border bg-white p-2 space-y-2">
              <div className="text-xs font-medium text-gray-700">STX Product Import (Testing)</div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="px-2 py-2 border rounded text-sm w-72"
                  value={stxImportInput}
                  onChange={(event) => setStxImportInput(event.target.value)}
                  placeholder="StockX slug or URL"
                  disabled={busy !== null}
                />
                <button
                  className="px-3 py-2 rounded bg-violet-600 text-white disabled:opacity-50"
                  onClick={importStxProduct}
                  disabled={busy !== null || !stxImportInput.trim()}
                >
                  {busy === "stx-import" ? "Importing…" : "Import STX product"}
                </button>
              </div>
              {stxImportResult && (
                <div className="text-xs text-gray-700 space-y-1">
                  <div>
                    Imported variants: {stxImportResult.importedVariantsCount} · Eligible variants:{" "}
                    {stxImportResult.eligibleVariantsCount}
                  </div>
                  {stxImportResult.productSummary?.name ? (
                    <div>
                      Product: {stxImportResult.productSummary.name}
                      {stxImportResult.productSummary.brand
                        ? ` (${stxImportResult.productSummary.brand})`
                        : ""}
                    </div>
                  ) : null}
                  {stxImportResult.warnings?.length ? (
                    <div>Warnings: {stxImportResult.warnings.join(" | ")}</div>
                  ) : null}
                  {stxImportResult.errors?.length ? (
                    <div className="text-red-600">Errors: {stxImportResult.errors.join(" | ")}</div>
                  ) : null}
                  {stxImportResult.variantsPreview?.length ? (
                    <div className="overflow-auto border rounded">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-1 text-left">Variant</th>
                            <th className="px-2 py-1 text-left">Size</th>
                            <th className="px-2 py-1 text-left">Delivery</th>
                            <th className="px-2 py-1 text-right">Price</th>
                            <th className="px-2 py-1 text-right">Stock</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stxImportResult.variantsPreview.slice(0, 5).map((row) => (
                            <tr key={row.supplierVariantId} className="border-t">
                              <td className="px-2 py-1">{row.supplierVariantId}</td>
                              <td className="px-2 py-1">{row.size ?? ""}</td>
                              <td className="px-2 py-1">{row.deliveryType}</td>
                              <td className="px-2 py-1 text-right">{row.price}</td>
                              <td className="px-2 py-1 text-right">{row.stock}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <div className="rounded border bg-white p-2 space-y-2">
              <div className="text-xs font-medium text-gray-700">STX slugs/URLs (one per line)</div>
              <textarea
                className="w-full border rounded text-sm p-2 min-h-[90px]"
                value={stxSlugInput}
                onChange={(event) => setStxSlugInput(event.target.value)}
                placeholder="Paste StockX slugs or URLs here, one per line"
                disabled={busy !== null}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="px-3 py-2 rounded bg-slate-700 text-white disabled:opacity-50"
                  onClick={saveStxSlugs}
                  disabled={busy !== null || !stxSlugInput.trim()}
                >
                  {busy === "stx-slug-save" ? "Saving…" : "Save"}
                </button>
                <button
                  className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
                  onClick={syncFirstStxSlugs}
                  disabled={busy !== null}
                >
                  {busy === "stx-slug-sync" ? "Syncing…" : "Sync first 50 STX slugs"}
                </button>
                <span className="text-xs text-gray-500">
                  Pending: {stxSlugCounts?.pending ?? "—"} · Imported: {stxSlugCounts?.imported ?? "—"} · Error:{" "}
                  {stxSlugCounts?.error ?? "—"}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="px-2 py-2 border rounded text-sm w-72"
                value={enrichSku}
                onChange={(event) => setEnrichSku(event.target.value)}
                placeholder="Enrich single supplier SKU (debug)"
                disabled={busy !== null}
              />
              <button
                className="px-3 py-2 rounded bg-orange-600 text-white disabled:opacity-50"
                onClick={enrichSingleSku}
                disabled={busy !== null || !enrichSku.trim()}
              >
                {busy === "enrich-single" ? "Checking…" : "Enrich Single SKU"}
              </button>
              <button
                className="px-3 py-2 rounded bg-slate-800 text-white disabled:opacity-50"
                onClick={reEnrichPending}
                disabled={busy !== null}
              >
                {busy === "enrich-pending" ? "Re-enriching…" : "Re-enrich PENDING"}
              </button>
              <button
                className="px-3 py-2 rounded bg-slate-900 text-white disabled:opacity-50"
                onClick={reEnrichNotFound}
                disabled={busy !== null}
              >
                {busy === "enrich-not-found" ? "Re-enriching…" : "Re-enrich NOT_FOUND"}
              </button>
              <span className="text-xs text-gray-500">
                Pending: {exportCounts?.pendingGtin ?? "—"} · Not found: {exportCounts?.notFoundGtin ?? "—"}
              </span>
              <span className="text-xs text-gray-500">
                Pending last run:{" "}
                {exportCounts?.enrichPendingAt
                  ? new Date(exportCounts.enrichPendingAt).toLocaleString()
                  : "—"}
                {" · "}
                Not found last run:{" "}
                {exportCounts?.enrichNotFoundAt
                  ? new Date(exportCounts.enrichNotFoundAt).toLocaleString()
                  : "—"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="px-3 py-2 rounded bg-gray-200 text-black disabled:opacity-50"
                onClick={() => loadMappings(0)}
                disabled={busy !== null}
              >
                {busy === "db-mappings" ? "Loading…" : "Load DB mappings"}
              </button>
              <button
                className="px-3 py-2 rounded bg-gray-200 text-black disabled:opacity-50"
                onClick={downloadMappings}
                disabled={busy !== null}
              >
                Download DB mappings (CSV)
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Orders</div>
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <span>Unassigned lines: {unassignedCount ?? "—"}</span>
            <a className="underline" href="/galaxus/routing-issues">
              View routing issues
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">View</span>
            <button
              className={`px-3 py-2 rounded text-sm ${
                orderView === "active" ? "bg-gray-800 text-white" : "bg-gray-100 text-black"
              }`}
              onClick={() => setOrderView("active")}
              disabled={busy !== null}
            >
              Active
            </button>
            <button
              className={`px-3 py-2 rounded text-sm ${
                orderView === "history" ? "bg-gray-800 text-white" : "bg-gray-100 text-black"
              }`}
              onClick={() => setOrderView("history")}
              disabled={busy !== null}
            >
              History
            </button>
          </div>
          <div className="overflow-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1 text-left">Order ID</th>
                  <th className="px-2 py-1 text-left">Delivery Type</th>
                  <th className="px-2 py-1 text-right">Lines</th>
                  <th className="px-2 py-1 text-right" title="Parcels marked shipped / total parcels (tracking alone does not count)">
                    Dispatched
                  </th>
                  <th className="px-2 py-1 text-left">ORDR</th>
                  <th className="px-2 py-1 text-left">Shipping</th>
                  <th className="px-2 py-1 text-left">Order Status</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-t">
                    <td className="px-2 py-1">
                      <div className="font-medium">{order.galaxusOrderId}</div>
                      <div className="text-xs text-gray-500">{order.orderNumber ?? "—"}</div>
                    </td>
                    <td className="px-2 py-1">{order.deliveryType ?? ""}</td>
                    <td className="px-2 py-1 text-right">{order._count.lines}</td>
                    <td className="px-2 py-1 text-right">
                      {order.shippedCount ?? 0}/{order._count.shipments}
                    </td>
                    <td className="px-2 py-1">
                      {order.ordrSentAt ? new Date(order.ordrSentAt).toLocaleString() : "Pending"}
                    </td>
                    <td className="px-2 py-1">
                      {resolveShippingStatus(order.shippedCount ?? 0, order._count.shipments)}
                    </td>
                    <td className="px-2 py-1">{resolveOrderStatus(order)}</td>
                    <td className="px-2 py-1 text-right align-top">
                      <details className="relative inline-block text-left">
                        <summary className="cursor-pointer list-none rounded border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-800 shadow-sm hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
                          Actions ▾
                        </summary>
                        <div className="absolute right-0 z-30 mt-1 min-w-[11rem] rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-xs hover:bg-gray-50 disabled:opacity-50"
                            disabled={busy !== null}
                            onClick={(e) => {
                              closeRowActionsMenu(e.currentTarget);
                              void loadOrderDetail(order.id);
                            }}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-xs text-green-800 hover:bg-green-50 disabled:opacity-50"
                            disabled={
                              busy !== null ||
                              Boolean(order.archivedAt) ||
                              Boolean(order.cancelledAt) ||
                              Boolean(order.ordrSentAt)
                            }
                            onClick={(e) => {
                              closeRowActionsMenu(e.currentTarget);
                              void sendOrdrForOrder(order.id);
                            }}
                          >
                            {busy === `ordr-${order.id}` ? "Sending ORDR…" : "Send ORDR"}
                          </button>
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-xs hover:bg-gray-50 disabled:opacity-50"
                            disabled={
                              busy !== null ||
                              Boolean(order.archivedAt) ||
                              Boolean(order.cancelledAt) ||
                              (order._count.shipments > 0
                                ? (order.shippedCount ?? 0) < order._count.shipments
                                : true)
                            }
                            onClick={(e) => {
                              closeRowActionsMenu(e.currentTarget);
                              void archiveOrderById(order.id);
                            }}
                          >
                            {busy === `archive-${order.id}` ? "Archiving…" : "Archive"}
                          </button>
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                            disabled={busy !== null || Boolean(order.archivedAt) || Boolean(order.cancelledAt)}
                            onClick={(e) => {
                              closeRowActionsMenu(e.currentTarget);
                              void cancelOrderById(order.id);
                            }}
                          >
                            {busy === `cancel-${order.id}` ? "Cancelling…" : "Cancel"}
                          </button>
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td className="px-2 py-3 text-gray-500" colSpan={8}>
                      No orders loaded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {ordersNextOffset !== null && (
            <button
              className="px-3 py-2 rounded bg-gray-100 text-black"
              onClick={() => fetchOrders(ordersNextOffset)}
              disabled={busy !== null}
            >
              Load More Orders
            </button>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">Order Detail</div>
            {(selectedOrderId || selectedOrder) && (
              <button
                type="button"
                className="shrink-0 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 shadow-sm hover:bg-gray-50"
                onClick={closeOrderView}
              >
                Close
              </button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <div className="text-xs text-gray-500">
              Selected order:{" "}
              <span className="font-mono">{selectedOrder?.galaxusOrderId ?? "—"}</span>{" "}
              {selectedOrder?.id ? <span className="text-gray-400">({selectedOrder.id})</span> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">Status: {selectedOrderStatus}</span>
              <span className="text-xs text-gray-500">Shipping: {selectedShippingStatus}</span>
              <button
                className="px-3 py-2 rounded bg-green-600 text-white disabled:opacity-50"
                onClick={sendOrdr}
                disabled={busy !== null || orderGalaxusLocked || !canSendOrdrSelected}
              >
                {busy === `ordr-${selectedOrderId}` ? "Sending…" : "Send ORDR"}
              </button>
              <button
                className="px-3 py-2 rounded bg-slate-700 text-white disabled:opacity-50"
                onClick={() => archiveOrderById(selectedOrderId)}
                disabled={busy !== null || !canArchiveSelected}
              >
                {busy === `archive-${selectedOrderId}` ? "Archiving…" : "Archive"}
              </button>
              <button
                className="px-3 py-2 rounded bg-red-600 text-white disabled:opacity-50"
                onClick={() => cancelOrderById(selectedOrderId)}
                disabled={busy !== null || !canCancelSelected}
              >
                {busy === `cancel-${selectedOrderId}` ? "Cancelling…" : "Cancel"}
              </button>
              {selectedOrder?.stx?.hasStxItems ? (
                <button
                  className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
                  onClick={syncStockxOrdersForOrder}
                  disabled={busy !== null}
                >
                  {busy === "stx-sync-order" ? "Syncing…" : "Sync StockX orders"}
                </button>
              ) : null}
            </div>
          </div>

          {selectedOrder && (
            <div className="space-y-3 border rounded p-3 bg-gray-50">
              <div className="text-xs text-gray-600">
                {selectedOrder.galaxusOrderId} · {selectedOrder.orderNumber ?? "—"} ·{" "}
                {selectedOrder.deliveryType ?? "—"}
              </div>
              {selectedOrder.cancelledAt ? (
                <div className="text-xs text-red-600">
                  Cancelled: {formatTime(selectedOrder.cancelledAt)}
                  {selectedOrder.cancelReason ? ` · ${selectedOrder.cancelReason}` : ""}
                </div>
              ) : null}
              {selectedOrder.archivedAt ? (
                <div className="text-xs text-gray-500">Archived: {formatTime(selectedOrder.archivedAt)}</div>
              ) : null}

              <div className="border rounded bg-white p-2 text-xs">
                <div className="font-medium text-gray-700 mb-1">Run checklist</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    Ingest: {selectedOrder.lines.length > 0 ? "OK" : "Missing lines"}
                  </div>
                  <div>
                    ORDR:{" "}
                    {selectedOrder.ordrSentAt || hasEdiFile("ORDR") ? "Sent" : "Not sent"}
                  </div>
                  <div>
                    Shipping: {selectedShippingStatus} ({shippedCount}/{totalShipments || 0} dispatched)
                    {parcelsWithTrackingOnly > 0 ? (
                      <span className="block text-amber-700 mt-0.5">
                        {parcelsWithTrackingOnly} parcel(s) have tracking but no ship confirmation (not counted as
                        shipped).
                      </span>
                    ) : null}
                  </div>
                  <div>
                    DELR: {delrUploadedCount}/{totalShipments || 0}{" "}
                    {delrUploadedCount > 0 ? "Uploaded" : "Pending"}
                  </div>
                  <div>
                    Status: {selectedOrderStatus}
                  </div>
                  <div>
                    Archived: {selectedOrder.archivedAt ? formatTime(selectedOrder.archivedAt) : "No"}
                  </div>
                  <div>
                    Cancelled: {selectedOrder.cancelledAt ? formatTime(selectedOrder.cancelledAt) : "No"}
                  </div>
                </div>
              </div>

              <div className="border rounded bg-white p-2 text-xs">
                <div className="font-medium text-gray-700 mb-1">Invoice XML</div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                  <span>
                    Selected{" "}
                    {selectedOrder.lines.filter((line) => Boolean(invoiceLineSelection[line.id])).length}/
                    {selectedOrder.lines.length}
                  </span>
                  <button
                    className="px-2 py-1 rounded bg-gray-100 text-black disabled:opacity-50"
                    onClick={() => setAllInvoiceLines(true)}
                    disabled={invoiceBusy}
                  >
                    Select all
                  </button>
                  <button
                    className="px-2 py-1 rounded bg-gray-100 text-black disabled:opacity-50"
                    onClick={() => setAllInvoiceLines(false)}
                    disabled={invoiceBusy}
                  >
                    Clear
                  </button>
                </div>
                <div className="mt-2 max-h-40 overflow-auto border rounded">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-1 text-left">Send</th>
                        <th className="px-2 py-1 text-left">Line</th>
                        <th className="px-2 py-1 text-left">Product</th>
                        <th className="px-2 py-1 text-right">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.lines.map((line) => (
                        <tr key={line.id} className="border-t">
                          <td className="px-2 py-1">
                            <input
                              type="checkbox"
                              checked={Boolean(invoiceLineSelection[line.id])}
                              onChange={() => toggleInvoiceLine(line.id)}
                              disabled={invoiceBusy}
                            />
                          </td>
                          <td className="px-2 py-1">{line.lineNumber}</td>
                          <td className="px-2 py-1">
                            {resolveProductNameForGtin(line.gtin) || line.productName}
                          </td>
                          <td className="px-2 py-1 text-right">{line.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
                    onClick={sendInvoiceXml}
                    disabled={invoiceBusy}
                  >
                    {invoiceBusy ? "Sending…" : "Send INVO XML"}
                  </button>
                  <button
                    className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
                    onClick={downloadInvoiceXml}
                    disabled={invoiceBusy}
                  >
                    Download INVO XML
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-gray-500">
                  Uses the OpenTrans INVOICE XML template (per selected lines).
                </div>
              </div>

              {selectedOrder.stx?.hasStxItems ? (
                <div className="border rounded bg-white p-2 text-xs">
                  <div className="font-medium text-gray-700 mb-2">StockX health</div>
                  {(() => {
                    const buckets = selectedOrder.stx?.buckets ?? [];
                    const totals = buckets.reduce(
                      (acc, bucket) => {
                        acc.needed += bucket.needed;
                        acc.linked += bucket.linked;
                        acc.linkedWithEta += bucket.linkedWithEta;
                        acc.linkedWithAwb += bucket.linkedWithAwb;
                        return acc;
                      },
                      { needed: 0, linked: 0, linkedWithEta: 0, linkedWithAwb: 0 }
                    );
                    const pending = Math.max(0, totals.needed - totals.linked);
                    const missingEta = Math.max(0, totals.linked - totals.linkedWithEta);
                    const missingAwb = Math.max(0, totals.linked - totals.linkedWithAwb);
                    const cancelled = (selectedOrder.stxUnits ?? []).filter((u) => Boolean(u?.cancelledAt)).length;
                    return (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div>
                          Linked: {totals.linked}/{totals.needed} · Pending {pending}
                        </div>
                        <div>
                          Missing ETA: {missingEta} · Missing AWB: {missingAwb}
                        </div>
                        <div>
                          Buckets OK: {selectedOrder.stx?.allLinked ? "✅" : "❌"} · ETA OK:{" "}
                          {selectedOrder.stx?.allEtaPresent ? "✅" : "❌"} · AWB OK:{" "}
                          {selectedOrder.stx?.allAwbPresent ? "✅" : "❌"}
                        </div>
                        <div>Cancelled units: {cancelled}</div>
                      </div>
                    );
                  })()}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      className="px-2 py-1 rounded bg-green-600 text-white disabled:opacity-50"
                      onClick={syncStockxOrdersForOrder}
                      disabled={busy !== null}
                    >
                      {busy === "stx-sync-order" ? "Syncing…" : "Re-sync STX"}
                    </button>
                    <button
                      className="px-2 py-1 rounded bg-slate-100 text-black disabled:opacity-50"
                      onClick={recomputeStxBucketsForOrder}
                      disabled={busy !== null}
                    >
                      {busy === "stx-recompute" ? "Recomputing…" : "Recompute buckets"}
                    </button>
                    <button
                      className="px-2 py-1 rounded bg-orange-100 text-orange-800 disabled:opacity-50"
                      onClick={unlockPartialDispatchForStx}
                      disabled={busy !== null}
                    >
                      Unlock partial dispatch
                    </button>
                  </div>
                </div>
              ) : null}

              {selectedOrder.shipments.length === 0 ? (
                <div className="overflow-auto border rounded bg-white">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-1 text-left">Line</th>
                        <th className="px-2 py-1 text-left">Product</th>
                        <th className="px-2 py-1 text-left">Size</th>
                        <th className="px-2 py-1 text-left">Supplier SKU</th>
                        <th className="px-2 py-1 text-left">Supplier PID</th>
                        <th className="px-2 py-1 text-left">Stock</th>
                        <th className="px-2 py-1 text-right">Qty</th>
                        <th className="px-2 py-1 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.lines.map((line) => (
                        <tr key={line.id} className="border-t">
                          <td className="px-2 py-1">{line.lineNumber}</td>
                          <td className="px-2 py-1">
                            {resolveProductNameForGtin(line.gtin) || line.productName}
                          </td>
                          <td className="px-2 py-1">{resolveSizeForGtin(line.gtin) || line.size || ""}</td>
                          <td className="px-2 py-1">{resolveSkuForGtin(line.gtin) || line.supplierSku || ""}</td>
                          <td className="px-2 py-1">{line.supplierPid ?? ""}</td>
                          <td className="px-2 py-1">
                            {(() => {
                              const stock = lineStockById[line.id];
                              if (!stock) return "—";
                              if (stock.status === "NO_VARIANT") {
                                if (stock.noResponseReason === "TRM_SKU_NOT_FOUND") {
                                  return "TRM not found";
                                }
                                return "No variant";
                              }
                              if (stock.status === "UNKNOWN") return "Unknown";
                              const label = stock.status === "OK" ? "OK" : "Out";
                              const qty = stock.stock ?? 0;
                              return `${label} (${qty})`;
                            })()}
                          </td>
                          <td className="px-2 py-1 text-right">{line.quantity}</td>
                          <td className="px-2 py-1 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                className="px-2 py-1 rounded bg-slate-100 text-black disabled:opacity-50"
                                onClick={() => checkLineStock(line)}
                                disabled={busy !== null}
                              >
                                {busy === `line-stock-${line.id}` ? "Checking…" : "Check stock"}
                              </button>
                              <button
                                className="px-2 py-1 rounded bg-slate-100 text-black disabled:opacity-50"
                                onClick={() => openManualFulfillForLine(line)}
                                disabled={busy !== null}
                              >
                                Manual override…
                              </button>
                              <button
                                className="px-2 py-1 rounded bg-red-600 text-white disabled:opacity-50"
                                onClick={() => removeOrderLine(line)}
                                disabled={busy !== null}
                              >
                                {busy === `line-remove-${line.id}` ? "Removing…" : "Remove"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs text-gray-500">
                    Shipments detected. Package tables only list{" "}
                    <span className="font-medium">Galaxus dispatch line items</span> — a StockX bucket can still show 4
                    linked units while only 3 GTINs appear on the STX parcel if one line is missing from the manifest.
                  </div>
                  <details className="overflow-auto border rounded bg-white text-xs">
                    <summary className="cursor-pointer select-none bg-gray-50 px-2 py-1 font-medium">
                      All Galaxus order lines ({selectedOrder.lines.length})
                    </summary>
                    <table className="min-w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-1 text-left">#</th>
                          <th className="px-2 py-1 text-left">Channel</th>
                          <th className="px-2 py-1 text-left">Product</th>
                          <th className="px-2 py-1 text-left">GTIN</th>
                          <th className="px-2 py-1 text-right">Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedOrder.lines.map((line) => (
                          <tr key={line.id} className="border-t">
                            <td className="px-2 py-1">{line.lineNumber}</td>
                            <td className="px-2 py-1">{isStxOrderLine(line) ? "StockX" : "Other supplier"}</td>
                            <td className="px-2 py-1">
                              {resolveProductNameForGtin(line.gtin) || line.productName}
                            </td>
                            <td className="px-2 py-1 font-mono text-[11px]">{line.gtin ?? "—"}</td>
                            <td className="px-2 py-1 text-right">{line.quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </div>
              )}

              {/* StockX bucket linking is now displayed inside each STX shipment card. */}

              {stxManualModalOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-2xl rounded bg-white p-4 space-y-3 shadow">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">Manual StockX override</div>
                      <button
                        className="px-2 py-1 rounded bg-slate-100 text-black"
                        onClick={() => setStxManualModalOpen(false)}
                        disabled={busy !== null}
                      >
                        Close
                      </button>
                    </div>

                    <div className="text-xs text-gray-600">
                      {(() => {
                        const bucket = selectedOrder?.stx?.buckets?.find(
                          (b) => b.supplierVariantId === stxManualVariantId
                        );
                        if (!bucket) return `Variant: ${stxManualVariantId || "—"}`;
                        const product = resolveProductNameForGtin(bucket.gtin) || "";
                        const size = resolveSizeForGtin(bucket.gtin) || "";
                        const sku = resolveSkuForGtin(bucket.gtin) || "";
                        return `Variant: ${bucket.supplierVariantId} · ${product}${product ? " · " : ""}${size}${
                          size ? " · " : ""
                        }${sku}${sku ? " · " : ""}GTIN ${bucket.gtin} · Need ${bucket.needed} · Linked ${bucket.linked}`;
                      })()}
                    </div>

                    {(() => {
                      const units = Array.isArray(selectedOrder?.stxUnits) ? selectedOrder?.stxUnits : [];
                      const linked = units
                        .filter((u) => String(u?.supplierVariantId ?? "") === stxManualVariantId)
                        .filter((u) => Boolean(u?.stockxOrderId));
                      if (linked.length === 0) return null;
                      const preview = linked.slice(0, 3);
                      return (
                        <div className="text-[11px] text-gray-500 space-y-1">
                          <div className="font-medium text-gray-600">Existing linked unit(s)</div>
                          {preview.map((u) => (
                            <div key={u.id}>
                              {u.stockxOrderId}
                              {u.cancelledAt ? " · cancelled" : ""}
                              {u.awb ? ` · AWB ${u.awb}` : ""}
                              {u.etaMin ? ` · ETA ${toDateInput(u.etaMin)}` : ""}
                              {u.manualSetAt ? " · manual" : ""}
                            </div>
                          ))}
                          {linked.length > preview.length ? (
                            <div>…and {linked.length - preview.length} more</div>
                          ) : null}
                        </div>
                      );
                    })()}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      <input
                        className="border rounded px-2 py-1"
                        placeholder="Order number (StockX or other source)"
                        value={stxManualOrderId}
                        onChange={(event) => setStxManualOrderId(event.target.value)}
                        disabled={busy !== null}
                      />
                      <input
                        className="border rounded px-2 py-1"
                        type="date"
                        placeholder="Estimated delivery date"
                        value={stxManualEtaMin}
                        onChange={(event) => {
                          const v = event.target.value;
                          setStxManualEtaMin(v);
                          if (!stxManualEtaMax) setStxManualEtaMax(v);
                        }}
                        disabled={busy !== null}
                      />
                      <input
                        className="border rounded px-2 py-1"
                        type="date"
                        placeholder="Latest estimated delivery (optional)"
                        value={stxManualEtaMax}
                        onChange={(event) => setStxManualEtaMax(event.target.value)}
                        disabled={busy !== null}
                      />
                      <input
                        className="border rounded px-2 py-1"
                        placeholder="Tracking URL or number (optional)"
                        value={stxManualAwb}
                        onChange={(event) => setStxManualAwb(event.target.value)}
                        disabled={busy !== null}
                      />
                    </div>

                    <textarea
                      className="border rounded px-2 py-1 w-full text-xs"
                      rows={4}
                      placeholder="Info / why override / where you bought it (e.g. wrong item bought on StockX, purchased on other marketplace, etc.)"
                      value={stxManualNote}
                      onChange={(event) => setStxManualNote(event.target.value)}
                      disabled={busy !== null}
                    />

                    <input
                      className="border rounded px-2 py-1 w-full text-xs"
                      placeholder="Cancel reason (optional)"
                      value={stxManualCancelReason}
                      onChange={(event) => setStxManualCancelReason(event.target.value)}
                      disabled={busy !== null}
                    />

                    <div className="flex items-center gap-2">
                      <button
                        className="px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                        onClick={manualLinkStxOrder}
                        disabled={busy !== null}
                      >
                        {busy === "stx-manual" ? "Saving…" : "Save manual override"}
                      </button>
                      <button
                        className="px-2 py-1 rounded bg-red-600 text-white disabled:opacity-50"
                        onClick={cancelManualStxOrder}
                        disabled={busy !== null || !stxManualOrderId.trim()}
                      >
                        {busy === "stx-cancel" ? "Cancelling…" : "Cancel StockX order"}
                      </button>
                      <button
                        className="px-2 py-1 rounded bg-slate-100 text-black disabled:opacity-50"
                        onClick={() => setStxManualModalOpen(false)}
                        disabled={busy !== null}
                      >
                        Cancel
                      </button>
                      <span className="text-xs text-gray-500">
                        This links one pending unit for the selected STX variant and turns the bucket ✅ when complete.
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}

              {manualFulfillModalOpen ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                  <div className="w-full max-w-2xl rounded bg-white p-4 space-y-3 shadow">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">Manual fulfillment override</div>
                      <button
                        className="px-2 py-1 rounded bg-slate-100 text-black"
                        onClick={() => setManualFulfillModalOpen(false)}
                        disabled={busy !== null}
                      >
                        Close
                      </button>
                    </div>

                    <div className="text-xs text-gray-600">
                      {(() => {
                        const line = selectedOrder?.lines?.find((l) => l.id === manualFulfillLineId) ?? null;
                        const shipment = selectedOrder?.shipments?.find((s) => s.id === manualFulfillShipmentId) ?? null;
                        const product = resolveProductNameForGtin(line?.gtin ?? null) || line?.productName || "";
                        const size = resolveSizeForGtin(line?.gtin ?? null) || line?.size || "";
                        const pid = line?.supplierPid ?? "—";
                        const gtin = line?.gtin ?? "—";
                        const provider = shipment?.providerKey ?? "—";
                        return `Line: ${line?.lineNumber ?? "—"} · ${product}${product ? " · " : ""}${size}${
                          size ? " · " : ""
                        }GTIN ${gtin} · PID ${pid} · Shipment provider ${provider}`;
                      })()}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      <input
                        className="border rounded px-2 py-1"
                        placeholder="Manual order number / reference"
                        value={manualFulfillOrderRef}
                        onChange={(event) => setManualFulfillOrderRef(event.target.value)}
                        disabled={busy !== null}
                      />
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={manualFulfillIsStx || isLikelyStockxOrderId(manualFulfillOrderRef)}
                            onChange={(event) => setManualFulfillIsStx(event.target.checked)}
                            disabled={busy !== null}
                          />
                          StockX order
                        </label>
                        <button
                          className="px-2 py-1 rounded bg-slate-100 text-black disabled:opacity-50"
                          onClick={fetchManualStockxDetails}
                          disabled={busy !== null || !manualFulfillOrderRef.trim()}
                        >
                          {busy === "manual-stockx-lookup" ? "Fetching…" : "Fetch from StockX"}
                        </button>
                      </div>
                      <input
                        className="border rounded px-2 py-1"
                        type="date"
                        placeholder="Estimated delivery date"
                        value={manualFulfillEtaMin}
                        onChange={(event) => {
                          const v = event.target.value;
                          setManualFulfillEtaMin(v);
                          if (!manualFulfillEtaMax) setManualFulfillEtaMax(v);
                        }}
                        disabled={busy !== null}
                      />
                      <input
                        className="border rounded px-2 py-1"
                        type="date"
                        placeholder="Latest estimated delivery (optional)"
                        value={manualFulfillEtaMax}
                        onChange={(event) => setManualFulfillEtaMax(event.target.value)}
                        disabled={busy !== null}
                      />
                      <input
                        className="border rounded px-2 py-1"
                        type="number"
                        min={0}
                        step={1}
                        placeholder="Bought quantity (manual)"
                        value={Number.isFinite(manualFulfillBoughtQty) ? manualFulfillBoughtQty : 0}
                        onChange={(event) => setManualFulfillBoughtQty(Number(event.target.value || 0))}
                        disabled={busy !== null}
                      />
                      <input
                        className="border rounded px-2 py-1"
                        placeholder="Carrier (optional)"
                        value={manualFulfillCarrier}
                        onChange={(event) => setManualFulfillCarrier(event.target.value)}
                        disabled={busy !== null}
                      />
                      <input
                        className="border rounded px-2 py-1"
                        placeholder="Tracking number / AWB (optional)"
                        value={manualFulfillTracking}
                        onChange={(event) => setManualFulfillTracking(event.target.value)}
                        disabled={busy !== null}
                      />
                    </div>

                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={manualFulfillMarkShipped}
                        onChange={(event) => setManualFulfillMarkShipped(event.target.checked)}
                        disabled={busy !== null}
                      />
                      Mark shipped now (manual)
                    </label>

                    <textarea
                      className="border rounded px-2 py-1 w-full text-xs"
                      rows={3}
                      placeholder="Info (optional): e.g. shipped by friend in Switzerland, not bought on TRM"
                      value={manualFulfillNote}
                      onChange={(event) => setManualFulfillNote(event.target.value)}
                      disabled={busy !== null}
                    />

                    <div className="flex items-center gap-2">
                      <button
                        className="px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                        onClick={saveManualFulfillOverride}
                        disabled={busy !== null}
                      >
                        {busy === `manual-override-${manualFulfillShipmentId}` ? "Saving…" : "Save manual override"}
                      </button>
                      <button
                        className="px-2 py-1 rounded bg-slate-100 text-black disabled:opacity-50"
                        onClick={() => setManualFulfillModalOpen(false)}
                        disabled={busy !== null}
                      >
                        Cancel
                      </button>
                      <span className="text-xs text-gray-500">
                        This keeps supplier keys unchanged and only marks the shipment as manual-managed.
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}

              {selectedOrder.lines.length > 0 && !selectedOrder.cancelledAt ? (
                <div className="border rounded bg-amber-50/40 border-amber-200 p-3 space-y-2 text-xs">
                  <div className="text-sm font-semibold text-amber-950">Build parcels (manual packing)</div>
                  <p className="text-[11px] text-amber-900 leading-snug">
                    Assign quantities per <strong>parcel column</strong> (checkbox-style grid). Each column becomes one
                    shipment with SSCC + delivery note.{" "}
                    <strong>One supplier channel per column</strong> (don’t mix StockX and TRM in the same column).
                    Replacing shipments removes packages that are not manual-locked and have no DELR uploaded yet.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="px-2 py-1 rounded bg-white border border-amber-300 text-amber-950 disabled:opacity-50"
                      onClick={addManualPackColumn}
                      disabled={busy !== null}
                    >
                      + Add parcel column
                    </button>
                    <button
                      type="button"
                      className="px-2 py-1 rounded bg-white border border-amber-300 text-amber-950 disabled:opacity-50"
                      onClick={removeManualPackColumn}
                      disabled={busy !== null || manualPackCols <= 1}
                    >
                      Remove last column
                    </button>
                    <button
                      type="button"
                      className="px-2 py-1 rounded bg-white border border-amber-300 text-amber-950 disabled:opacity-50"
                      onClick={fillOneParcelAllLines}
                      disabled={busy !== null}
                    >
                      All lines → 1 parcel
                    </button>
                    <button
                      type="button"
                      className="px-2 py-1 rounded bg-white border border-amber-300 text-amber-950 disabled:opacity-50"
                      onClick={fillOneLinePerParcel}
                      disabled={busy !== null}
                    >
                      One line per parcel
                    </button>
                  </div>
                  <div className="overflow-auto border rounded bg-white">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-1 text-left">Line</th>
                          <th className="px-2 py-1 text-left">Channel</th>
                          <th className="px-2 py-1 text-left">Product</th>
                          <th className="px-2 py-1 text-left">GTIN</th>
                          <th className="px-2 py-1 text-right">Order qty</th>
                          {Array.from({ length: manualPackCols }, (_, k) => (
                            <th key={k} className="px-2 py-1 text-center whitespace-nowrap">
                              Parcel {k + 1}
                            </th>
                          ))}
                          <th className="px-2 py-1 text-right">Packed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedOrder.lines.map((line) => {
                          const sum = Array.from({ length: manualPackCols }, (_, k) => manualPackQty[line.id]?.[k] ?? 0).reduce(
                            (a, b) => a + b,
                            0
                          );
                          const rem = line.quantity - sum;
                          return (
                            <tr key={line.id} className="border-t">
                              <td className="px-2 py-1">{line.lineNumber}</td>
                              <td className="px-2 py-1">{packChannelForLine(line)}</td>
                              <td className="px-2 py-1">
                                {resolveProductNameForGtin(line.gtin) || line.productName}
                              </td>
                              <td className="px-2 py-1 font-mono text-[11px]">{line.gtin ?? "—"}</td>
                              <td className="px-2 py-1 text-right">{line.quantity}</td>
                              {Array.from({ length: manualPackCols }, (_, k) => (
                                <td key={k} className="px-1 py-1 text-center">
                                  <input
                                    className="w-12 border rounded px-1 py-0.5 text-center"
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={manualPackQty[line.id]?.[k] ?? 0}
                                    onChange={(e) => setManualPackCell(line.id, k, e.target.value)}
                                    disabled={busy !== null}
                                  />
                                </td>
                              ))}
                              <td className={`px-2 py-1 text-right ${rem < 0 ? "text-red-600" : rem > 0 ? "text-amber-700" : "text-green-700"}`}>
                                {sum}
                                {rem !== 0 ? ` (${rem > 0 ? `+${rem} left` : `${rem} over`})` : " ✓"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {selectedOrder.shipments.length > 0 ? (
                    <label className="flex items-start gap-2 text-[11px] text-amber-950">
                      <input
                        type="checkbox"
                        checked={manualPackConfirmReplace}
                        onChange={(e) => setManualPackConfirmReplace(e.target.checked)}
                        disabled={busy !== null}
                        className="mt-0.5"
                      />
                      <span>
                        Replace existing <strong>draft</strong> shipments (safe: keeps manual parcels &amp; anything
                        with DELR uploaded).
                      </span>
                    </label>
                  ) : null}
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded bg-amber-600 text-white font-medium disabled:opacity-50"
                    onClick={() => void applyManualPackages()}
                    disabled={busy !== null}
                  >
                    {busy === "manual-pack" ? "Creating parcels…" : "Create parcels from grid"}
                  </button>
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="text-sm font-medium">Shipments</div>
                {(() => {
                  const activeShipments = selectedOrder.shipments.filter((shipment) => {
                    const status = String(shipment.boxStatus ?? (shipment as any).status ?? "").toUpperCase();
                    return status !== "ARCHIVED";
                  });
                  const archivedShipments = selectedOrder.shipments.filter((shipment) => {
                    const status = String(shipment.boxStatus ?? (shipment as any).status ?? "").toUpperCase();
                    return status === "ARCHIVED";
                  });
                  const shipmentsToShow = showArchivedShipments
                    ? [...activeShipments, ...archivedShipments]
                    : activeShipments;
                  return (
                    <>
                      <div className="flex items-center gap-2 text-[11px] text-gray-500">
                        <button
                          className="px-2 py-1 rounded bg-gray-100"
                          onClick={() => setShowArchivedShipments((prev) => !prev)}
                          disabled={busy !== null}
                        >
                          {showArchivedShipments ? "Hide archived" : "Show archived"}
                        </button>
                        <span>
                          Active {activeShipments.length} · Archived {archivedShipments.length}
                        </span>
                      </div>
                      {(() => {
                        const itemGtins = new Set<string>();
                        for (const s of selectedOrder.shipments) {
                          for (const it of s.items ?? []) {
                            const g = String(it.gtin14 ?? "").trim();
                            if (g) itemGtins.add(g);
                          }
                        }
                        const stxBuckets = selectedOrder.stx?.buckets ?? [];
                        const orphanStxBuckets = stxBuckets.filter((b) => {
                          const g = String(b.gtin ?? "").trim();
                          return Boolean(g) && !itemGtins.has(g);
                        });
                        if (orphanStxBuckets.length === 0) return null;
                        return (
                          <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
                            <div className="font-medium">
                              {orphanStxBuckets.length} StockX bucket(s) on the order are not on any package line
                            </div>
                            <p className="mt-1 text-[11px] leading-snug">
                              The tables below are built from <strong>shipment items</strong> (Galaxus dispatch). StockX
                              health uses <strong>order lines</strong>. If a GTIN is linked in StockX but missing from every
                              shipment manifest, it will not show in the StockX parcel table — refresh ingest / check
                              whether Galaxus split this line into another parcel.
                            </p>
                            <ul className="mt-2 list-disc space-y-1 pl-4">
                              {orphanStxBuckets.map((b) => {
                                const g = String(b.gtin ?? "").trim();
                                const line =
                                  selectedOrder.lines.find(
                                    (l) => String(l.gtin ?? "").trim() === g && isStxOrderLine(l)
                                  ) ?? null;
                                return (
                                  <li key={g}>
                                    <span className="font-mono">{g}</span> · {b.supplierVariantId}
                                    {line
                                      ? ` · order line ${line.lineNumber} · ${line.productName} ×${line.quantity}`
                                      : " · (no matching STX order line found)"}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        );
                      })()}
                      {shipmentsToShow.map((shipment) => {
                        const shipmentIsManual =
                          String(shipment.boxStatus ?? (shipment as any).status ?? "").toUpperCase() === "MANUAL";
                        return (
                        <div key={shipment.id} className="border rounded bg-white p-2 space-y-2">
                    <div className="text-xs text-gray-600">
                      {shipment.shipmentId} · Provider {shipment.providerKey ?? "—"} · SSCC{" "}
                      {shipment.packageId ?? "—"} · DELR {shipment.delrStatus ?? "—"}
                    </div>
                    <div className="text-xs text-gray-600">
                      Supplier order: {shipment.supplierOrderRef ?? shipment.manualOrderRef ?? "—"} · Status{" "}
                      {shipment.boxStatus ?? "—"}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={
                            String(shipment.boxStatus ?? (shipment as any).status ?? "").toUpperCase() === "MANUAL"
                          }
                          onChange={(event) => setShipmentManualManaged(shipment.id, event.target.checked)}
                          disabled={busy !== null}
                        />
                        Manual managed
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={
                            String(shipment.boxStatus ?? (shipment as any).status ?? "").toUpperCase() === "ARCHIVED"
                          }
                          onChange={(event) => setShipmentArchived(shipment.id, event.target.checked)}
                          disabled={busy !== null}
                        />
                        Hide package (archive)
                      </label>
                      <button
                        className="px-2 py-1 rounded bg-gray-100"
                        onClick={() => markShipmentShippedManual(shipment.id, shipment.trackingNumber ?? null)}
                        disabled={busy !== null}
                      >
                        {busy === `manual-ship-${shipment.id}` ? "Saving…" : "Mark shipped (manual)"}
                      </button>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={Boolean(forceShipmentDocs[shipment.id])}
                        onChange={(event) =>
                          setForceShipmentDocs((prev) => ({
                            ...prev,
                            [shipment.id]: event.target.checked,
                          }))
                        }
                        disabled={busy !== null}
                      />
                      Force docs/DELR (ignore StockX + supplier gating)
                    </label>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        className="px-2 py-1 rounded bg-purple-600 text-white"
                        onClick={() => generateDocsForShipment(shipment.id)}
                        disabled={busy !== null || (orderGalaxusLocked && !shipmentIsManual)}
                      >
                        {busy === `docs-${shipment.id}` ? "Generating…" : "Generate box docs"}
                      </button>
                      <button
                        className="px-2 py-1 rounded bg-gray-200"
                        onClick={() => regenerateLabel(shipment.id)}
                        disabled={busy !== null}
                      >
                        {busy === `label-${shipment.id}` ? "Generating…" : "Re-generate Label"}
                      </button>
                      <button
                        className="px-2 py-1 rounded bg-blue-600 text-white"
                        onClick={() => uploadDelrForShipment(shipment.id)}
                        disabled={busy !== null || (orderGalaxusLocked && !shipmentIsManual)}
                      >
                        {busy === `delr-${shipment.id}` ? "Uploading…" : "Upload DELR"}
                      </button>
                      <button
                        className="px-2 py-1 rounded bg-gray-100"
                        onClick={() => downloadDelrXmlForShipment(shipment.id)}
                        disabled={busy !== null || (orderGalaxusLocked && !shipmentIsManual)}
                      >
                        Download DELR XML
                      </button>
                      <button
                        className="px-2 py-1 rounded bg-gray-100"
                        onClick={() => generatePostLabelForShipment(shipment.id, shipment.trackingNumber ?? null)}
                        disabled={busy !== null}
                      >
                        {busy === `postlabel-${shipment.id}` ? "Generating…" : "Generate Post label"}
                      </button>
                      {shipment.labelPdfUrl && (
                        <a
                          className="px-2 py-1 rounded bg-gray-100"
                          href={shipment.labelPdfUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Label PDF
                        </a>
                      )}
                      {shipment.shippingLabelPdfUrl && (
                        <>
                          <button
                            className="px-2 py-1 rounded bg-gray-100"
                            onClick={() =>
                              shipment.shippingLabelPdfUrl
                                ? window.open(shipment.shippingLabelPdfUrl, "_blank", "noopener,noreferrer")
                                : null
                            }
                            disabled={busy !== null}
                          >
                            Print Post label
                          </button>
                          <a
                            className="px-2 py-1 rounded bg-gray-100"
                            href={shipment.shippingLabelPdfUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Post Label PDF
                          </a>
                        </>
                      )}
                      {!shipment.shippingLabelPdfUrl && postLabelUrlByShipment[shipment.id] ? (
                        <>
                          <button
                            className="px-2 py-1 rounded bg-gray-100"
                            onClick={() =>
                              window.open(postLabelUrlByShipment[shipment.id], "_blank", "noopener,noreferrer")
                            }
                            disabled={busy !== null}
                          >
                            Print Post label
                          </button>
                          <a
                            className="px-2 py-1 rounded bg-gray-100"
                            href={postLabelUrlByShipment[shipment.id]}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Post Label PDF
                          </a>
                        </>
                      ) : null}
                      {shipment.deliveryNotePdfUrl && (
                        <a
                          className="px-2 py-1 rounded bg-gray-100"
                          href={shipment.deliveryNotePdfUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Delivery Note PDF
                        </a>
                      )}
                      {(() => {
                        const delrStatus = String(shipment.delrStatus ?? "").toUpperCase();
                        const status = String(shipment.boxStatus ?? (shipment as any).status ?? "").toUpperCase();
                        const canDelete =
                          status === "MANUAL" && !shipment.delrSentAt && delrStatus !== "UPLOADED";
                        return canDelete ? (
                          <button
                            className="px-2 py-1 rounded bg-red-100 text-red-700"
                            onClick={() => deleteShipment(shipment.id)}
                            disabled={busy !== null}
                          >
                            {busy === `delete-${shipment.id}` ? "Removing…" : "Remove package"}
                          </button>
                        ) : null;
                      })()}
                    </div>
                    {shipmentIsManual ? (
                      <div className="text-[11px] text-gray-500">
                        Manual shipment: mark shipped (manual) then upload DELR. Supplier/StockX actions are hidden.
                      </div>
                    ) : null}

                    <div className="overflow-auto border rounded">
                      {(() => {
                        const isStx = String(shipment.providerKey ?? "").toUpperCase() === "STX";
                        const buckets = shipment.stx?.buckets ?? [];
                        const bucketByGtin = new Map<string, StxLinkBucket>();
                        for (const b of buckets) bucketByGtin.set(String(b.gtin ?? "").trim(), b);
                        const orderLineByKey = new Map<string, OrderLine>();
                        for (const line of selectedOrder.lines) {
                          const gtin = String(line?.gtin ?? "").trim();
                          const pid = String(line?.supplierPid ?? "").trim();
                          if (!gtin || !pid) continue;
                          const key = `${pid}::${gtin}`;
                          if (!orderLineByKey.has(key)) orderLineByKey.set(key, line);
                        }
                        const shipmentIsManual =
                          String(shipment.boxStatus ?? (shipment as any).status ?? "").toUpperCase() === "MANUAL";
                        const shipmentIsShipped = Boolean(shipment.shippedAt);
                        const hasSupplierOrderRef = Boolean(
                          String(shipment.supplierOrderRef ?? "").trim() &&
                            !String(shipment.supplierOrderRef ?? "").trim().startsWith("pending-")
                        );
                        const hasManualOrderRef = Boolean(String(shipment.manualOrderRef ?? "").trim());
                        return (
                          <table className="min-w-full text-xs">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-2 py-1 text-left">Supplier PID</th>
                                <th className="px-2 py-1 text-left">GTIN</th>
                                <th className="px-2 py-1 text-left">Size</th>
                                <th className="px-2 py-1 text-left">Supplier SKU</th>
                                <th className="px-2 py-1 text-left">Stock</th>
                                <th className="px-2 py-1 text-left">Status</th>
                                {isStx ? (
                                  <>
                                    <th className="px-2 py-1 text-left">STX Variant</th>
                                    <th className="px-2 py-1 text-right">Linked / Needed</th>
                                    <th className="px-2 py-1 text-right">STX</th>
                                  </>
                                ) : null}
                                <th className="px-2 py-1 text-right">Action</th>
                                <th className="px-2 py-1 text-right">Qty</th>
                              </tr>
                            </thead>
                            <tbody>
                              {shipment.items.map((item) => {
                                const gtin = String(item.gtin14 ?? "").trim();
                                const bucket = isStx ? bucketByGtin.get(gtin) ?? null : null;
                                const neededForShipment =
                                  Number(item.quantity ?? 0) > 0
                                    ? Number(item.quantity ?? 0)
                                    : bucket?.needed ?? 0;
                                const complete = bucket ? bucket.linked >= neededForShipment : false;
                                const pid = String(item.supplierPid ?? "").trim();
                                const line = orderLineByKey.get(`${pid}::${gtin}`) ?? null;
                                const stock = line?.id ? lineStockById[line.id] : undefined;
                                const manualBoughtQty = Number(item.manualBoughtQty ?? 0);
                                const manualBoughtComplete =
                                  Number.isFinite(manualBoughtQty) &&
                                  manualBoughtQty >= Number(item.quantity ?? 0) &&
                                  Number(item.quantity ?? 0) > 0;
                                const boughtNonStx =
                                  shipmentIsShipped || shipmentIsManual || hasSupplierOrderRef || hasManualOrderRef;
                                const boughtStx = bucket ? bucket.linked >= bucket.needed : false;
                                return (
                                  <tr key={item.id} className="border-t">
                                    <td className="px-2 py-1">{item.supplierPid}</td>
                                    <td className="px-2 py-1">{item.gtin14}</td>
                                    <td className="px-2 py-1">{resolveSizeForGtin(item.gtin14)}</td>
                                    <td className="px-2 py-1">{resolveSkuForGtin(item.gtin14)}</td>
                                    <td className="px-2 py-1">
                                      {(() => {
                                        if (!stock) return "—";
                                        if (stock.status === "NO_VARIANT") {
                                          if (stock.noResponseReason === "TRM_SKU_NOT_FOUND") return "TRM not found";
                                          return "No variant";
                                        }
                                        if (stock.status === "UNKNOWN") return "Unknown";
                                        const label = stock.status === "OK" ? "OK" : "Out";
                                        const qty = stock.stock ?? 0;
                                        return `${label} (${qty})`;
                                      })()}
                                    </td>
                                    <td className="px-2 py-1">
                                      {isStx
                                        ? boughtStx
                                          ? "Bought"
                                          : "Not bought"
                                        : manualBoughtQty > 0
                                          ? `Bought ${manualBoughtQty}/${item.quantity}${manualBoughtComplete ? " ✅" : ""}`
                                          : boughtNonStx
                                            ? "Bought"
                                            : "Not bought"}
                                    </td>
                                    {isStx ? (
                                      <>
                                        <td className="px-2 py-1">{bucket?.supplierVariantId ?? "—"}</td>
                                        <td className="px-2 py-1 text-right">
                                          {bucket ? `${bucket.linked}/${neededForShipment}` : "—"}
                                        </td>
                                        <td className="px-2 py-1">{bucket ? (complete ? "✅" : "❌") : "—"}</td>
                                      </>
                                    ) : null}
                                    <td className="px-2 py-1 text-right">
                                      <div className="flex items-center justify-end gap-2">
                                        <button
                                          className="px-2 py-1 rounded bg-slate-100 text-black disabled:opacity-50"
                                          onClick={() => (line ? checkLineStock(line) : null)}
                                          disabled={busy !== null || !line}
                                        >
                                          Check stock
                                        </button>
                                        {isStx ? (
                                          <button
                                            className="px-2 py-1 rounded bg-slate-100 text-black disabled:opacity-50"
                                            onClick={() =>
                                              bucket?.supplierVariantId
                                                ? openStxManualModalForVariant(bucket.supplierVariantId)
                                                : null
                                            }
                                            disabled={busy !== null || !bucket?.supplierVariantId}
                                          >
                                            Manual override…
                                          </button>
                                        ) : (
                                          <button
                                            className="px-2 py-1 rounded bg-slate-100 text-black disabled:opacity-50"
                                            onClick={() => (line ? openManualFulfillForLine(line) : null)}
                                            disabled={busy !== null || !line}
                                          >
                                            Manual override…
                                          </button>
                                        )}
                                        <button
                                          className="px-2 py-1 rounded bg-red-600 text-white disabled:opacity-50"
                                          onClick={() => (line ? removeOrderLine(line) : null)}
                                          disabled={busy !== null || !line}
                                        >
                                          Remove
                                        </button>
                                        {!isStx ? (
                                          <span className="text-[11px] text-gray-600">
                                            {manualBoughtQty}/{item.quantity}
                                            {manualBoughtComplete ? " ✅" : ""}
                                          </span>
                                        ) : null}
                                      </div>
                                    </td>
                                    <td className="px-2 py-1 text-right">{item.quantity}</td>
                                  </tr>
                                );
                              })}
                              {shipment.items.length === 0 && (
                                <tr>
                                  <td className="px-2 py-2 text-gray-500" colSpan={isStx ? 11 : 8}>
                                    No shipment items.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        );
                      })()}
                    </div>
                    {String(shipment.providerKey ?? "").toUpperCase() === "STX" ? (
                      <div className="text-[11px] text-gray-500">
                        StockX docs for this shipment are blocked until all units are linked and have ETA, unless you
                        tick “Force docs/DELR”.
                      </div>
                    ) : null}
                        </div>
                        );
                      })}
                    </>
                  );
                })()}
                {selectedOrder.shipments.length === 0 && (
                  <div className="text-xs text-gray-500">No shipments yet.</div>
                )}
              </div>
            </div>
          )}
        </div>

        {opsLog && (
          <div className="border rounded bg-gray-50 p-3 text-xs overflow-auto whitespace-pre-wrap">
            {opsLog}
          </div>
        )}
      </div>

      <details className="border rounded bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium">Data tables</summary>
        <div className="mt-4 space-y-6">
          <div className="space-y-2">
            <div className="text-sm font-medium">
              Supplier Preview {previewTotal !== null ? `(${preview.length} of ${previewTotal})` : ""}
            </div>
            <div className="overflow-auto border rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-1 text-left">Variant ID</th>
                    <th className="px-2 py-1 text-left">SKU</th>
                    <th className="px-2 py-1 text-left">Product</th>
                    <th className="px-2 py-1 text-left">Size</th>
                    <th className="px-2 py-1 text-left">GTIN</th>
                    <th className="px-2 py-1 text-right">Price</th>
                    <th className="px-2 py-1 text-right">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((item) => (
                    <tr key={item.supplierVariantId} className="border-t">
                      <td className="px-2 py-1">{item.supplierVariantId}</td>
                      <td className="px-2 py-1">{item.supplierSku}</td>
                      <td className="px-2 py-1">{item.productName}</td>
                      <td className="px-2 py-1">{item.sizeEu ?? item.sizeUs}</td>
                      <td className="px-2 py-1">{item.barcode ?? ""}</td>
                      <td className="px-2 py-1 text-right">{item.price ?? ""}</td>
                      <td className="px-2 py-1 text-right">{item.stock ?? ""}</td>
                    </tr>
                  ))}
                  {preview.length === 0 && (
                    <tr>
                      <td className="px-2 py-3 text-gray-500" colSpan={7}>
                        No preview loaded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">DB Variants</div>
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left">Variant ID</th>
                <th className="px-2 py-1 text-left">SKU</th>
                <th className="px-2 py-1 text-left">ProviderKey</th>
                <th className="px-2 py-1 text-left">Size</th>
                <th className="px-2 py-1 text-right">Price</th>
                <th className="px-2 py-1 text-right">Stock</th>
                <th className="px-2 py-1 text-left">Updated</th>
              </tr>
            </thead>
            <tbody>
              {dbItems.map((item) => (
                <tr key={item.supplierVariantId} className="border-t">
                  <td className="px-2 py-1">{item.supplierVariantId}</td>
                  <td className="px-2 py-1">{item.supplierSku}</td>
                  <td className="px-2 py-1">{item.providerKey ?? ""}</td>
                  <td className="px-2 py-1">{item.sizeRaw ?? ""}</td>
                  <td className="px-2 py-1 text-right">{item.price}</td>
                  <td className="px-2 py-1 text-right">{item.stock}</td>
                  <td className="px-2 py-1">{new Date(item.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
              {dbItems.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-gray-500" colSpan={7}>
                    No DB data loaded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {dbNextOffset !== null && (
          <button
            className="px-3 py-2 rounded bg-gray-100 text-black"
            onClick={() => loadDb(dbNextOffset)}
            disabled={busy !== null}
          >
            Load Next Page
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">DB Mappings (Enriched)</div>
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-left">ProviderKey</th>
                <th className="px-2 py-1 text-left">GTIN</th>
                <th className="px-2 py-1 text-left">Variant ID</th>
                <th className="px-2 py-1 text-left">Supplier Name</th>
                <th className="px-2 py-1 text-left">KickDB Name</th>
                <th className="px-2 py-1 text-left">KickDB Brand</th>
                <th className="px-2 py-1 text-left">Image</th>
                <th className="px-2 py-1 text-right">Price</th>
                <th className="px-2 py-1 text-right">Stock</th>
                <th className="px-2 py-1 text-right">RRP</th>
                <th className="px-2 py-1 text-left">Colorway</th>
                <th className="px-2 py-1 text-left">Gender</th>
                <th className="px-2 py-1 text-left">Country</th>
                <th className="px-2 py-1 text-left">Release</th>
                <th className="px-2 py-1 text-left">Updated</th>
              </tr>
            </thead>
            <tbody>
              {dbMappings.map((row) => (
                <tr key={row.id} className="border-t align-top">
                  <td className="px-2 py-1">{row.status ?? ""}</td>
                  <td className="px-2 py-1">{row.providerKey ?? ""}</td>
                  <td className="px-2 py-1">{row.gtin ?? ""}</td>
                  <td className="px-2 py-1">{row.supplierVariantId}</td>
                  <td className="px-2 py-1">{row.supplierProductName ?? ""}</td>
                  <td className="px-2 py-1">{row.kickdbName ?? ""}</td>
                  <td className="px-2 py-1">{row.kickdbBrand ?? row.supplierBrand ?? ""}</td>
                  <td className="px-2 py-1">
                    {row.kickdbImageUrl ? (
                      <a className="underline" href={row.kickdbImageUrl} target="_blank" rel="noreferrer">
                        open
                      </a>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">{row.price ?? ""}</td>
                  <td className="px-2 py-1 text-right">{row.stock ?? ""}</td>
                  <td className="px-2 py-1 text-right">{row.kickdbRetailPrice ?? ""}</td>
                  <td className="px-2 py-1">{row.kickdbColorway ?? ""}</td>
                  <td className="px-2 py-1">{row.kickdbGender ?? ""}</td>
                  <td className="px-2 py-1">{row.kickdbCountryOfManufacture ?? ""}</td>
                  <td className="px-2 py-1">
                    {row.kickdbReleaseDate ? new Date(row.kickdbReleaseDate).toLocaleDateString() : ""}
                  </td>
                  <td className="px-2 py-1">{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : ""}</td>
                </tr>
              ))}
              {dbMappings.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-gray-500" colSpan={16}>
                    No mappings loaded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {dbMappingsNextOffset !== null && (
          <button
            className="px-3 py-2 rounded bg-gray-100 text-black"
            onClick={() => loadMappings(dbMappingsNextOffset)}
            disabled={busy !== null}
          >
            Load more mappings
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Enrichment Results</div>
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left">Variant ID</th>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-left">GTIN</th>
                <th className="px-2 py-1 text-left">Reason</th>
                <th className="px-2 py-1 text-left">Query</th>
                <th className="px-2 py-1 text-left">Product</th>
              </tr>
            </thead>
            <tbody>
              {enrichResults.map((item) => (
                <tr key={item.supplierVariantId} className="border-t">
                  <td className="px-2 py-1">{item.supplierVariantId}</td>
                  <td className="px-2 py-1">{item.status}</td>
                  <td className="px-2 py-1">{item.gtin ?? ""}</td>
                  <td className="px-2 py-1">{item.debug?.reason ?? item.error ?? ""}</td>
                  <td className="px-2 py-1">{item.debug?.query ?? ""}</td>
                  <td className="px-2 py-1">
                    {item.debug?.productSummary?.title ?? item.debug?.searchTop?.title ?? ""}
                  </td>
                </tr>
              ))}
              {enrichResults.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-gray-500" colSpan={6}>
                    No enrichment run yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {enrichDebugRaw && (
          <div className="border rounded bg-gray-50 p-3 text-xs overflow-auto whitespace-pre-wrap">
            {enrichDebugRaw}
          </div>
        )}
      </div>
        </div>
      </details>

    </div>
  );
}
