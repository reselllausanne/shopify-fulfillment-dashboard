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
};

export function GalaxusWarehouseDashboard() {
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
  const [orderLookupInput, setOrderLookupInput] = useState("");
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
    "partner-stock-sync": "Partner stock sync",
    "stx-refresh": "StockX / Kicks refresh",
    "edi-in": "EDI IN order polling",
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
    if (!selectedOrder?.id || !selectedOrder.lines?.length) {
      setManualPackQty({});
      setManualPackCols(2);
      setManualPackConfirmReplace(false);
      return;
    }
    setManualPackCols(2);
    setManualPackConfirmReplace(false);
    const next: Record<string, number[]> = {};
    for (const line of selectedOrder.lines) {
      next[line.id] = [0, 0];
    }
    setManualPackQty(next);
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

  const syncStxSlugs = async (limit: number, busyKey: string) => {
    setBusy(busyKey);
    setError(null);
    try {
      const response = await fetch("/api/galaxus/stx/import-slugs/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "STX slug sync failed");
      setStxSlugCounts(data.counts ?? null);
      setOpsLog(JSON.stringify({ stxSlugSync: data, limit }, null, 2));
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

  const hasEdiFile = (docType: string) => {
    if (!selectedOrder) return false;
    return selectedOrder.ediFiles?.some(
      (file) => file.direction === "OUT" && file.docType === docType && file.status === "uploaded"
    );
  };

  const loadOrderDetail = async (orderId: string): Promise<boolean> => {
    if (!orderId) return false;
    setBusy("order-detail");
    setError(null);
    try {
      const response = await fetch(`/api/galaxus/orders/${orderId}`, { cache: "no-store" });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to load order");
      setSelectedOrder(data.order ?? null);
      setSelectedOrderId(data.order?.id ?? orderId);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const loadOrderFromLookup = async () => {
    const raw = orderLookupInput.trim();
    if (!raw) {
      setError("Enter a Galaxus order id or internal UUID.");
      return;
    }
    const ok = await loadOrderDetail(raw);
    if (ok) setOrderLookupInput("");
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

  const resolveSkuForGtin = (gtin?: string | null) => {
    if (!gtin || !selectedOrder?.lines?.length) return "";
    const match = selectedOrder.lines.find((line) => line.gtin === gtin);
    return match?.supplierSku ?? match?.supplierPid ?? "";
  };

  const resolveSizeForGtin = (gtin?: string | null) => {
    if (!gtin || !selectedOrder?.lines?.length) return "";
    const match = selectedOrder.lines.find((line) => line.gtin === gtin);
    return match?.size ?? "";
  };

  const resolveProductNameForGtin = (gtin?: string | null) => {
    if (!gtin || !selectedOrder?.lines?.length) return "";
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
            className="inline-flex items-center rounded bg-gray-900 px-3 py-1 text-xs font-medium text-white"
            href="/galaxus/warehouse"
          >
            Warehouse
          </a>
          <a
            className="inline-flex items-center rounded bg-gray-200 px-3 py-1 text-xs font-medium text-gray-900"
            href="/galaxus/direct-delivery"
          >
            Direct delivery
          </a>
          <a
            className="inline-flex items-center rounded bg-gray-200 px-3 py-1 text-xs font-medium text-gray-900"
            href="/galaxus/invoices"
          >
            Invoices
          </a>
          <a
            className="inline-flex items-center rounded bg-gray-200 px-3 py-1 text-xs font-medium text-gray-900"
            href="/galaxus/pricing"
          >
            Pricing &amp; DB
          </a>
          <a
            className="inline-flex items-center rounded bg-teal-700 px-3 py-1 text-xs font-medium text-white"
            href="/decathlon"
          >
            Decathlon
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
              <div>Schedules are optional; run jobs manually below. Last run times:</div>
              {opsStatus?.feeds?.running ? (
                <div className="text-amber-600">Feed push is running</div>
              ) : null}
            </div>

            <div className="rounded border bg-white p-2 text-xs text-gray-600 space-y-2">
              <div className="text-xs font-medium text-gray-700">Background jobs (last run only)</div>
              {Array.isArray(opsStatus?.jobs) && opsStatus.jobs.length > 0 ? (
                <div className="space-y-2">
                  {(opsStatus.jobs as any[]).filter((job) => job.jobKey !== "image-sync").map((job: any) => (
                    <div key={job.jobKey} className="border-b last:border-b-0 pb-2">
                      <div className="font-medium text-gray-800">
                        {opsJobLabels[job.jobKey] ?? job.jobKey}
                      </div>
                      <div className="text-gray-600">
                        {job.lastRun
                          ? `${formatTime(job.lastRun.startedAt)} · ${job.lastRun.success ? "OK" : "FAIL"}`
                          : "Never"}
                      </div>
                      {job.lastRun?.errorMessage ? (
                        <div className="text-red-600">Error: {job.lastRun.errorMessage}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div>—</div>
              )}
            </div>

            <div className="rounded border bg-white p-2 text-xs text-gray-600 space-y-2">
              <div className="text-xs font-medium text-gray-700">Feed pipeline (last run)</div>
              <div>
                Stock + price push:{" "}
                {opsStatus?.feeds?.lastStockPrice
                  ? `${formatTime(opsStatus.feeds.lastStockPrice.startedAt)} · ${
                      opsStatus.feeds.lastStockPrice.success ? "OK" : "FAIL"
                    }`
                  : "—"}
              </div>
              <div>
                Full push:{" "}
                {opsStatus?.feeds?.lastFull
                  ? `${formatTime(opsStatus.feeds.lastFull.startedAt)} · ${
                      opsStatus.feeds.lastFull.success ? "OK" : "FAIL"
                    }`
                  : "—"}
              </div>
              <div>
                Master manifest: {formatTime(opsStatus?.feeds?.lastManifests?.master?.createdAt)} ·{" "}
                {opsStatus?.feeds?.lastManifests?.master?.uploadStatus ?? "—"}
              </div>
              <div>
                Offer: {formatTime(opsStatus?.feeds?.lastManifests?.offer?.createdAt)} ·{" "}
                {opsStatus?.feeds?.lastManifests?.offer?.uploadStatus ?? "—"}
              </div>
              <div>
                Stock manifest: {formatTime(opsStatus?.feeds?.lastManifests?.stock?.createdAt)} ·{" "}
                {opsStatus?.feeds?.lastManifests?.stock?.uploadStatus ?? "—"}
              </div>
              <div>
                Specs: {formatTime(opsStatus?.feeds?.lastManifests?.specs?.createdAt)} ·{" "}
                {opsStatus?.feeds?.lastManifests?.specs?.uploadStatus ?? "—"}
              </div>
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
                  onClick={() => void syncStxSlugs(150, "stx-slug-sync-150")}
                  disabled={busy !== null}
                >
                  {busy === "stx-slug-sync-150" ? "Syncing…" : "Sync first 150 STX slugs"}
                </button>
                <button
                  className="px-3 py-2 rounded bg-indigo-800 text-white disabled:opacity-50"
                  onClick={() => void syncStxSlugs(1000, "stx-slug-sync-1000")}
                  disabled={busy !== null}
                >
                  {busy === "stx-slug-sync-1000" ? "Syncing…" : "Sync next 1000 STX slugs"}
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

export function GalaxusDashboardHome() {
  const [loading, setLoading] = useState(false);
  const [needsAttention, setNeedsAttention] = useState(0);
  const [totalOrders, setTotalOrders] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadSummary = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/galaxus/orders?limit=50&view=active", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to load summary");
        const items = Array.isArray(data.items) ? data.items : [];
        setTotalOrders(items.length);
        const attention = items.filter((order: any) => {
          const shipped = Number(order.shippedCount ?? 0);
          const total = Number(order._count?.shipments ?? 0);
          return total === 0 || shipped < total;
        }).length;
        setNeedsAttention(attention);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadSummary();
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Galaxus Dashboard</h1>
        <p className="text-sm text-gray-500">Quick status and navigation</p>
      </div>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <div className="border rounded p-4 bg-white">
        <div className="text-sm text-gray-600">
          {loading ? "Loading..." : `${needsAttention} / ${totalOrders} orders need action`}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <a href="/galaxus/direct-delivery" className="px-3 py-2 bg-gray-900 text-white rounded">
          Direct Delivery
        </a>
        <a href="/galaxus/warehouse" className="px-3 py-2 bg-gray-100 text-gray-900 rounded">
          Warehouse
        </a>
        <a href="/galaxus/pricing" className="px-3 py-2 bg-gray-100 text-gray-900 rounded">
          Pricing &amp; DB
        </a>
        <a href="/galaxus/invoices" className="px-3 py-2 bg-gray-100 text-gray-900 rounded">
          Invoices
        </a>
        <a href="/decathlon" className="px-3 py-2 bg-teal-700 text-white rounded">
          Decathlon
        </a>
      </div>
    </div>
  );
}

export default GalaxusWarehouseDashboard;
