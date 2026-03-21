"use client";

import { useEffect, useState } from "react";

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
  const [orderProviderKey, setOrderProviderKey] = useState<string>("");
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [opsLog, setOpsLog] = useState<string | null>(null);
  const [unassignedCount, setUnassignedCount] = useState<number | null>(null);
  const [cleanupStats, setCleanupStats] = useState<any | null>(null);
  const [packMaxPairs, setPackMaxPairs] = useState<number>(12);
  const [allowSplit, setAllowSplit] = useState<boolean>(true);
  const [forceRepack, setForceRepack] = useState<boolean>(true);
  const [forceEdi, setForceEdi] = useState<boolean>(false);
  const [schedulerStatus, setSchedulerStatus] = useState<any | null>(null);
  const [schedulerBusy, setSchedulerBusy] = useState(false);
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
  const [onlyAvailableSupplierOrder, setOnlyAvailableSupplierOrder] = useState<Record<string, boolean>>({});
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
  const [manualPackages, setManualPackages] = useState<
    Array<{ id: string; items: Record<string, number> }>
  >([]);
  const [showArchivedShipments, setShowArchivedShipments] = useState(false);
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
  const formatJobStatus = (runAt: string | null | undefined, result: any) => {
    if (!runAt) return "—";
    const status = result?.ok ? "OK" : "FAIL";
    return `${new Date(runAt).toLocaleString()} · ${status}`;
  };

  const totalShipments = selectedOrder?.shipments?.length ?? 0;
  const delrUploadedCount =
    selectedOrder?.shipments?.filter(
      (s) => String(s.delrStatus ?? "").toUpperCase() === "UPLOADED" || Boolean(s.delrSentAt)
    ).length ?? 0;
  const shippedCount = selectedOrder?.shipments?.filter((s) => Boolean(s.shippedAt)).length ?? 0;
  const orderGalaxusLocked = delrUploadedCount > 0;

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

  const loadSchedulerStatus = async () => {
    try {
      const res = await fetch("/api/galaxus/pipeline/status", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) setSchedulerStatus(data.status ?? null);
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

  const toggleScheduler = async (action: "start" | "stop") => {
    setSchedulerBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/galaxus/feeds/scheduler?action=${action}`, {
        method: "POST",
        cache: "no-store",
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error ?? "Scheduler action failed");
      setSchedulerStatus(data.status ?? null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSchedulerBusy(false);
    }
  };

  useEffect(() => {
    // Avoid spiking DB connections on page load in production.
    // Export diagnostics is intentionally manual (button) because it's a heavy endpoint.
    (async () => {
      await loadSchedulerStatus();
      await loadRoutingSummary();
      await loadVariantStats();
      await loadStxSlugCounts();
    })();
  }, []);

  const syncSupplier = async () => {
    setBusy("sync");
    setError(null);
    try {
      const response = await fetch("/api/galaxus/supplier/sync?all=1&mode=stock&stxLimit=100", {
        method: "POST",
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Sync failed");
      setOpsLog(JSON.stringify({ sync: data }, null, 2));
      await loadVariantStats();
      await loadStxSlugCounts();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

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
      const providerKeyValue = orderProviderKey.trim().toUpperCase();
      if (providerKeyValue) params.set("providerKey", providerKeyValue);
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

  const resolveProviderKeyForLine = (line: OrderLine) => {
    const direct = line.providerKey?.split("_")[0]?.trim().toUpperCase();
    if (direct && direct.length === 3) return direct;
    const variantRaw = line.supplierVariantId ?? "";
    const variantKey = (variantRaw.includes(":")
      ? variantRaw.split(":")[0]
      : variantRaw.includes("_")
        ? variantRaw.split("_")[0]
        : variantRaw
    )
      .trim()
      .toUpperCase();
    if (variantKey && variantKey.length === 3) return variantKey;
    return "";
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
      setManualPackages([]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
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


  const pollEdiIn = async () => {
    setBusy("edi-in");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch("/api/galaxus/cron?task=edi-in", { cache: "no-store" });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "EDI IN failed");
      setOpsLog(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };


  const uploadFeed = async (type: "product" | "price" | "stock" | "specs") => {
    setBusy(`feed-${type}`);
    setError(null);
    setOpsLog(null);
    try {
      const params = new URLSearchParams();
      if (type === "product") params.set("type", "master");
      if (type === "price") params.set("type", "offer-stock");
      if (type === "stock") params.set("type", "stock");
      if (type === "specs") params.set("type", "specs");
      const response = await fetch(`/api/galaxus/feeds/upload?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Feed upload failed");
      setOpsLog(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setError(err.message);
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

  const sendPendingEdiOut = async () => {
    setBusy("edi-out");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch("/api/galaxus/cron?task=edi-out", { cache: "no-store" });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "EDI OUT failed");
      setOpsLog(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const packShipments = async () => {
    if (!selectedOrderId) {
      setError("Select an order first.");
      return;
    }
    setBusy("pack");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch("/api/galaxus/shipments/pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: selectedOrderId,
          maxPairsPerParcel: packMaxPairs,
          allowSplit,
          force: forceRepack,
        }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Packing failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const addManualPackage = () => {
    const nextId = `pkg-${Date.now()}-${Math.round(Math.random() * 1000)}`;
    setManualPackages((current) => [...current, { id: nextId, items: {} }]);
  };

  const removeManualPackage = (packageId: string) => {
    setManualPackages((current) => current.filter((pkg) => pkg.id !== packageId));
  };

  const updateManualPackageQty = (packageId: string, lineId: string, value: number) => {
    const qty = Math.max(0, Math.floor(Number(value) || 0));
    setManualPackages((current) =>
      current.map((pkg) => {
        if (pkg.id !== packageId) return pkg;
        return {
          ...pkg,
          items: { ...pkg.items, [lineId]: qty },
        };
      })
    );
  };

  const createManualShipments = async () => {
    if (!selectedOrderId || !selectedOrder) {
      setError("Select an order first.");
      return;
    }
    if (manualPackages.length === 0) {
      setError("Add at least one package.");
      return;
    }
    setBusy("manual-pack");
    setError(null);
    setOpsLog(null);
    try {
      const packages = manualPackages
        .map((pkg) => {
          const items = Object.entries(pkg.items)
            .map(([lineId, qty]) => ({ lineId, quantity: Number(qty) }))
            .filter((entry) => Number(entry.quantity) > 0);
          return { items };
        })
        .filter((pkg) => pkg.items.length > 0);
      if (packages.length === 0) {
        throw new Error("All packages are empty.");
      }
      const response = await fetch("/api/galaxus/shipments/manual-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: selectedOrderId, packages }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Manual pack failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrderDetail(selectedOrderId);
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
    setBusy("ordr");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch("/api/galaxus/edi/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: selectedOrderId, types: ["ORDR"], force: forceEdi }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "ORDR failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await loadOrderDetail(selectedOrderId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const placeSupplierOrder = async () => {
    if (!selectedOrderId) {
      setError("Select an order first.");
      return;
    }
    setBusy("supplier-order");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch("/api/galaxus/supplier/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: selectedOrderId }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Supplier order failed");
      setOpsLog(JSON.stringify(data.result ?? data, null, 2));
      await loadOrderDetail(selectedOrderId);
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

  const sendInvoice = async () => {
    if (!selectedOrderId) {
      setError("Select an order first.");
      return;
    }
    setBusy("invoice");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch("/api/galaxus/edi/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: selectedOrderId, types: ["INVO"], force: forceEdi }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Invoice send failed");
      setOpsLog(JSON.stringify(data, null, 2));
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

  const downloadOrderEdiXml = (type: "ORDR" | "INVO" | "CANR" | "EOLN") => {
    if (!selectedOrderId) {
      setError("Select an order first.");
      return;
    }
    const params = new URLSearchParams();
    params.set("download", "1");
    params.set("orderId", selectedOrderId);
    params.set("type", type);
    if (forceEdi) params.set("force", "1");
    window.open(`/api/galaxus/edi/send?${params.toString()}`, "_blank", "noopener,noreferrer");
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

  const placeSupplierOrderForShipment = async (shipmentId: string) => {
    setBusy(`place-${shipmentId}`);
    setError(null);
    setOpsLog(null);
    try {
      const onlyAvailable = Boolean(onlyAvailableSupplierOrder[shipmentId]);
      const response = await fetch(
        `/api/galaxus/shipments/${shipmentId}/place-supplier-order${onlyAvailable ? "?onlyAvailable=1" : ""}`,
        {
        method: "POST",
        }
      );
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to place supplier order");
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
              <div className="text-xs text-gray-500">
                Auto-upload: {schedulerStatus?.running ? "ON" : "OFF"}
              </div>
            </div>
            {orderGalaxusLocked ? (
              <div className="text-xs text-red-600">
                Galaxus EDI is locked because at least one DELR was sent. ORDR/INVO/DELR actions are disabled, except on
                manual shipments.
              </div>
            ) : null}
            <div className="rounded border bg-white p-2 text-xs text-gray-600">
              <div>EDI IN (ORDR pull) every 1 hour</div>
              <div>Supplier sync every 2 hours</div>
              <div>Price + stock every 2 hours</div>
              <div>Full refresh every 10 hours</div>
              {schedulerStatus?.nextEdiInAt ? (
                <div>Next EDI IN: {new Date(schedulerStatus.nextEdiInAt).toLocaleString()}</div>
              ) : null}
              {schedulerStatus?.nextSupplierSyncAt ? (
                <div>Next supplier sync: {new Date(schedulerStatus.nextSupplierSyncAt).toLocaleString()}</div>
              ) : null}
              {schedulerStatus?.nextOfferStockAt ? (
                <div>Next price/stock: {new Date(schedulerStatus.nextOfferStockAt).toLocaleString()}</div>
              ) : null}
              {schedulerStatus?.nextMasterAt ? (
                <div>Next full refresh: {new Date(schedulerStatus.nextMasterAt).toLocaleString()}</div>
              ) : null}
            </div>
            <div className="rounded border bg-white p-2 text-xs text-gray-600 space-y-1">
              <div>
                Last EDI IN: {formatJobStatus(schedulerStatus?.lastEdiInRunAt, schedulerStatus?.lastEdiInResult)}
              </div>
              <div>
                Last supplier sync:{" "}
                {formatJobStatus(
                  schedulerStatus?.lastSupplierSyncRunAt,
                  schedulerStatus?.lastSupplierSyncResult
                )}
              </div>
              <div>
                Last price/stock:{" "}
                {formatJobStatus(
                  schedulerStatus?.lastOfferStockRunAt,
                  schedulerStatus?.lastOfferStockResult
                )}
              </div>
              <div>
                Last full refresh:{" "}
                {formatJobStatus(schedulerStatus?.lastMasterRunAt, schedulerStatus?.lastMasterResult)}
              </div>
              {schedulerStatus?.lastOfferStockResult?.resultJson?.upload?.counts ? (
                <div>
                  Last price/stock counts:{" "}
                  {JSON.stringify(schedulerStatus.lastOfferStockResult.resultJson.upload.counts)}
                </div>
              ) : null}
              {schedulerStatus?.lastMasterResult?.resultJson?.upload?.counts ? (
                <div>
                  Last full refresh counts:{" "}
                  {JSON.stringify(schedulerStatus.lastMasterResult.resultJson.upload.counts)}
                </div>
              ) : null}
              {schedulerStatus?.lastOfferStockResult?.error ? (
                <div>Last price/stock error: {schedulerStatus.lastOfferStockResult.error}</div>
              ) : null}
              {schedulerStatus?.lastMasterResult?.error ? (
                <div>Last full refresh error: {schedulerStatus.lastMasterResult.error}</div>
              ) : null}
              {schedulerStatus?.lastEdiInResult?.error ? (
                <div>Last EDI IN error: {schedulerStatus.lastEdiInResult.error}</div>
              ) : null}
              {schedulerStatus?.lastManifests?.master?.validationIssuesJson ? (
                <div>
                  Last master validation issues:{" "}
                  {JSON.stringify(schedulerStatus.lastManifests.master.validationIssuesJson.summary ?? {})}
                </div>
              ) : null}
              {schedulerStatus?.lastManifests?.offer?.validationIssuesJson ? (
                <div>
                  Last offer validation issues:{" "}
                  {JSON.stringify(schedulerStatus.lastManifests.offer.validationIssuesJson.summary ?? {})}
                </div>
              ) : null}
              {schedulerStatus?.lastManifests?.stock?.validationIssuesJson ? (
                <div>
                  Last stock validation issues:{" "}
                  {JSON.stringify(schedulerStatus.lastManifests.stock.validationIssuesJson.summary ?? {})}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="px-3 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
                onClick={() => toggleScheduler("start")}
                disabled={schedulerBusy}
              >
                {schedulerBusy ? "Working…" : "Enable auto-upload"}
              </button>
              <button
                className="px-3 py-2 rounded bg-gray-200 text-black disabled:opacity-50"
                onClick={() => toggleScheduler("stop")}
                disabled={schedulerBusy}
              >
                Disable auto-upload
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="px-3 py-2 rounded bg-gray-900 text-white disabled:opacity-50"
                onClick={pollEdiIn}
                disabled={busy !== null}
              >
                {busy === "edi-in" ? "Polling…" : "Poll EDI IN"}
              </button>
              <button
                className="px-3 py-2 rounded bg-gray-700 text-white disabled:opacity-50"
                onClick={sendPendingEdiOut}
                disabled={busy !== null}
              >
                {busy === "edi-out" ? "Sending…" : "Send EDI OUT"}
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
            <details className="rounded border bg-white p-3">
              <summary className="cursor-pointer text-sm font-medium">Advanced operations</summary>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="px-3 py-2 rounded bg-gray-800 text-white disabled:opacity-50"
                  onClick={() => uploadFeed("product")}
                  disabled={busy !== null}
                >
                  {busy === "feed-product" ? "Uploading…" : "Upload Master"}
                </button>
                <button
                  className="px-3 py-2 rounded bg-gray-800 text-white disabled:opacity-50"
                  onClick={() => uploadFeed("price")}
                  disabled={busy !== null}
                >
                  {busy === "feed-price" ? "Uploading…" : "Upload Offer + Stock"}
                </button>
                <button
                  className="px-3 py-2 rounded bg-gray-800 text-white disabled:opacity-50"
                  onClick={() => uploadFeed("specs")}
                  disabled={busy !== null}
                >
                  {busy === "feed-specs" ? "Uploading…" : "Upload Specs"}
                </button>
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
          </div>
          <div className="rounded border bg-gray-50 p-3 space-y-3">
            <div className="text-sm font-medium">Catalog & Feeds</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                onClick={syncSupplier}
                disabled={busy !== null}
              >
                {busy === "sync" ? "Syncing…" : "Sync Stock"}
              </button>
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
            <input
              className="px-2 py-2 border rounded text-sm w-40 uppercase"
              value={orderProviderKey}
              onChange={(event) => setOrderProviderKey(event.target.value)}
              placeholder="ProviderKey (AAA)"
            />
            <button
              className="px-3 py-2 rounded bg-gray-200"
              onClick={() => fetchOrders(0)}
              disabled={busy !== null}
            >
              {busy === "orders" ? "Loading…" : "Apply Filter"}
            </button>
            <button
              className="px-3 py-2 rounded bg-gray-100"
              onClick={() => {
                setOrderProviderKey("");
                fetchOrders(0);
              }}
              disabled={busy !== null}
            >
              Clear
            </button>
          </div>
          <div className="overflow-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1 text-left">Order ID</th>
                  <th className="px-2 py-1 text-left">PO</th>
                  <th className="px-2 py-1 text-left">Delivery Type</th>
                  <th className="px-2 py-1 text-right">Lines</th>
                  <th className="px-2 py-1 text-right">Shipments</th>
                  <th className="px-2 py-1 text-left">ORDR</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-t">
                    <td className="px-2 py-1">{order.galaxusOrderId}</td>
                    <td className="px-2 py-1">{order.orderNumber ?? ""}</td>
                    <td className="px-2 py-1">{order.deliveryType ?? ""}</td>
                    <td className="px-2 py-1 text-right">{order._count.lines}</td>
                    <td className="px-2 py-1 text-right">{order._count.shipments}</td>
                    <td className="px-2 py-1">
                      {order.ordrSentAt ? new Date(order.ordrSentAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        className="px-2 py-1 rounded bg-gray-200"
                        onClick={() => loadOrderDetail(order.id)}
                        disabled={busy !== null}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td className="px-2 py-3 text-gray-500" colSpan={7}>
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
          <div className="text-sm font-medium">Order Detail</div>
          <div className="flex gap-2 flex-wrap items-center">
            <div className="text-xs text-gray-500">
              Selected order:{" "}
              <span className="font-mono">{selectedOrder?.galaxusOrderId ?? "—"}</span>{" "}
              {selectedOrder?.id ? <span className="text-gray-400">({selectedOrder.id})</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Max pairs/parcel</span>
              <input
                className="px-2 py-2 border rounded text-sm w-20"
                type="number"
                min={1}
                max={50}
                value={packMaxPairs}
                onChange={(event) => setPackMaxPairs(Number(event.target.value || 0))}
              />
              <label className="text-xs text-gray-500 flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={allowSplit}
                  onChange={(event) => setAllowSplit(event.target.checked)}
                />
                Allow split
              </label>
              <label className="text-xs text-gray-500 flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={forceRepack}
                  onChange={(event) => setForceRepack(event.target.checked)}
                />
                Force repack
              </label>
              <label className="text-xs text-gray-500 flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={forceEdi}
                  onChange={(event) => setForceEdi(event.target.checked)}
                />
                Force EDI (ignore supplier gate)
              </label>
              <button
                className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                onClick={packShipments}
                disabled={busy !== null}
              >
                {busy === "pack" ? "Packing…" : "Pack + Create Shipments"}
              </button>
              {selectedOrder?.stx?.hasStxItems ? (
                <button
                  className="px-3 py-2 rounded bg-green-600 text-white disabled:opacity-50"
                  onClick={syncStockxOrdersForOrder}
                  disabled={busy !== null}
                >
                  {busy === "stx-sync-order" ? "Syncing…" : "Sync StockX orders"}
                </button>
              ) : (
                <button
                  className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
                  onClick={placeSupplierOrder}
                  disabled={busy !== null}
                >
                  {busy === "supplier-order" ? "Ordering…" : "Place Supplier Order (12 pairs max)"}
                </button>
              )}
              <button
                className="px-3 py-2 rounded bg-green-600 text-white disabled:opacity-50"
                onClick={sendOrdr}
                disabled={busy !== null || orderGalaxusLocked}
              >
                {busy === "ordr" ? "Sending…" : "Send ORDR"}
              </button>
              <button
                className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
                onClick={() => downloadOrderEdiXml("ORDR")}
                disabled={busy !== null}
              >
                Download ORDR XML
              </button>
              <button
                className="px-3 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
                onClick={sendInvoice}
                disabled={busy !== null || orderGalaxusLocked}
              >
                {busy === "invoice" ? "Sending…" : "Send INVO"}
              </button>
              <button
                className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
                onClick={() => downloadOrderEdiXml("INVO")}
                disabled={busy !== null}
              >
                Download INVO XML
              </button>
            </div>
          </div>

          {selectedOrder && (
            <div className="space-y-3 border rounded p-3 bg-gray-50">
              <div className="text-xs text-gray-600">
                {selectedOrder.galaxusOrderId} · {selectedOrder.orderNumber ?? "—"} ·{" "}
                {selectedOrder.deliveryType ?? "—"}
              </div>

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
                    Pack shipments:{" "}
                    {selectedOrder.shipments.length > 0 ? "Created" : "Not packed"}
                  </div>
                  <div>
                    DELR: {delrUploadedCount}/{totalShipments || 0}{" "}
                    {delrUploadedCount > 0 ? "Uploaded" : "Pending"}
                  </div>
                  <div>
                    Shipped: {shippedCount}/{totalShipments || 0}{" "}
                    {totalShipments > 0 && shippedCount === totalShipments ? "✅" : "—"}
                  </div>
                  <div>
                    INVO: {hasEdiFile("INVO") ? "Sent" : "Pending"}
                  </div>
                </div>
              </div>

              {selectedOrder ? (
                <div className="border rounded bg-white p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-gray-700">Manual packing (choose items per package)</div>
                    <div className="flex items-center gap-2">
                      <button
                        className="px-2 py-1 rounded bg-slate-100 text-black disabled:opacity-50"
                        onClick={addManualPackage}
                        disabled={busy !== null}
                      >
                        Add package
                      </button>
                      <button
                        className="px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                        onClick={createManualShipments}
                        disabled={busy !== null}
                      >
                        {busy === "manual-pack" ? "Packing…" : "Create manual shipments"}
                      </button>
                    </div>
                  </div>
                  {manualPackages.length === 0 ? (
                    <div className="text-gray-500">No packages yet. Click “Add package”.</div>
                  ) : (
                    <div className="overflow-auto border rounded">
                      <table className="min-w-full text-[11px]">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-1 text-left">Line</th>
                            <th className="px-2 py-1 text-left">Product</th>
                            <th className="px-2 py-1 text-left">Provider</th>
                            <th className="px-2 py-1 text-left">Size</th>
                            <th className="px-2 py-1 text-right">Ordered</th>
                            <th className="px-2 py-1 text-right">Shipped</th>
                            <th className="px-2 py-1 text-right">Remaining</th>
                            {manualPackages.map((pkg, idx) => (
                              <th key={pkg.id} className="px-2 py-1 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <span>Pkg {idx + 1}</span>
                                  <button
                                    className="text-[10px] text-red-600"
                                    onClick={() => removeManualPackage(pkg.id)}
                                    disabled={busy !== null}
                                  >
                                    ✕
                                  </button>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {selectedOrder.lines.map((line) => {
                            const lineId = line.id;
                            const orderedQty = Number(line.quantity ?? 0);
                            const shippedQty = (selectedOrder.shipments ?? []).reduce((acc, shipment) => {
                              const delrStatus = String(shipment?.delrStatus ?? "").toUpperCase();
                              if (!shipment?.delrSentAt && delrStatus !== "UPLOADED") return acc;
                              const match = (shipment.items ?? []).find(
                                (it) =>
                                  String(it?.gtin14 ?? "").trim() === String(line.gtin ?? "").trim() &&
                                  String(it?.supplierPid ?? "").trim() === String(line.supplierPid ?? "").trim()
                              );
                              return acc + (match ? Number(match?.quantity ?? 0) : 0);
                            }, 0);
                            const assignedQty = manualPackages.reduce(
                              (acc, pkg) => acc + Number(pkg.items?.[lineId] ?? 0),
                              0
                            );
                            const remaining = Math.max(0, orderedQty - shippedQty - assignedQty);
                            const lineAny = line as any;
                            const providerPrefix = resolveProviderKeyForLine(line);
                            const providerKey =
                              providerPrefix && line.gtin ? `${providerPrefix}_${line.gtin}` : providerPrefix;
                            const sizeLabel =
                              line.size ?? lineAny.sizeRaw ?? lineAny.sizeNormalized ?? lineAny.variantSize ?? "";
                            const productLabel =
                              resolveProductNameForGtin(line.gtin) ||
                              line.productName ||
                              lineAny.supplierProductName ||
                              line.supplierSku ||
                              line.supplierVariantId ||
                              line.gtin ||
                              "Item";
                            return (
                              <tr key={line.id} className="border-t">
                                <td className="px-2 py-1">{line.lineNumber}</td>
                                <td className="px-2 py-1">
                                  {productLabel}
                                </td>
                                <td className="px-2 py-1">{providerKey}</td>
                                <td className="px-2 py-1">{sizeLabel}</td>
                                <td className="px-2 py-1 text-right">{orderedQty}</td>
                                <td className="px-2 py-1 text-right">
                                  {shippedQty}/{orderedQty}
                                  {shippedQty >= orderedQty && orderedQty > 0 ? " ✅" : ""}
                                </td>
                                <td className="px-2 py-1 text-right">
                                  {remaining}
                                  {remaining === 0 ? " ✅" : ""}
                                </td>
                                {manualPackages.map((pkg) => {
                                  const value = Number(pkg.items?.[lineId] ?? 0);
                                  return (
                                    <td key={pkg.id} className="px-2 py-1 text-right">
                                      <input
                                        className="w-16 border rounded px-1 py-0.5 text-right"
                                        type="number"
                                        min={0}
                                        step={1}
                                        value={Number.isFinite(value) ? value : 0}
                                        onChange={(event) =>
                                          updateManualPackageQty(pkg.id, lineId, Number(event.target.value || 0))
                                        }
                                        disabled={busy !== null}
                                      />
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="text-[11px] text-gray-500">
                    Manual packages can mix providers. Use this only when you intend to manually manage the dispatch.
                  </div>
                </div>
              ) : null}

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
                <div className="text-xs text-gray-500">
                  Packed shipments detected. Manage items from the shipment tables below (check stock, manual override,
                  remove line) so DELR can still be sent for the remaining items.
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
                      {(() => {
                        const provider = (shipment.providerKey ?? "").toUpperCase();
                        const isStx = provider === "STX";
                        const isManual = shipmentIsManual;
                        const canPlaceSupplierOrder = !isStx && !isManual;
                        const canSyncStx = isStx && !isManual;
                        return (
                          <>
                            {canPlaceSupplierOrder ? (
                              <label className="flex items-center gap-2 text-xs text-gray-600 mr-2">
                                <input
                                  type="checkbox"
                                  checked={Boolean(onlyAvailableSupplierOrder[shipment.id])}
                                  onChange={(event) =>
                                    setOnlyAvailableSupplierOrder((prev) => ({
                                      ...prev,
                                      [shipment.id]: event.target.checked,
                                    }))
                                  }
                                  disabled={busy !== null}
                                />
                                Only order available items
                              </label>
                            ) : null}
                            {canSyncStx ? (
                              <button
                                className="px-2 py-1 rounded bg-green-600 text-white disabled:opacity-50"
                                onClick={() => syncStockxOrdersForOrder()}
                                disabled={busy !== null}
                              >
                                {busy === "stx-sync-order" ? "Syncing…" : "Sync StockX orders"}
                              </button>
                            ) : null}
                            {canPlaceSupplierOrder ? (
                              <button
                                className="px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50"
                                onClick={() => placeSupplierOrderForShipment(shipment.id)}
                                disabled={busy !== null}
                              >
                                {busy === `place-${shipment.id}` ? "Placing…" : "Place supplier order"}
                              </button>
                            ) : null}
                          </>
                        );
                      })()}
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
