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
  dispatchNotificationId?: string | null;
  packageId?: string | null;
  trackingNumber?: string | null;
  carrierFinal?: string | null;
  delrStatus?: string | null;
  delrFileName?: string | null;
  labelPdfUrl?: string | null;
  deliveryNotePdfUrl?: string | null;
  labelZpl?: string | null;
  shippedAt?: string | null;
  createdAt: string;
  items: ShipmentItem[];
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
  const [supplierFilter, setSupplierFilter] = useState<string>("golden");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportCheckReport, setExportCheckReport] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [ordersNextOffset, setOrdersNextOffset] = useState<number | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [opsLog, setOpsLog] = useState<string | null>(null);
  const [seedLineCount, setSeedLineCount] = useState<number>(5);
  const [packMaxPairs, setPackMaxPairs] = useState<number>(12);
  const [allowSplit, setAllowSplit] = useState<boolean>(true);
  const [syncMax, setSyncMax] = useState<number>(1000);
  const [syncAll, setSyncAll] = useState<boolean>(false);
  const [sftpConfig, setSftpConfig] = useState<{
    host?: string;
    outDir?: string;
    feedsDir?: string;
    isRealGalaxus?: boolean;
    warning?: string | null;
  } | null>(null);

  useEffect(() => {
    fetch("/api/galaxus/edi/config")
      .then((response) => response.json())
      .then((data) => setSftpConfig(data))
      .catch(() => setSftpConfig(null));
  }, []);

  const syncSupplier = async () => {
    setBusy("sync");
    setError(null);
    try {
      const params = new URLSearchParams();
      if (syncAll) {
        params.set("all", "1");
      } else {
        params.set("max", String(Math.max(syncMax, 1)));
      }
      const response = await fetch(`/api/galaxus/supplier/sync?${params.toString()}`, { method: "POST" });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Sync failed");
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
      const supplierValue = encodeURIComponent(supplierFilter);
      const response = await fetch(
        `/api/galaxus/supplier/mappings?limit=${batchLimit}&offset=${offset}&supplier=${supplierValue}`,
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

  const exportAllWithChecks = async () => {
    setBusy("export-check");
    setError(null);
    setExportCheckReport(null);
    const supplierValue = encodeURIComponent(supplierFilter);
    const exportUrls = [
      `/api/galaxus/export/master?all=1&supplier=${supplierValue}`,
      `/api/galaxus/export/stock?all=1&supplier=${supplierValue}`,
      `/api/galaxus/export/specifications?all=1&supplier=${supplierValue}`,
    ];
    exportUrls.forEach((url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    });
    try {
      const response = await fetch(
        `/api/galaxus/export/check-all?all=1&supplier=${supplierValue}`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Export checks failed");
      setExportCheckReport(JSON.stringify(data.report ?? {}, null, 2));
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
      const supplierValue = encodeURIComponent(supplierFilter);
      const response = await fetch(
        `/api/galaxus/export/stage1-check?all=1&supplier=${supplierValue}`,
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
      const supplierValue = encodeURIComponent(supplierFilter);
      const response = await fetch(
        `/api/galaxus/export/stage2-check?all=1&supplier=${supplierValue}`,
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
      const response = await fetch(`/api/galaxus/orders?limit=20&offset=${offset}`, {
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

  const seedOrder = async () => {
    setBusy("seed");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch("/api/galaxus/edi/mock-ordp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineCount: seedLineCount }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Mock ORDP failed");
      setOpsLog(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const clearSeedOrders = async () => {
    setBusy("seed-clear");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch("/api/galaxus/seed/clear", {
        method: "POST",
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? "Seed cleanup failed");
      setOpsLog(JSON.stringify(data, null, 2));
      await fetchOrders(0);
      setSelectedOrder(null);
      setSelectedOrderId("");
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

  const uploadFeeds = async () => {
    setBusy("feeds");
    setError(null);
    setOpsLog(null);
    try {
      const response = await fetch("/api/galaxus/feeds/upload", { cache: "no-store" });
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
        body: JSON.stringify({ orderId: selectedOrderId, types: ["INVO", "EXPINV"] }),
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
        body: JSON.stringify({ force: true }),
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

      {sftpConfig && (
        <div
          className={`rounded p-3 text-sm ${
            sftpConfig.warning ? "bg-amber-100 border border-amber-300" : "bg-gray-50 border"
          }`}
        >
          <strong>SFTP Target (Feeds):</strong> {sftpConfig.host ?? "—"}:{sftpConfig.feedsDir ?? sftpConfig.outDir ?? "—"}
          {sftpConfig.feedsDir && sftpConfig.outDir && sftpConfig.feedsDir !== sftpConfig.outDir && (
            <span className="ml-2 text-gray-600">EDI OUT: {sftpConfig.outDir}</span>
          )}
          {sftpConfig.isRealGalaxus && (
            <span className="ml-2 text-green-700">✓ Real Galaxus</span>
          )}
          {sftpConfig.warning && (
            <div className="mt-1 text-amber-800 font-medium">{sftpConfig.warning}</div>
          )}
        </div>
      )}

      <div className="space-y-4 border rounded p-4 bg-white">
        <div>
          <h2 className="text-lg font-semibold">Galaxus Ops Dashboard</h2>
          <p className="text-sm text-gray-500">Run the full flow without the terminal.</p>
        </div>

        <div className="flex gap-3 flex-wrap items-center">
          <button
            className="px-3 py-2 rounded bg-gray-900 text-white disabled:opacity-50"
            onClick={pollEdiIn}
            disabled={busy !== null}
          >
              {busy === "edi-in" ? "Polling…" : "Poll EDI IN (Orders)"}
          </button>
          <button
            className="px-3 py-2 rounded bg-gray-700 text-white disabled:opacity-50"
            onClick={uploadFeeds}
            disabled={busy !== null}
          >
            {busy === "feeds" ? "Uploading…" : "Upload Feeds to FTP"}
          </button>
          <button
            className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
            onClick={() => downloadFeed("product")}
            disabled={busy !== null}
          >
            Download ProductData
          </button>
          <button
            className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
            onClick={() => downloadFeed("price")}
            disabled={busy !== null}
          >
            Download PriceData
          </button>
          <button
            className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
            onClick={() => downloadFeed("stock")}
            disabled={busy !== null}
          >
            Download StockData
          </button>
          <button
            className="px-3 py-2 rounded bg-gray-700 text-white disabled:opacity-50"
            onClick={sendPendingEdiOut}
            disabled={busy !== null}
          >
            {busy === "edi-out" ? "Sending…" : "Send Pending EDI OUT"}
          </button>
          <div className="flex items-center gap-2">
            <input
              className="px-2 py-2 border rounded text-sm w-20"
              type="number"
              min={1}
              max={200}
              value={seedLineCount}
              onChange={(event) => setSeedLineCount(Number(event.target.value || 0))}
            />
            <button
              className="px-3 py-2 rounded bg-purple-600 text-white disabled:opacity-50"
              onClick={seedOrder}
              disabled={busy !== null}
            >
              {busy === "seed" ? "Creating…" : "Create Test ORDP (SFTP)"}
            </button>
            <button
              className="px-3 py-2 rounded bg-red-600 text-white disabled:opacity-50"
              onClick={clearSeedOrders}
              disabled={busy !== null}
            >
              {busy === "seed-clear" ? "Clearing…" : "Clear Test Orders"}
            </button>
          </div>
          <button
            className="px-3 py-2 rounded bg-gray-100 text-black disabled:opacity-50"
            onClick={() => fetchOrders(0)}
            disabled={busy !== null}
          >
            {busy === "orders" ? "Loading…" : "Refresh Orders"}
          </button>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Orders</div>
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
                {busy === "invoice" ? "Sending…" : "Send INVO + EXPINV"}
              </button>
            </div>
          </div>

          {selectedOrder && (
            <div className="space-y-3 border rounded p-3 bg-gray-50">
              <div className="text-xs text-gray-600">
                {selectedOrder.galaxusOrderId} · {selectedOrder.orderNumber ?? "—"} ·{" "}
                {selectedOrder.deliveryType ?? "—"}
              </div>

              <div className="overflow-auto border rounded bg-white">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left">Line</th>
                      <th className="px-2 py-1 text-left">Product</th>
                      <th className="px-2 py-1 text-left">Supplier PID</th>
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
                      {shipment.shipmentId} · SSCC {shipment.packageId ?? "—"} · DELR{" "}
                      {shipment.delrStatus ?? "—"}
                    </div>
                    <div className="flex gap-2 flex-wrap">
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

      <div className="flex gap-3 flex-wrap items-center">
        <button
          className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
          onClick={syncSupplier}
          disabled={busy !== null}
        >
          {busy === "sync" ? "Syncing…" : "Sync Catalog + Stock"}
        </button>
        <input
          className="px-2 py-2 border rounded text-sm w-28"
          type="number"
          min={1}
          value={syncMax}
          onChange={(event) => setSyncMax(Number(event.target.value || 0))}
          disabled={syncAll}
          placeholder="Max products"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={syncAll}
            onChange={(event) => setSyncAll(event.target.checked)}
          />
          Get all
        </label>
        <button
          className="px-3 py-2 rounded bg-gray-200 text-black disabled:opacity-50"
          onClick={() => loadDb(0)}
          disabled={busy !== null}
        >
          {busy === "db" ? "Loading…" : "Load DB Variants"}
        </button>
        <button
          className="px-3 py-2 rounded bg-gray-200 text-black disabled:opacity-50"
          onClick={() => loadMappings(0)}
          disabled={busy !== null}
        >
          {busy === "db-mappings" ? "Loading…" : "Load DB Mappings"}
        </button>
        <button
          className="px-3 py-2 rounded bg-green-600 text-white disabled:opacity-50"
          onClick={() => enrichKickDb(false, false)}
          disabled={busy !== null}
        >
          {busy === "enrich" ? "Enriching…" : "Enrich GTIN (KickDB)"}
        </button>
        <button
          className="px-3 py-2 rounded bg-green-100 text-green-900 disabled:opacity-50"
          onClick={() => enrichKickDb(true, true)}
          disabled={busy !== null}
        >
          {busy === "enrich" ? "Enriching…" : "Enrich GTIN (Debug + Force)"}
        </button>
        <button
          className="px-3 py-2 rounded bg-red-700 text-white disabled:opacity-50"
          onClick={() => clearSupplierData(false)}
          disabled={busy !== null}
        >
          {busy === "supplier-clear" ? "Clearing…" : "Clear Supplier Data"}
        </button>
        <button
          className="px-3 py-2 rounded bg-red-100 text-red-900 disabled:opacity-50"
          onClick={() => clearSupplierData(true)}
          disabled={busy !== null}
        >
          {busy === "supplier-clear-kickdb" ? "Clearing…" : "Clear Supplier + KickDB"}
        </button>
        <input
          className="px-2 py-2 border rounded text-sm w-28"
          value={supplierFilter}
          onChange={(event) => setSupplierFilter(event.target.value)}
          placeholder="Supplier key"
        />
        <button
          className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
          onClick={exportAllWithChecks}
          disabled={busy !== null}
        >
          {busy === "export-check" ? "Exporting…" : "Export All + Run Checks"}
        </button>
      </div>

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
                  <td className="px-2 py-1">{item.sizeRaw ?? ""}</td>
                  <td className="px-2 py-1 text-right">{item.price}</td>
                  <td className="px-2 py-1 text-right">{item.stock}</td>
                  <td className="px-2 py-1">{new Date(item.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
              {dbItems.length === 0 && (
                <tr>
                  <td className="px-2 py-3 text-gray-500" colSpan={6}>
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

      {exportCheckReport && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Export Check Report</div>
          <div className="border rounded bg-gray-50 p-3 text-xs overflow-auto whitespace-pre-wrap">
            {exportCheckReport}
          </div>
        </div>
      )}
    </div>
  );
}
