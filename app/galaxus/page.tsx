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
  supplierPid?: string | null;
  buyerPid?: string | null;
  providerKey?: string | null;
  supplierVariantId?: string | null;
};

type ShipmentItem = {
  id: string;
  supplierPid: string;
  gtin14: string;
  buyerPid?: string | null;
  quantity: number;
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
  carrierFinal?: string | null;
  delrStatus?: string | null;
  delrFileName?: string | null;
  delrSentAt?: string | null;
  labelPdfUrl?: string | null;
  deliveryNotePdfUrl?: string | null;
  labelZpl?: string | null;
  shippedAt?: string | null;
  createdAt: string;
  items: ShipmentItem[];
};

type EdiFile = {
  id: string;
  direction: string;
  docType: string;
  status: string;
  filename?: string | null;
  createdAt: string;
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
  const [schedulerStatus, setSchedulerStatus] = useState<any | null>(null);
  const [schedulerBusy, setSchedulerBusy] = useState(false);
  const [enrichSku, setEnrichSku] = useState<string>("");
  const [enrichAllStatus, setEnrichAllStatus] = useState<{
    running: boolean;
    processed: number;
    remaining: number | null;
    lastError: string | null;
    lastRunAt: string | null;
    lastResults?: Array<{ supplierVariantId: string; status: string; gtin: string | null; error?: string | null }>;
  } | null>(null);
  const [enrichAllDebugMode, setEnrichAllDebugMode] = useState<boolean>(false);
  const [partnerKey, setPartnerKey] = useState<string>("self");
  const [partnerName, setPartnerName] = useState<string>("Personal stock");
  const [partnerAccessCode, setPartnerAccessCode] = useState<string>("");
  const [partnerFile, setPartnerFile] = useState<File | null>(null);
  const [partnerAssignKey, setPartnerAssignKey] = useState<string>("self");
  const formatJobStatus = (runAt: string | null | undefined, result: any) => {
    if (!runAt) return "—";
    const status = result?.ok ? "OK" : "FAIL";
    return `${new Date(runAt).toLocaleString()} · ${status}`;
  };

  const loadSchedulerStatus = async () => {
    try {
      const res = await fetch("/api/galaxus/feeds/scheduler", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) setSchedulerStatus(data.status ?? null);
    } catch {
      // silent
    }
  };

  const loadEnrichAllStatus = async () => {
    try {
      const res = await fetch("/api/galaxus/kickdb/enrich-all", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) setEnrichAllStatus(data.status ?? null);
    } catch {
      // silent
    }
  };

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

  const ensurePartnerSession = async () => {
    const res = await fetch("/api/partners/auth/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partnerKey,
        partnerName,
        accessCode: partnerAccessCode || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error ?? "Partner access failed");
    }
    return data;
  };

  const quickPartnerAccess = async () => {
    setBusy("partner-auth");
    setError(null);
    setOpsLog(null);
    try {
      const data = await ensurePartnerSession();
      setOpsLog(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const uploadPartnerCsv = async () => {
    if (!partnerFile) {
      setError("Select a partner CSV file first.");
      return;
    }
    setBusy("partner-upload");
    setError(null);
    setOpsLog(null);
    try {
      await ensurePartnerSession();
      const formData = new FormData();
      formData.append("file", partnerFile);
      const res = await fetch("/api/partners/uploads", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Partner upload failed");
      setOpsLog(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const assignOrderToPartner = async () => {
    if (!selectedOrderId) {
      setError("Select an order first.");
      return;
    }
    if (!partnerAssignKey.trim()) {
      setError("Partner key is required.");
      return;
    }
    setBusy("partner-assign");
    setError(null);
    setOpsLog(null);
    try {
      const res = await fetch("/api/partners/orders/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: selectedOrderId,
          partnerKey: partnerAssignKey.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Partner assignment failed");
      setOpsLog(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const openPartnerDashboard = () => {
    window.location.href = "/partners/dashboard";
  };

  useEffect(() => {
    loadSchedulerStatus();
    loadRoutingSummary();
    loadVariantStats();
    loadEnrichAllStatus();
  }, []);

  const syncSupplier = async () => {
    setBusy("sync");
    setError(null);
    try {
      const response = await fetch("/api/galaxus/supplier/sync?all=1&mode=stock", {
        method: "POST",
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Sync failed");
      setOpsLog(JSON.stringify({ sync: data }, null, 2));
      await loadVariantStats();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const enrichAll = async () => {
    setBusy("enrich-all");
    setError(null);
    setOpsLog(null);
    try {
      const debugParam = enrichAllDebugMode ? "?forceMissing=1" : "";
      const response = await fetch(`/api/galaxus/kickdb/enrich-all${debugParam}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Enrich ALL failed");
      }
      setOpsLog(
        JSON.stringify(
          {
            enrichAllStarted: true,
            debugMode: enrichAllDebugMode,
            forceMissing: Boolean(data?.forceMissing),
            jobId: data?.jobId ?? null,
            remaining: data?.remaining ?? null,
          },
          null,
          2
        )
      );
      await loadEnrichAllStatus();
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
    const variantKey = line.supplierVariantId?.split(":")[0]?.trim().toUpperCase();
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


  const uploadFeed = async (type: "product" | "price" | "stock") => {
    setBusy(`feed-${type}`);
    setError(null);
    setOpsLog(null);
    try {
      const params = new URLSearchParams();
      if (type === "product") params.set("type", "master");
      if (type === "price") params.set("type", "offer");
      if (type === "stock") params.set("type", "stock");
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

  const downloadFeed = (type: "product" | "price" | "stock") => {
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
        body: JSON.stringify({ orderId: selectedOrderId, types: ["ORDR"] }),
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
        body: JSON.stringify({ orderId: selectedOrderId, types: ["INVO"] }),
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
      const response = await fetch(`/api/galaxus/shipments/${shipmentId}/delr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
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

  const placeSupplierOrderForShipment = async (shipmentId: string) => {
    setBusy(`place-${shipmentId}`);
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch(`/api/galaxus/shipments/${shipmentId}/place-supplier-order`, {
        method: "POST",
      });
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
      const response = await fetch(`/api/galaxus/shipments/${shipmentId}/docs`, {
        method: "POST",
      });
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
                  {busy === "feed-price" ? "Uploading…" : "Upload Offer"}
                </button>
                <button
                  className="px-3 py-2 rounded bg-gray-800 text-white disabled:opacity-50"
                  onClick={() => uploadFeed("stock")}
                  disabled={busy !== null}
                >
                  {busy === "feed-stock" ? "Uploading…" : "Upload Stock"}
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
                className="px-3 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
                onClick={enrichAll}
                disabled={busy !== null}
              >
                {busy === "enrich-all" ? "Starting…" : "Enrich ALL"}
              </button>
              <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={enrichAllDebugMode}
                  onChange={(e) => setEnrichAllDebugMode(e.target.checked)}
                  disabled={busy !== null}
                />
                Debug enrich (force missing)
              </label>
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
            </div>
            <div className="rounded border bg-white p-2 text-xs text-gray-600 space-y-1">
              <div>
                Enrich ALL: {enrichAllStatus?.running ? "RUNNING" : "IDLE"}
              </div>
              <div>
                Processed: {enrichAllStatus?.processed ?? 0} · Remaining:{" "}
                {enrichAllStatus?.remaining === null ? "calculating…" : enrichAllStatus?.remaining ?? 0}
              </div>
              <div>
                Last run:{" "}
                {enrichAllStatus?.lastRunAt
                  ? new Date(enrichAllStatus.lastRunAt).toLocaleString()
                  : "—"}
              </div>
              {enrichAllStatus?.lastError ? (
                <div className="text-red-600">Last error: {enrichAllStatus.lastError}</div>
              ) : null}
              <div>
                {variantStats
                  ? `Mappings: ${variantStats.withGtin} with GTIN · ${variantStats.withoutGtin} without GTIN`
                  : "Mappings: —"}
              </div>
              {enrichAllStatus?.lastResults?.length ? (
                <div className="text-xs text-gray-500">
                  Last 10 results (preview only; server processes larger batches):
                  <div className="mt-1 space-y-1">
                    {enrichAllStatus.lastResults.map((item) => (
                      <div key={item.supplierVariantId}>
                        {item.supplierVariantId} · {item.status} · {item.gtin ?? "—"}
                        {item.error ? ` · ${item.error}` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
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
          <div className="rounded border bg-gray-50 p-3 space-y-3">
            <div className="text-sm font-medium">Partner Portal</div>
            <div className="text-xs text-gray-500">
              Upload partner CSVs and assign orders without the terminal.
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <input
                className="px-2 py-2 border rounded text-sm"
                value={partnerKey}
                onChange={(event) => setPartnerKey(event.target.value)}
                placeholder="Partner key (3 letters)"
              />
              <input
                className="px-2 py-2 border rounded text-sm"
                value={partnerName}
                onChange={(event) => setPartnerName(event.target.value)}
                placeholder="Partner name"
              />
              <input
                className="px-2 py-2 border rounded text-sm"
                type="password"
                value={partnerAccessCode}
                onChange={(event) => setPartnerAccessCode(event.target.value)}
                placeholder="Access code"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="px-3 py-2 rounded bg-black text-white disabled:opacity-50"
                onClick={quickPartnerAccess}
                disabled={busy !== null}
              >
                {busy === "partner-auth" ? "Connecting…" : "Quick partner login"}
              </button>
              <button
                className="px-3 py-2 rounded bg-gray-200 text-black disabled:opacity-50"
                onClick={openPartnerDashboard}
                disabled={busy !== null}
              >
                Open partner dashboard
              </button>
              <span className="text-xs text-gray-500 self-center">
                Access code uses `PARTNER_ACCESS_{`{KEY}`}` in env.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => setPartnerFile(event.target.files?.[0] ?? null)}
              />
              <button
                className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                onClick={uploadPartnerCsv}
                disabled={busy !== null}
              >
                {busy === "partner-upload" ? "Uploading…" : "Upload partner CSV"}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="px-2 py-2 border rounded text-sm w-40"
                value={partnerAssignKey}
                onChange={(event) => setPartnerAssignKey(event.target.value)}
                placeholder="Partner key"
              />
              <button
                className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
                onClick={assignOrderToPartner}
                disabled={busy !== null}
              >
                {busy === "partner-assign" ? "Assigning…" : "Assign selected order"}
              </button>
              <span className="text-xs text-gray-500">
                Select an order first.
              </span>
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
            <input
              className="px-2 py-2 border rounded text-sm w-72"
              value={selectedOrderId}
              onChange={(event) => setSelectedOrderId(event.target.value)}
              placeholder="Order ID (DB or Galaxus ID)"
            />
            <button
              className="px-3 py-2 rounded bg-gray-200"
              onClick={() => loadOrderDetail(selectedOrderId)}
              disabled={busy !== null}
            >
              Load Order
            </button>
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
              <button
                className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                onClick={packShipments}
                disabled={busy !== null}
              >
                {busy === "pack" ? "Packing…" : "Pack + Create Shipments"}
              </button>
          <button
            className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
            onClick={placeSupplierOrder}
            disabled={busy !== null}
          >
            {busy === "supplier-order" ? "Ordering…" : "Place Supplier Order (12 pairs max)"}
          </button>
              <button
                className="px-3 py-2 rounded bg-green-600 text-white disabled:opacity-50"
                onClick={sendOrdr}
                disabled={busy !== null}
              >
                {busy === "ordr" ? "Sending…" : "Send ORDR"}
              </button>
              <button
                className="px-3 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
                onClick={sendInvoice}
                disabled={busy !== null}
              >
                {busy === "invoice" ? "Sending…" : "Send INVO"}
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
                    DELR:{" "}
                    {selectedOrder.shipments.some(
                      (shipment) =>
                        shipment.delrStatus === "UPLOADED" || Boolean(shipment.delrSentAt)
                    )
                      ? "Uploaded"
                      : "Pending"}
                  </div>
                  <div>
                    INVO: {hasEdiFile("INVO") ? "Sent" : "Pending"}
                  </div>
                </div>
              </div>

              <div className="overflow-auto border rounded bg-white">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left">Line</th>
                      <th className="px-2 py-1 text-left">Product</th>
                      <th className="px-2 py-1 text-left">Supplier PID</th>
                      <th className="px-2 py-1 text-left">ProviderKey</th>
                      <th className="px-2 py-1 text-left">GTIN</th>
                      <th className="px-2 py-1 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedOrder.lines.map((line) => (
                      <tr key={line.id} className="border-t">
                        <td className="px-2 py-1">{line.lineNumber}</td>
                        <td className="px-2 py-1">{line.productName}</td>
                        <td className="px-2 py-1">{line.supplierPid ?? ""}</td>
                        <td className="px-2 py-1">{resolveProviderKeyForLine(line)}</td>
                        <td className="px-2 py-1">{line.gtin ?? ""}</td>
                        <td className="px-2 py-1 text-right">{line.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Shipments</div>
                {selectedOrder.shipments.map((shipment) => (
                  <div key={shipment.id} className="border rounded bg-white p-2 space-y-2">
                    <div className="text-xs text-gray-600">
                      {shipment.shipmentId} · Provider {shipment.providerKey ?? "—"} · SSCC{" "}
                      {shipment.packageId ?? "—"} · DELR {shipment.delrStatus ?? "—"}
                    </div>
                    <div className="text-xs text-gray-600">
                      Supplier order: {shipment.supplierOrderRef ?? "—"} · Status{" "}
                      {shipment.boxStatus ?? "—"}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        className="px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-50"
                        onClick={() => placeSupplierOrderForShipment(shipment.id)}
                        disabled={busy !== null || (shipment.providerKey ?? "").toUpperCase() === "TRM"}
                      >
                        {(shipment.providerKey ?? "").toUpperCase() === "TRM"
                          ? "TRM disabled"
                          : busy === `place-${shipment.id}`
                            ? "Placing…"
                            : "Place supplier order"}
                      </button>
                      <button
                        className="px-2 py-1 rounded bg-purple-600 text-white"
                        onClick={() => generateDocsForShipment(shipment.id)}
                        disabled={busy !== null}
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
                        disabled={busy !== null}
                      >
                        {busy === `delr-${shipment.id}` ? "Uploading…" : "Upload DELR"}
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
                    </div>
                    <div className="overflow-auto border rounded">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-1 text-left">Supplier PID</th>
                            <th className="px-2 py-1 text-left">GTIN</th>
                            <th className="px-2 py-1 text-right">Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shipment.items.map((item) => (
                            <tr key={item.id} className="border-t">
                              <td className="px-2 py-1">{item.supplierPid}</td>
                              <td className="px-2 py-1">{item.gtin14}</td>
                              <td className="px-2 py-1 text-right">{item.quantity}</td>
                            </tr>
                          ))}
                          {shipment.items.length === 0 && (
                            <tr>
                              <td className="px-2 py-2 text-gray-500" colSpan={3}>
                                No shipment items.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
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
