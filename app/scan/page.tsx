
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  isActiveStxInboundBuy,
  shouldAutoAddToPackingSession,
  shouldAutoGalaxusDirectLabelFor,
} from "./scanInboundGuards";

type ScanStatus = "FOUND" | "NOT_FOUND" | "UNMATCHED" | "ERROR";

type ScanShopifyOrderExtras = {
  name?: string;
  customerLocale?: string | null;
  paymentGatewayNames?: string[];
  shippingLines?: string[];
  lineItems?: Array<{
    id: string;
    title: string;
    name?: string | null;
    quantity: number;
    sku?: string | null;
    variantTitle?: string | null;
  }>;
};

type ScanMatchPayload = {
  shopifyOrderId?: string | null;
  shopifyOrderName?: string | null;
  shopifyLineItemId?: string | null;
  matchConfidence?: string | null;
  matchScore?: number | null;
  trackingUrl?: string | null;
  customer?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    shippingAddress?: {
      address1?: string | null;
      address2?: string | null;
      zip?: string | null;
      city?: string | null;
      province?: string | null;
      country?: string | null;
      company?: string | null;
      name?: string | null;
    } | null;
  };
  /** Checkout chose get-in-store → AWB label ships to store, not client. */
  shipToStore?: boolean;
  isStorePickup?: boolean;
  pickupLabel?: string | null;
  pickupLocation?: string | null;
  labelShippingAddress?: {
    address1?: string | null;
    address2?: string | null;
    zip?: string | null;
    city?: string | null;
    province?: string | null;
    country?: string | null;
    company?: string | null;
    name?: string | null;
  } | null;
  lineItem?: {
    title?: string | null;
    variantTitle?: string | null;
    sku?: string | null;
    quantity?: number | null;
  };
  shopifyOrder?: ScanShopifyOrderExtras;
};

type ScanDemoChannel = "decathlon" | "galaxus";

type ScanDemoDocument = {
  parcelIndex: number;
  type: "label" | "packing_slip" | "delivery_note";
  base64: string;
  mimeType: string;
  filename: string;
};

type ScanResult = {
  ok: boolean;
  status: ScanStatus;
  awb: string;
  fulfillmentDemo?: ScanDemoChannel | null;
  match: ScanMatchPayload | null;
  decathlon?: {
    matchId?: string | null;
    orderId: string | null;
    orderDbId: string | null;
    orderNumber?: string | null;
    orderState?: string | null;
    lineId?: string | null;
    miraklOrderLineId?: string | null;
    quantity?: number | null;
    source?: "decathlon_stockx_match" | "decathlon_warehouse_shipment" | null;
    warehouseShipment?: {
      shipmentId: string;
      trackingNumber?: string | null;
      carrierRaw?: string | null;
      carrierFinal?: string | null;
      shippedAt?: string | null;
      labelGeneratedAt?: string | null;
      partnerKey?: string | null;
    } | null;
  } | null;
  galaxus?: {
    matchId?: string | null;
    orderId: string | null;
    orderDbId: string | null;
    orderNumber?: string | null;
    deliveryType?: string | null;
    isDirectDelivery?: boolean;
    allLinked?: boolean | null;
    alreadyFulfilled?: boolean;
    trackingNumber?: string | null;
    source?: "galaxus_stockx_match" | "galaxus_warehouse_shipment" | null;
    warehouseShipment?: {
      shipmentId: string;
      status?: string | null;
      packageType?: string | null;
      shipmentDeliveryType?: string | null;
      shippedAt?: string | null;
      delrStatus?: string | null;
      delrSentAt?: string | null;
      carrierFinal?: string | null;
      carrierRaw?: string | null;
      labelPdfUrl?: string | null;
      recipient?: {
        name?: string | null;
        city?: string | null;
        postalCode?: string | null;
        countryCode?: string | null;
      } | null;
    } | null;
  } | null;
  inboundHome?: {
    routeId: string;
    stockxOrderNumber: string;
    stockxAwb?: string | null;
    stockxTrackingUrl?: string | null;
  } | null;
  gtin?: {
    gtin: string;
    productName?: string | null;
    totalOpen: number;
    openDirect: number;
    openWarehouse: number;
    openShopify?: number;
    openDecathlon?: number;
    autoDirectOrderDbId?: string | null;
    autoShopify?: {
      shopifyOrderId: string;
      shopifyOrderName?: string | null;
      shopifyLineItemId: string;
    } | null;
    autoDecathlon?: {
      orderId: string;
      orderDbId: string;
      lineId: string;
      quantity: number;
    } | null;
    autoDecathlonReprint?: {
      orderId: string;
      orderDbId: string;
      shipmentId?: string | null;
    } | null;
    autoChannel?: "galaxus_direct" | "shopify" | "decathlon" | null;
    orders: Array<{
      channel?: "galaxus" | "shopify" | "decathlon";
      lineId: string;
      lineNumber?: number | null;
      productName?: string | null;
      quantity: number;
      ordered?: number;
      shipped?: number;
      reserved?: number;
      remaining?: number;
      warehouseMarkedShippedAt?: string | null;
      galaxusOrderDbId?: string;
      galaxusOrderId?: string;
      orderNumber?: string | null;
      orderDate: string;
      deliveryType?: string | null;
      isDirectDelivery?: boolean;
      ordrSentAt?: string | null;
      cancelledAt?: string | null;
      recipient: {
        name?: string | null;
        city?: string | null;
        postalCode?: string | null;
        countryCode?: string | null;
      };
      shipments?: Array<{
        id: string;
        trackingNumber?: string | null;
        status?: string | null;
        deliveryType?: string | null;
        packageType?: string | null;
        shippedAt?: string | null;
        delrStatus?: string | null;
      }>;
      stockxLinks?: Array<{
        stockxOrderNumber?: string | null;
        awb?: string | null;
        etaMin?: string | null;
        etaMax?: string | null;
        cancelledAt?: string | null;
      }>;
      hasAnyShipment?: boolean;
      hasStockxLink?: boolean;
      shopifyOrderId?: string;
      shopifyOrderName?: string | null;
      shopifyLineItemId?: string | null;
      shopifySku?: string | null;
      decathlonOrderDbId?: string;
      decathlonOrderId?: string;
      decathlonOrderState?: string | null;
    }>;
  } | null;
  stxInboundBuy?: {
    unitId: string;
    galaxusOrderDbId: string | null;
    galaxusOrderId: string | null;
    galaxusOrderNumber: string | null;
    stockxOrderNumber: string | null;
    awb: string | null;
    deliveryType: string | null;
    isDirectDelivery: boolean;
    isWarehouse: boolean;
    orderCancelledAt: string | null;
  } | null;
  shopifyMatchSuppressed?: boolean;
  error?: { message?: string; code?: string };
};

type HistoryItem = {
  ts: string;
  awb: string;
  status: ScanStatus;
  orderName?: string | null;
  durationMs?: number;
  gapMs?: number;
};

type AwbListItem = {
  awb: string;
  shopifyOrderName?: string | null;
  shopifyOrderId?: string | null;
  shopifyCreatedAt?: string | null;
  trackingUrl?: string | null;
};

type BrowserPrintConfig = {
  enabled?: boolean;
  widthMm?: number;
  heightMm?: number;
  marginMm?: number;
};

type LabelDataPayload = {
  base64?: string;
  mimeType?: string;
  extension?: string;
};

type PrintJobClientResult = {
  ok?: boolean;
  skipped?: boolean;
  message?: string;
  error?: string;
};

type FulfillResponse = {
  ok?: boolean;
  status?: string;
  error?: string;
  userErrors?: Array<{ message?: string }>;
  labelFilePath?: string | null;
  printJobResult?: PrintJobClientResult | null;
  deliveryNotePrintResult?: PrintJobClientResult | null;
  labelData?: LabelDataPayload | null;
  browserPrintConfig?: BrowserPrintConfig;
  orderNumber?: string | null;
  galaxusOrderId?: string | null;
  trackingNumber?: string | null;
  shipmentId?: string | null;
};

const resolveClientFlag = (value: string | undefined, fallback: boolean) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const ENABLE_AUTO_FULFILLMENT = resolveClientFlag(
  process.env.NEXT_PUBLIC_SCAN_AUTO_FULFILLMENT,
  true
);
const ENABLE_AUTO_HOME_RETURN = resolveClientFlag(
  process.env.NEXT_PUBLIC_SCAN_AUTO_HOME_RETURN,
  true
);
const ENABLE_AUTO_GALAXUS_DIRECT_LABEL = resolveClientFlag(
  process.env.NEXT_PUBLIC_SCAN_AUTO_GALAXUS_DIRECT_LABEL,
  true
);
const ENABLE_AUTO_GALAXUS_WAREHOUSE_LABEL = resolveClientFlag(
  process.env.NEXT_PUBLIC_SCAN_AUTO_GALAXUS_WAREHOUSE_LABEL,
  true
);
const ENABLE_BROWSER_PRINT = resolveClientFlag(
  process.env.NEXT_PUBLIC_SCAN_BROWSER_PRINT,
  true
);
const SCAN_SESSION_STORAGE_KEY = "scan.fulfillment.session.key.v1";
const PACKING_SESSION_STORAGE_KEY = "scan.packingSession.entries.v1";
const PACKING_SESSION_CAP = 8;

type PackingSessionEntry = {
  scannedAt: string;
  scanCode: string;
  galaxusOrderId: string;
  galaxusOrderDbId: string;
  galaxusOrderNumber: string | null;
  orderDate: string;
  lineId: string;
  lineNumber: number;
  unitIndex: number;
  supplierPid: string;
  gtin: string | null;
  productName: string | null;
  sizeEU: string | null;
  resolvedVia: string;
};

type PackingSessionApiResponse =
  | {
      ok: true;
      sessionCap: number;
      matched: {
        galaxusOrderId: string;
        galaxusOrderDbId: string;
        galaxusOrderNumber: string | null;
        orderDate: string;
        orderCreatedAt: string;
        lineId: string;
        lineNumber: number;
        unitIndex: number;
        supplierPid: string;
        gtin: string | null;
        productName: string | null;
        sizeEU: string | null;
        remainingBefore: number;
        resolvedVia: string;
        notes?: string[];
      };
    }
  | {
      ok: false;
      sessionCap: number;
      rejected: { reason: string; scanCode: string };
    };

type SuggestKind = "galaxus_direct" | "galaxus_warehouse" | "decathlon" | "shopify";

type SuggestItem = {
  id: string;
  kind: SuggestKind;
  orderId: string;
  orderDbId: string;
  orderNumber: string | null;
  orderDate: string;
  lineId: string;
  supplierPid: string;
  buyerPid?: string | null;
  gtin: string | null;
  productName: string;
  sizeEU?: string | null;
  deliveryType?: string | null;
  customerCity?: string | null;
};

const SUGGEST_LIMIT = 8;
const SUGGEST_DEBOUNCE_MS = 150;
const SCANNER_BURST_THRESHOLD_MS = 120;

/**
 * Heuristic: does this input value look like it was typed by a human vs
 * pasted by a barcode scanner? We only surface suggestions for typing.
 *
 * - Skip AWB/UPS/DHL shapes (1Z..., JJD..., JD..., >=8 digits pure numeric).
 * - Accept short queries (<8 chars), values that contain letters, or values
 *   with two consecutive identical chars (typists repeat, scanners don't).
 */
const looksLikeManualQuery = (value: string): boolean => {
  const v = String(value ?? "").trim();
  if (v.length < 2) return false;
  const upper = v.toUpperCase();
  if (upper.startsWith("1Z") && upper.length >= 10) return false;
  if (upper.startsWith("JJD") && upper.length >= 10) return false;
  if (upper.startsWith("JD") && upper.length >= 10) return false;
  if (/^\d{8,}$/.test(v)) return false;
  if (v.length < 8) return true;
  if (/[a-z]/i.test(v)) return true;
  if (/(.)\1/.test(v)) return true;
  return false;
};

const ensureScanSessionKey = () => {
  if (typeof window === "undefined") return null;
  try {
    const existing = String(window.localStorage.getItem(SCAN_SESSION_STORAGE_KEY) || "").trim();
    if (existing) return existing;
    const next =
      typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(SCAN_SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return null;
  }
};

const toBlobFromBase64 = (base64: string, mimeType: string) => {
  const cleaned = String(base64 || "").replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
};

const openLabelPrintDialog = (
  payload: LabelDataPayload,
  config?: BrowserPrintConfig
) => {
  const base64 = String(payload?.base64 || "").trim();
  if (!base64) return false;
  const mimeType = String(payload?.mimeType || "application/pdf");
  const labelBlob = toBlobFromBase64(base64, mimeType);
  const labelUrl = URL.createObjectURL(labelBlob);

  const widthMm =
    Number.isFinite(Number(config?.widthMm)) && Number(config?.widthMm) > 0
      ? Number(config?.widthMm)
      : 62;
  const heightMm =
    Number.isFinite(Number(config?.heightMm)) && Number(config?.heightMm) > 0
      ? Number(config?.heightMm)
      : 100;
  const marginMm =
    Number.isFinite(Number(config?.marginMm)) && Number(config?.marginMm) >= 0
      ? Number(config?.marginMm)
      : 0;

  const popup = window.open("", "_blank", "width=540,height=760");
  if (!popup) {
    URL.revokeObjectURL(labelUrl);
    return false;
  }

  const mediaNode = mimeType.startsWith("image/")
    ? `<img src="${labelUrl}" alt="Shipping label" style="width:100%;height:100%;object-fit:contain;display:block;" />`
    : `<iframe src="${labelUrl}" title="Shipping label" style="width:100%;height:100%;border:0;" />`;

  popup.document.open();
  popup.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Shipping label</title>
    <style>
      @page { size: ${widthMm}mm ${heightMm}mm; margin: ${marginMm}mm; }
      html, body { width: 100%; height: 100%; margin: 0; padding: 0; background: #fff; overflow: hidden; }
      .page { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div class="page">${mediaNode}</div>
    <script>
      window.addEventListener("load", function () {
        setTimeout(function () {
          window.focus();
          window.print();
        }, 180);
      });
      window.addEventListener("afterprint", function () {
        setTimeout(function () { window.close(); }, 200);
      });
    </script>
  </body>
</html>`);
  popup.document.close();
  setTimeout(() => URL.revokeObjectURL(labelUrl), 120000);
  return true;
};

const alertOnServerPrintFailure = (
  result: PrintJobClientResult | undefined | null,
  label = "Print"
) => {
  if (!result) return;
  if (result.ok) return;
  if (result.skipped) return;
  const detail = result.error || result.message || "unknown";
  window.alert(`${label} error: ${detail}`);
};

const openLabelPreview = (payload: LabelDataPayload) => {
  const base64 = String(payload?.base64 || "").trim();
  if (!base64) return false;
  const mimeType = String(payload?.mimeType || "application/pdf");
  const labelBlob = toBlobFromBase64(base64, mimeType);
  const labelUrl = URL.createObjectURL(labelBlob);
  const popup = window.open(labelUrl, "_blank");
  if (!popup) {
    URL.revokeObjectURL(labelUrl);
    return false;
  }
  setTimeout(() => URL.revokeObjectURL(labelUrl), 120000);
  return true;
};

/**
 * Show label to operator. Skip popup only when CUPS actually printed
 * (printJobResult.ok). VPS never succeeds CUPS → always opens popup.
 * Ignores browserPrintConfig.enabled=false from stale server paths that
 * attempted CUPS and then suppressed the popup for nothing.
 */
const presentScanLabel = (options: {
  labelData?: LabelDataPayload | null;
  browserPrintConfig?: BrowserPrintConfig | null;
  printJobResult?: PrintJobClientResult | null;
  deliveryNotePrintResult?: PrintJobClientResult | null;
  blockedMessage: string;
}): boolean => {
  const cupsOk = options.printJobResult?.ok === true;
  if (cupsOk) {
    alertOnServerPrintFailure(options.deliveryNotePrintResult, "Delivery note print");
    return true;
  }
  if (!options.labelData?.base64) return false;
  const opened = ENABLE_BROWSER_PRINT
    ? openLabelPrintDialog(options.labelData, options.browserPrintConfig ?? undefined)
    : openLabelPreview(options.labelData);
  if (!opened) {
    window.alert(options.blockedMessage);
  }
  return opened;
};

export default function ScanPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [fulfillLoading, setFulfillLoading] = useState(false);
  const [fulfillResult, setFulfillResult] = useState<FulfillResponse | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [scanSessionKey, setScanSessionKey] = useState<string | null>(null);
  const [awbList, setAwbList] = useState<AwbListItem[]>([]);
  const [awbFilter, setAwbFilter] = useState("");
  const [suggestions, setSuggestions] = useState<SuggestItem[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestFocusIdx, setSuggestFocusIdx] = useState<number>(-1);
  const suggestCacheRef = useRef<Map<string, SuggestItem[]>>(new Map());
  const suggestReqIdRef = useRef(0);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstKeystrokeAtRef = useRef<number | null>(null);
  const [packingSession, setPackingSession] = useState<PackingSessionEntry[]>([]);
  const [packingReject, setPackingReject] = useState<{ scanCode: string; reason: string } | null>(null);
  const [packingSessionReady, setPackingSessionReady] = useState<boolean>(false);
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [finalizeStatus, setFinalizeStatus] = useState<
    { tone: "ok" | "error"; text: string } | null
  >(null);
  const packingSessionRef = useRef<PackingSessionEntry[]>([]);
  useEffect(() => {
    packingSessionRef.current = packingSession;
  }, [packingSession]);
  const canceledStates = useMemo(
    () => new Set(["CANCELED", "CANCELLED", "ORDER_CANCELLED", "CLOSED"]),
    []
  );

  useEffect(() => {
    focusInput();
  }, []);

  useEffect(() => {
    setScanSessionKey(ensureScanSessionKey());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PACKING_SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setPackingSession(parsed as PackingSessionEntry[]);
          setPackingSessionReady(parsed.length >= PACKING_SESSION_CAP);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        PACKING_SESSION_STORAGE_KEY,
        JSON.stringify(packingSession)
      );
    } catch {
      // ignore
    }
  }, [packingSession]);

  useEffect(() => {
    if (suggestDebounceRef.current) {
      clearTimeout(suggestDebounceRef.current);
      suggestDebounceRef.current = null;
    }
    const q = code.trim();
    if (q.length < 2 || !looksLikeManualQuery(q)) {
      setSuggestions([]);
      setSuggestOpen(false);
      setSuggestLoading(false);
      setSuggestFocusIdx(-1);
      return;
    }
    const cached = suggestCacheRef.current.get(q.toLowerCase());
    if (cached) {
      setSuggestions(cached);
      setSuggestOpen(cached.length > 0);
      setSuggestLoading(false);
      setSuggestFocusIdx(-1);
      return;
    }
    setSuggestLoading(true);
    const reqId = ++suggestReqIdRef.current;
    suggestDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/scan-awb/suggest?q=${encodeURIComponent(q)}&limit=${SUGGEST_LIMIT}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (reqId !== suggestReqIdRef.current) return;
        if (data?.ok && Array.isArray(data.items)) {
          const items: SuggestItem[] = data.items;
          suggestCacheRef.current.set(q.toLowerCase(), items);
          setSuggestions(items);
          setSuggestOpen(items.length > 0);
        } else {
          setSuggestions([]);
          setSuggestOpen(false);
        }
      } catch {
        if (reqId === suggestReqIdRef.current) {
          setSuggestions([]);
          setSuggestOpen(false);
        }
      } finally {
        if (reqId === suggestReqIdRef.current) {
          setSuggestLoading(false);
          setSuggestFocusIdx(-1);
        }
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      if (suggestDebounceRef.current) {
        clearTimeout(suggestDebounceRef.current);
        suggestDebounceRef.current = null;
      }
    };
  }, [code]);

  useEffect(() => {
    const loadAwbList = async () => {
      try {
        const res = await fetch("/api/scan-awb?list=1&limit=500");
        const data = await res.json();
        if (data?.items) setAwbList(data.items);
      } catch {
        // Non-blocking
      }
    };
    loadAwbList();
  }, []);

  const downloadPdf = async (url: string, fallbackName: string) => {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      const data = ct.includes("application/json") ? await res.json().catch(() => ({})) : {};
      throw new Error((data as any).error ?? `Download failed (${res.status})`);
    }
    const blob = await res.blob();
    const dispo = res.headers.get("Content-Disposition") ?? "";
    const match = /filename\*?=(?:UTF-8''|)([^";\n]+)|filename="([^"]+)"/i.exec(dispo);
    const rawName = (match?.[1] || match?.[2] || "").trim();
    const filename = rawName.replace(/^["']|["']$/g, "") || fallbackName;
    const urlObj = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = urlObj;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(urlObj);
    return filename;
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const isPackingSlipPendingError = (error: any) => {
    const message = String(error?.message ?? error ?? "").toLowerCase();
    return (
      message.includes("packing slip") ||
      message.includes("delivery bill") ||
      message.includes("delivery slip") ||
      message.includes("or72") ||
      message.includes("no packing slip")
    );
  };

  const downloadPackingSlipWithRetry = async (url: string, fallbackName: string) => {
    let lastError: any = null;
    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await downloadPdf(url, fallbackName);
      } catch (err: any) {
        lastError = err;
        if (!isPackingSlipPendingError(err)) {
          break;
        }
        if (attempt < maxAttempts - 1) {
          const delay = Math.min(2000 * 1.6 ** attempt, 25000);
          await sleep(delay);
        }
      }
    }
    throw lastError;
  };

  const buildChannelAlert = (scan: ScanResult) => {
    const parts: string[] = [];
    if (scan.decathlon) {
      const ref = scan.decathlon.orderNumber || scan.decathlon.orderId || scan.decathlon.orderDbId || "—";
      parts.push(`Decathlon ${ref}`);
    }
    if (scan.galaxus) {
      const ref = scan.galaxus.orderNumber || scan.galaxus.orderId || scan.galaxus.orderDbId || "—";
      parts.push(`Galaxus ${ref}`);
    }
    if (parts.length === 0) return null;
    return `AWB ${scan.awb} → ${parts.join(" | ")}`;
  };

  const galaxusOrderRef = (g: NonNullable<ScanResult["galaxus"]>) =>
    String(g.orderNumber || g.orderId || g.orderDbId || "").trim() || "—";

  const shouldAutoGalaxusDirectLabel = (scan: ScanResult) =>
    shouldAutoGalaxusDirectLabelFor(scan);

  const runGalaxusDirectLabelFromScan = async (scan: ScanResult) => {
    if (!scan.galaxus?.orderDbId && !scan.awb) return;
    setFulfillLoading(true);
    setFulfillResult(null);
    try {
      const res = await fetch("/api/scan-galaxus-direct-label", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          awb: scan.awb,
          orderDbId: scan.galaxus?.orderDbId ?? null,
          includeLabelData: true,
          allowReprint: false,
        }),
      });
      const data: FulfillResponse & {
        orderNumber?: string | null;
        galaxusOrderId?: string | null;
        status?: string;
        trackingNumber?: string | null;
        error?: string;
      } = await res.json();
      setFulfillResult(data);
      const orderRef =
        String(data.orderNumber || data.galaxusOrderId || scan.galaxus?.orderNumber || "").trim() ||
        "—";
      if (res.ok && data.ok && data.status === "ALREADY_FULFILLED") {
        window.alert(
          `Galaxus direct ${orderRef}: already fulfilled — no reprint.`
        );
        return;
      }
      if (res.ok && data.ok && data.labelData?.base64) {
        presentScanLabel({
          labelData: data.labelData,
          browserPrintConfig: data.browserPrintConfig,
          printJobResult: data.printJobResult,
          deliveryNotePrintResult: data.deliveryNotePrintResult,
          blockedMessage:
            "Swiss Post label generated but popup blocked. Allow popups, then scan again.",
        });
      } else if (!res.ok || !data.ok) {
        window.alert(data.error || "Galaxus Swiss Post label failed");
      }
    } catch (err: any) {
      setFulfillResult({ ok: false, error: err?.message || "Network error" });
      window.alert(err?.message || "Galaxus label network error");
    } finally {
      setFulfillLoading(false);
    }
  };

  // Auto-fire direct-delivery Swiss Post label for the oldest open direct
  // order matched by GTIN when nothing matched by AWB. Same print handling as
  // runGalaxusDirectLabelFromScan (server print or browser popup). Silently
  // swallows 409 (order not fully linked / already finalized) so the operator
  // still sees the GTIN fallback panel and can pick manually.
  const runDirectLabelForOrder = async (orderDbId: string) => {
    if (!orderDbId) return;
    setFulfillLoading(true);
    setFulfillResult(null);
    try {
      const res = await fetch("/api/scan-galaxus-direct-label", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderDbId,
          includeLabelData: true,
          allowReprint: false,
        }),
      });
      const data: FulfillResponse & { error?: string; orderNumber?: string | null; galaxusOrderId?: string | null } =
        await res.json();
      setFulfillResult(data);
      if (res.status === 409) return;
      if (res.ok && data.ok && data.status === "ALREADY_FULFILLED") {
        const orderRef = String(data.galaxusOrderId || data.orderNumber || "").trim() || "—";
        window.alert(`Galaxus direct ${orderRef}: already fulfilled — no reprint.`);
        return;
      }
      const orderRef = String(data.galaxusOrderId || data.orderNumber || "").trim();
      if (res.ok && data.ok && (data.status === "CREATED" || data.status === "REPRINT")) {
        // Mark this order as done in the GTIN panel so it stops looking like both are still open.
        setResult((prev) => {
          if (!prev?.gtin?.orders?.length) return prev;
          const orders = prev.gtin.orders.map((c) => {
            const same =
              String(c.galaxusOrderDbId ?? "") === orderDbId ||
              (orderRef && String(c.galaxusOrderId ?? "") === orderRef) ||
              (data.orderNumber && String(c.orderNumber ?? "") === String(data.orderNumber));
            if (!same) return c;
            const ordered = Math.max(1, Number(c.ordered ?? c.quantity ?? 1));
            return {
              ...c,
              remaining: 0,
              shipped: Math.max(Number(c.shipped ?? 0), ordered),
            };
          });
          const openDirect = orders.filter(
            (c) =>
              (c.channel ?? "galaxus") === "galaxus" &&
              (c.isDirectDelivery || String(c.deliveryType ?? "").includes("direct")) &&
              Number(c.remaining ?? 0) > 0
          ).length;
          const totalOpen = orders.reduce((n, c) => n + Math.max(0, Number(c.remaining ?? 0)), 0);
          return {
            ...prev,
            gtin: {
              ...prev.gtin,
              orders,
              openDirect,
              totalOpen,
            },
          };
        });
        // No success alert — label popup is the operator signal.
      }
      if (res.ok && data.ok && data.labelData?.base64) {
        presentScanLabel({
          labelData: data.labelData,
          browserPrintConfig: data.browserPrintConfig,
          printJobResult: data.printJobResult,
          deliveryNotePrintResult: data.deliveryNotePrintResult,
          blockedMessage:
            "Swiss Post label generated but popup blocked. Allow popups, then scan again.",
        });
      } else if (!res.ok || !data.ok) {
        window.alert(data.error || "Galaxus Swiss Post label failed");
      }
    } catch (err: any) {
      setFulfillResult({ ok: false, error: err?.message || "Network error" });
      window.alert(err?.message || "Galaxus label network error");
    } finally {
      setFulfillLoading(false);
    }
  };

  const runGalaxusWarehouseLabelFromScan = async (scan: ScanResult) => {
    if (scan.galaxus?.source !== "galaxus_warehouse_shipment") return;
    const shipmentId = scan.galaxus.warehouseShipment?.shipmentId;
    if (!shipmentId) return;
    setFulfillLoading(true);
    setFulfillResult(null);
    try {
      const res = await fetch(
        `/api/galaxus/warehouse-shipments/${encodeURIComponent(shipmentId)}/label`,
        { method: "GET", cache: "no-store" }
      );
      const data: FulfillResponse & {
        source?: "swiss_post_document" | "sscc_label";
        trackingNumber?: string | null;
      } = await res.json();
      setFulfillResult(data);
      if (res.ok && data.ok && data.labelData?.base64) {
        presentScanLabel({
          labelData: data.labelData,
          browserPrintConfig: data.browserPrintConfig,
          printJobResult: data.printJobResult,
          blockedMessage:
            "Warehouse label loaded but popup blocked. Allow popups, then scan again.",
        });
      } else if (res.status === 404) {
        window.alert(
          "Warehouse shipment has no label attached yet — open warehouse page to generate it."
        );
      } else {
        window.alert(data.error || "Warehouse label fetch failed");
      }
    } catch (err: any) {
      setFulfillResult({ ok: false, error: err?.message || "Network error" });
      window.alert(err?.message || "Warehouse label network error");
    } finally {
      setFulfillLoading(false);
    }
  };

  const resolveDecathlonOrderRef = (match: ScanResult["decathlon"]) =>
    match?.orderId || match?.orderDbId || "";

  const runFulfillmentDemoFromScan = async (scan: ScanResult) => {
    if (!scan.fulfillmentDemo || !scan.awb) return;
    setFulfillLoading(true);
    setFulfillResult(null);
    try {
      const res = await fetch("/api/scan-fulfillment-demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: scan.awb }),
      });
      const data: {
        ok?: boolean;
        error?: string;
        channel?: ScanDemoChannel;
        documents?: ScanDemoDocument[];
        browserPrintConfig?: BrowserPrintConfig;
      } = await res.json();
      if (!res.ok || !data.ok || !data.documents?.length) {
        throw new Error(data.error || "Demo document generation failed");
      }

      const browserPrintEnabled = ENABLE_BROWSER_PRINT && (data.browserPrintConfig?.enabled ?? true);
      let openedLabels = 0;
      for (const doc of data.documents) {
        if (doc.type === "label") {
          const opened = browserPrintEnabled
            ? openLabelPrintDialog(
                { base64: doc.base64, mimeType: doc.mimeType },
                data.browserPrintConfig
              )
            : openLabelPreview({ base64: doc.base64, mimeType: doc.mimeType });
          if (opened) openedLabels += 1;
        } else {
          await downloadPdfFromBase64(doc.base64, doc.mimeType, doc.filename);
        }
      }

      const labelCount = data.documents.filter((doc) => doc.type === "label").length;
      const slipCount = data.documents.filter(
        (doc) => doc.type === "packing_slip" || doc.type === "delivery_note"
      ).length;
      const channelLabel = data.channel === "decathlon" ? "Decathlon (T4 long)" : "Galaxus direct";
      window.alert(
        `${channelLabel} demo ${scan.awb}\n` +
          `${openedLabels}/${labelCount} label print dialog(s) opened.\n` +
          `${slipCount} packing/delivery PDF(s) downloaded.\n` +
          `No Mirakl, Galaxus EDI, or Swiss Post API calls were made.`
      );
      setFulfillResult({ ok: true, status: "DEMO" });
    } catch (error: any) {
      setFulfillResult({ ok: false, error: error?.message || "Demo failed" });
      window.alert(error?.message || "Demo document generation failed");
    } finally {
      setFulfillLoading(false);
    }
  };

  const downloadPdfFromBase64 = async (base64: string, mimeType: string, filename: string) => {
    const blob = toBlobFromBase64(base64, mimeType || "application/pdf");
    const urlObj = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = urlObj;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(urlObj);
  };

  const printDecathlonLabelForOrder = async (orderRef: string) => {
    try {
      // CUPS reprint (uses SWISS_POST_PRINTER_MEDIA = 62x100mm).
      void fetch(`/api/decathlon/orders/${encodeURIComponent(orderRef)}/documents/label`, {
        method: "POST",
      }).catch(() => null);

      const res = await fetch(
        `/api/decathlon/orders/${encodeURIComponent(orderRef)}/documents/label`
      );
      if (!res.ok) return false;
      const blob = await res.blob();
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      if (ENABLE_BROWSER_PRINT) {
        openLabelPrintDialog(
          { base64, mimeType: "application/pdf", extension: "pdf" },
          { enabled: true, widthMm: 62, heightMm: 100, marginMm: 0 }
        );
      }
      return true;
    } catch {
      return false;
    }
  };

  const reprintDecathlonDocs = async (options: {
    orderId: string;
    shipmentId?: string | null;
  }) => {
    const orderRef = options.orderId;
    if (!orderRef) return;
    const shipmentId = String(options.shipmentId ?? "").trim();
    const slipUrl = shipmentId
      ? `/api/decathlon/orders/${orderRef}/documents/packing-slip?shipmentId=${encodeURIComponent(shipmentId)}`
      : `/api/decathlon/orders/${orderRef}/documents/packing-slip`;
    const slipName = shipmentId
      ? `decathlon-delivery_${orderRef}_${shipmentId}.pdf`
      : `decathlon-delivery_${orderRef}.pdf`;
    try {
      await downloadPackingSlipWithRetry(slipUrl, slipName);
    } catch {
      // OR72 may still be generating.
    }
    const printed = await printDecathlonLabelForOrder(orderRef);
    window.alert(
      printed
        ? `Decathlon ${orderRef}: packing slip + Swiss Post label reprinted.`
        : `Decathlon ${orderRef}: packing slip requested; label reprint failed (no stored PDF?).`
    );
  };

  const autoHandleDecathlon = async (match: ScanResult["decathlon"], awb: string) => {
    const orderRef = resolveDecathlonOrderRef(match);
    if (!orderRef) return;
    const state = String(match?.orderState ?? "").trim().toUpperCase();
    if (state && canceledStates.has(state)) {
      window.alert(`Decathlon order ${orderRef} is canceled; skipping fulfillment.`);
      return;
    }
    const lineId = String(match?.lineId ?? "").trim();
    const qty = Number(match?.quantity ?? 0) || 0;
    if (!lineId || qty <= 0) {
      window.alert(
        `Decathlon auto-fulfill skipped: missing line match for AWB ${awb || "(gtin)"}. Link AWB to line first.`
      );
      return;
    }
    try {
      const shipRes = await fetch(`/api/decathlon/orders/${orderRef}/ship`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trackingNumber: awb,
          items: [{ lineId, quantity: qty }],
        }),
      });
      const shipData = await shipRes.json().catch(() => ({}));
      if (!shipRes.ok || !shipData.ok) {
        // Already shipped on Mirakl/DB → fall back to reprint docs.
        const msg = String(shipData.error ?? "").toLowerCase();
        if (
          msg.includes("already shipped") ||
          msg.includes("already ship") ||
          shipRes.status === 400
        ) {
          await reprintDecathlonDocs({ orderId: orderRef, shipmentId: null });
          return;
        }
        throw new Error(shipData.error ?? "Decathlon ship failed");
      }
      const shipmentId = String(shipData?.shipmentId ?? "").trim();
      const slipUrl = shipmentId
        ? `/api/decathlon/orders/${orderRef}/documents/packing-slip?shipmentId=${encodeURIComponent(shipmentId)}`
        : `/api/decathlon/orders/${orderRef}/documents/packing-slip`;
      const slipName = shipmentId
        ? `decathlon-delivery_${orderRef}_${shipmentId}.pdf`
        : `decathlon-delivery_${orderRef}.pdf`;
      let slipNote = "Packing slip not ready yet (OR72). Try again later.";
      try {
        const fn = await downloadPackingSlipWithRetry(slipUrl, slipName);
        slipNote = `Packing slip downloaded (${fn}).`;
      } catch {
        // Non-blocking: shipping can be ok while OR72 is still generating.
      }
      const labelPrinted = await printDecathlonLabelForOrder(orderRef);
      const labelNote = labelPrinted
        ? "Swiss Post label sent to printer / print dialog."
        : "Label stored but browser print failed.";
      if (shipData.reconciled) {
        window.alert(
          `Decathlon order ${orderRef}: Mirakl was already shipped; your dashboard DB is now synced. ${slipNote} ${labelNote}`
        );
      } else {
        window.alert(`Decathlon order ${orderRef} shipped. ${slipNote} ${labelNote}`);
      }
    } catch (error: any) {
      window.alert(
        `Decathlon auto-fulfill failed for AWB ${awb || "(gtin)"}: ${error?.message ?? "Unknown error"}`
      );
    }
  };

  const handleChannelActions = async (scan: ScanResult) => {
    if (scan.fulfillmentDemo) {
      await runFulfillmentDemoFromScan(scan);
      return;
    }
    if (scan.inboundHome && ENABLE_AUTO_HOME_RETURN) {
      await runReturnToHomeFromScan(scan);
      return;
    }
    if (scan.galaxus) {
      const ref = galaxusOrderRef(scan.galaxus);
      const isWarehouseFallback = scan.galaxus.source === "galaxus_warehouse_shipment";
      if (isWarehouseFallback) {
        const ws = scan.galaxus.warehouseShipment;
        const recipient = ws?.recipient
          ? [ws.recipient.name, ws.recipient.postalCode, ws.recipient.city, ws.recipient.countryCode]
              .filter(Boolean)
              .join(" · ")
          : "";
        const shippedAt = ws?.shippedAt ? new Date(ws.shippedAt).toLocaleString("de-CH") : "—";
        window.alert(
          `Galaxus warehouse order ${ref}\nAWB matched on Shipment.trackingNumber (no direct-delivery match).\n` +
            `Shipment: ${ws?.packageType ?? "PARCEL"} · ${ws?.shipmentDeliveryType ?? "warehouse"} · shipped ${shippedAt}\n` +
            `Carrier: ${ws?.carrierFinal ?? ws?.carrierRaw ?? "—"}\n` +
            `DELR: ${ws?.delrStatus ?? "—"}${ws?.delrSentAt ? ` (sent ${new Date(ws.delrSentAt).toLocaleString("de-CH")})` : ""}\n` +
            (recipient ? `Recipient: ${recipient}` : "")
        );
        if (
          ENABLE_AUTO_GALAXUS_WAREHOUSE_LABEL &&
          ws?.shipmentId &&
          !isActiveStxInboundBuy(scan)
        ) {
          await runGalaxusWarehouseLabelFromScan(scan);
        }
      } else if (scan.galaxus.isDirectDelivery) {
        if (ENABLE_AUTO_GALAXUS_DIRECT_LABEL && shouldAutoGalaxusDirectLabel(scan)) {
          await runGalaxusDirectLabelFromScan(scan);
        } else if (scan.galaxus.allLinked === false) {
          window.alert(
            `Galaxus direct delivery ${ref}\nAWB linked but order not fully linked yet — link all lines first.`
          );
        } else if (!ENABLE_AUTO_GALAXUS_DIRECT_LABEL) {
          window.alert(`Galaxus direct delivery ${ref}\nAuto label disabled — use Direct Delivery page.`);
        }
      } else {
        window.alert(
          `Galaxus — order ${ref}\nAWB is stored on GalaxusStockxMatch (marketplace).\nNo Shopify label / fulfill on this page.`
        );
      }
    } else if (
      ENABLE_AUTO_GALAXUS_DIRECT_LABEL &&
      scan.stxInboundBuy?.isDirectDelivery &&
      scan.stxInboundBuy.galaxusOrderDbId &&
      !scan.stxInboundBuy.orderCancelledAt
    ) {
      // AWB hit StxPurchaseUnit for a direct-delivery order but galaxusMatch
      // payload was missing — still auto-print Swiss Post label via orderDbId.
      await runDirectLabelForOrder(scan.stxInboundBuy.galaxusOrderDbId);
    }
    if (scan.decathlon) {
      const isDecWarehouseFallback = scan.decathlon.source === "decathlon_warehouse_shipment";
      if (isDecWarehouseFallback) {
        const ws = scan.decathlon.warehouseShipment;
        const ref =
          scan.decathlon.orderNumber ||
          scan.decathlon.orderId ||
          scan.decathlon.orderDbId ||
          "—";
        window.alert(
          `Decathlon warehouse order ${ref}\nAWB matched on DecathlonShipment.trackingNumber.\n` +
            `Carrier: ${ws?.carrierFinal ?? ws?.carrierRaw ?? "—"}\n` +
            `Shipped: ${ws?.shippedAt ? new Date(ws.shippedAt).toLocaleString("de-CH") : "—"}`
        );
      } else {
        if (!scan.galaxus) {
          const alertText = buildChannelAlert(scan);
          if (alertText) window.alert(alertText);
        }
        await autoHandleDecathlon(scan.decathlon, scan.awb);
      }
    } else if (!scan.galaxus) {
      const alertText = buildChannelAlert(scan);
      if (alertText) window.alert(alertText);
    }
  };

  const focusInput = () => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  /**
   * Best-effort packing-session resolver. Runs after the main scan.
   * - If scan resolves to a pending warehouse pair, appends to the local box.
   * - Silently no-ops on non-warehouse scans that were handled by other channels
   *   (direct delivery, home return, decathlon warehouse fallback) so the box
   *   isn't polluted.
   * - When mainScanHandled is false and no pair matches, surfaces reject reason
   *   as red text on the panel (never as an alert).
   */
  const tryAddScanToPackingSession = async (
    scanCode: string,
    opts: { mainScanHandled: boolean }
  ) => {
    if (!scanCode.trim()) return;
    const current = packingSessionRef.current;
    if (current.length >= PACKING_SESSION_CAP) {
      // Don't nag when a direct-delivery / home-return / decathlon scan already ran.
      if (!opts.mainScanHandled) {
        setPackingReject({
          scanCode,
          reason: `Session full (${PACKING_SESSION_CAP}/${PACKING_SESSION_CAP}) — pack + close first.`,
        });
      }
      return;
    }
    try {
      const res = await fetch("/api/scan-awb/packing-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scanCode,
          scanSessionKey,
          session: current.map((e) => ({
            galaxusOrderId: e.galaxusOrderId,
            galaxusOrderLineId: e.lineId,
            unitIndex: e.unitIndex,
            supplierPid: e.supplierPid,
            gtin: e.gtin,
          })),
        }),
      });
      const data: PackingSessionApiResponse = await res.json();
      if (data.ok) {
        setPackingReject(null);
        const entry: PackingSessionEntry = {
          scannedAt: new Date().toISOString(),
          scanCode,
          galaxusOrderId: data.matched.galaxusOrderId,
          galaxusOrderDbId: data.matched.galaxusOrderDbId,
          galaxusOrderNumber: data.matched.galaxusOrderNumber,
          orderDate: data.matched.orderDate,
          lineId: data.matched.lineId,
          lineNumber: data.matched.lineNumber,
          unitIndex: data.matched.unitIndex,
          supplierPid: data.matched.supplierPid,
          gtin: data.matched.gtin,
          productName: data.matched.productName,
          sizeEU: data.matched.sizeEU,
          resolvedVia: data.matched.resolvedVia,
        };
        setPackingSession((prev) => {
          // Dedup: same lineId + unitIndex should never appear twice.
          if (prev.some((p) => p.lineId === entry.lineId && p.unitIndex === entry.unitIndex)) {
            return prev;
          }
          const next = [...prev, entry];
          if (next.length >= PACKING_SESSION_CAP) setPackingSessionReady(true);
          // Stale success/error line invalid once box changes.
          setFinalizeStatus(null);
          return next;
        });
      } else if (!opts.mainScanHandled) {
        // Only nag when nothing else claimed this scan.
        setPackingReject({
          scanCode,
          reason: data.rejected?.reason || "Rejected",
        });
      }
    } catch (err: any) {
      if (!opts.mainScanHandled) {
        setPackingReject({
          scanCode,
          reason: err?.message || "Network error",
        });
      }
    }
  };

  const closeSuggestions = () => {
    setSuggestOpen(false);
    setSuggestFocusIdx(-1);
    firstKeystrokeAtRef.current = null;
  };

  const handleFinalizeSession = async () => {
    if (finalizeBusy) return;
    const snapshot = packingSessionRef.current;
    if (snapshot.length === 0) return;
    const entries = snapshot.map((e) => ({
      galaxusOrderDbId: e.galaxusOrderDbId,
      galaxusOrderLineId: e.lineId,
      unitIndex: e.unitIndex,
      supplierPid: e.supplierPid,
      gtin: e.gtin,
      productName: e.productName,
    }));

    // Pre-open exactly 3 tabs in the click handler (popup-blocker safe).
    // Do NOT pass "noopener" — that makes window.open return null while still
    // leaving orphan about:blank tabs (user saw ~5 blank pages).
    const DOC_URLS_PER_SHIPMENT = 3; // packing slip, Swiss Post label, SSCC
    const preOpened: Window[] = [];
    for (let i = 0; i < DOC_URLS_PER_SHIPMENT; i += 1) {
      try {
        const win = window.open("about:blank", "_blank");
        if (win) {
          try {
            win.opener = null;
          } catch {
            // ignore
          }
          preOpened.push(win);
        }
      } catch {
        // ignore
      }
    }
    const consumeTab = (url: string) => {
      const tab = preOpened.shift();
      if (tab && !tab.closed) {
        try {
          tab.location.href = url;
          return;
        } catch {
          try {
            tab.close();
          } catch {
            // ignore
          }
        }
      }
      try {
        window.open(url, "_blank");
      } catch {
        // ignore
      }
    };
    const closeLeftoverTabs = () => {
      while (preOpened.length > 0) {
        const leftover = preOpened.shift();
        try {
          leftover?.close();
        } catch {
          // ignore
        }
      }
    };

    setFinalizeBusy(true);
    setFinalizeStatus(null);
    try {
      const res = await fetch("/api/scan-awb/packing-session/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries, scanSessionKey }),
      });
      const data = await res.json().catch(() => ({}));
      const results: Array<{
        ok?: boolean;
        error?: string;
        ssccUrl?: string | null;
        packingSlipUrl?: string | null;
        labelUrl?: string | null;
      }> = Array.isArray(data?.results) ? data.results : [];

      // Open SSCC → packing slip → Swiss Post label (warehouse UI order).
      for (const r of results) {
        if (!r?.ok) continue;
        if (r.ssccUrl) consumeTab(r.ssccUrl);
        if (r.packingSlipUrl) consumeTab(r.packingSlipUrl);
        if (r.labelUrl) consumeTab(r.labelUrl);
      }
      closeLeftoverTabs();

      const total = results.length || 0;
      const failCount = Number(data?.errorCount ?? results.filter((r) => !r?.ok).length);
      if (res.ok && data?.ok && total > 0 && failCount === 0) {
        setFinalizeStatus({
          tone: "ok",
          text:
            total === 1
              ? `1 composite warehouse shipment done (${entries.length} pairs) — same as warehouse builder`
              : `${total} composite shipments done (${entries.length} pairs)`,
        });
        // Auto-clear: only on full success. Partial failures keep entries so
        // operator can retry. `packingSession` effect persists [] to
        // localStorage key `scan.packingSession.entries.v1` automatically.
        setPackingSession([]);
        setPackingSessionReady(false);
      } else if (total > 0) {
        const firstError =
          results.find((r) => !r?.ok)?.error || data?.error || "unknown error";
        setFinalizeStatus({
          tone: "error",
          text: `${failCount}/${total} failed: ${firstError}`,
        });
      } else {
        setFinalizeStatus({
          tone: "error",
          text: `${entries.length}/${entries.length} failed: ${
            data?.error || `HTTP ${res.status}`
          }`,
        });
      }
    } catch (err: any) {
      closeLeftoverTabs();
      setFinalizeStatus({
        tone: "error",
        text: `${entries.length}/${entries.length} failed: ${err?.message || "Network error"}`,
      });
    } finally {
      setFinalizeBusy(false);
    }
  };

  const handleSuggestionSelect = (item: SuggestItem) => {
    const canonical =
      item.gtin || item.supplierPid || item.buyerPid || item.orderNumber || item.orderId || "";
    setCode(canonical);
    closeSuggestions();
    // Run scan with the canonical code so we don't wait for React state.
    void handleSubmit(canonical);
  };

  const handleSubmit = async (overrideCode?: string) => {
    const startedAt = Date.now();
    const rawCode = overrideCode !== undefined ? overrideCode : code;
    const scanCodeForPacking = String(rawCode ?? "").trim();
    if (!scanCodeForPacking) {
      setResult({
        ok: false,
        status: "UNMATCHED",
        awb: "",
      } as ScanResult);
      focusInput();
      return;
    }
    setLoading(true);
    let mainScanHandled = false;
    let hasActiveStxInboundBuy = false;
    let inboundBuyForPacking: {
      orderCancelledAt: string | null;
      isWarehouse: boolean;
      isDirectDelivery: boolean;
    } | null = null;
    try {
      const res = await fetch("/api/scan-awb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: rawCode, scanSessionKey }),
      });
      const data: ScanResult = await res.json();
      setResult(data);
      const finishedAt = Date.now();
      setHistory((prev) => {
        const prevTs = prev[0]?.ts ? new Date(prev[0].ts).getTime() : null;
        const entry: HistoryItem = {
          ts: new Date().toISOString(),
          awb: data.awb,
          status: data.status,
          orderName: data.match?.shopifyOrderName,
          durationMs: finishedAt - startedAt,
          gapMs: prevTs ? startedAt - prevTs : undefined,
        };
        return [entry, ...prev].slice(0, 20);
      });

      hasActiveStxInboundBuy = isActiveStxInboundBuy(data);
      if (data.stxInboundBuy) {
        inboundBuyForPacking = {
          orderCancelledAt: data.stxInboundBuy.orderCancelledAt ?? null,
          isWarehouse: Boolean(data.stxInboundBuy.isWarehouse),
          isDirectDelivery: Boolean(data.stxInboundBuy.isDirectDelivery),
        };
      }

      // "Handled" means some channel took ownership. Used to silence packing
      // reject noise when the scan was legitimately a non-warehouse-pair path.
      mainScanHandled = Boolean(
        data.ok ||
          data.fulfillmentDemo ||
          data.inboundHome ||
          data.galaxus ||
          data.decathlon ||
          data.match ||
          data.gtin
      );

      await handleChannelActions(data);

      // GTIN fallback auto-fulfill: AWB miss + product barcode hit.
      // Oldest open across Galaxus direct / Shopify / Decathlon (server picks
      // via `gtin.autoChannel`). Skip when any other channel already claimed.
      const gtinBlockedByOtherChannel =
        Boolean(data.galaxus) ||
        Boolean(data.inboundHome) ||
        Boolean(data.match) ||
        Boolean(data.stxInboundBuy) ||
        Boolean(data.decathlon);
      const gtinAutoChannel = !gtinBlockedByOtherChannel
        ? data.gtin?.autoChannel ?? null
        : null;

      if (gtinAutoChannel === "galaxus_direct") {
        const gtinAutoDirectOrderDbId =
          data.gtin?.autoDirectOrderDbId && (data.gtin.openDirect ?? 0) > 0
            ? data.gtin.autoDirectOrderDbId
            : null;
        if (ENABLE_AUTO_GALAXUS_DIRECT_LABEL && gtinAutoDirectOrderDbId) {
          await runDirectLabelForOrder(gtinAutoDirectOrderDbId);
        }
      } else if (gtinAutoChannel === "shopify" && ENABLE_AUTO_FULFILLMENT && data.gtin?.autoShopify) {
        const auto = data.gtin.autoShopify;
        await runFulfillFromScan(
          {
            ...data,
            ok: true,
            status: "FOUND",
            match: {
              shopifyOrderId: auto.shopifyOrderId,
              shopifyOrderName: auto.shopifyOrderName ?? null,
              shopifyLineItemId: auto.shopifyLineItemId,
              trackingUrl: null,
            },
          },
          {
            scanStartedAt: new Date(startedAt).toISOString(),
            scanCompletedAt: new Date(finishedAt).toISOString(),
            gtinFulfill: true,
          }
        );
      } else if (gtinAutoChannel === "decathlon" && data.gtin?.autoDecathlon) {
        const auto = data.gtin.autoDecathlon;
        // Do not pass product GTIN as Mirakl tracking — ship route falls back to
        // orderId then replaces with Swiss Post barcode after label generation.
        await autoHandleDecathlon(
          {
            orderId: auto.orderId,
            orderDbId: auto.orderDbId,
            orderNumber: null,
            orderState: null,
            lineId: auto.lineId,
            quantity: auto.quantity,
            source: null,
          },
          ""
        );
      } else if (
        !gtinBlockedByOtherChannel &&
        !gtinAutoChannel &&
        data.gtin?.autoDecathlonReprint?.orderId
      ) {
        // GTIN hit an already-shipped Decathlon line — reprint packing slip + label.
        await reprintDecathlonDocs({
          orderId: data.gtin.autoDecathlonReprint.orderId,
          shipmentId: data.gtin.autoDecathlonReprint.shipmentId,
        });
      }

      if (
        ENABLE_AUTO_FULFILLMENT &&
        data.ok &&
        data.match &&
        !data.galaxus &&
        !data.inboundHome &&
        !data.stxInboundBuy
      ) {
        await runFulfillFromScan(data, {
          scanStartedAt: new Date(startedAt).toISOString(),
          scanCompletedAt: new Date(finishedAt).toISOString(),
        });
      }
    } catch (err: any) {
      setResult({
        ok: false,
        status: "ERROR",
        awb: "",
        match: null,
        error: { message: err?.message || "Network error" },
      });
    } finally {
      setLoading(false);
      // Non-blocking: resolve packing-session assignment in the background so
      // scanner focus returns immediately. Warehouse inbound StockX buys MUST
      // be added to the box. Direct-delivery inbounds are skipped.
      const scanShapeForGuard = {
        stxInboundBuy: inboundBuyForPacking,
      };
      if (shouldAutoAddToPackingSession(scanShapeForGuard)) {
        void tryAddScanToPackingSession(scanCodeForPacking, { mainScanHandled });
      }
      focusInput();
    }
  };

  const formatDuration = (ms?: number) => {
    if (ms == null) return "—";
    if (ms < 1000) return `${ms}ms`;
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${min}m ${rem.toFixed(0)}s`;
  };

  const formatFulfillErrorMessage = (data: { ok?: boolean; status?: string; error?: string } | null) => {
    if (!data || data.ok) return "";
    const err = String(data.error || "").toLowerCase();
    const st = String(data.status || "");
    if (st === "SHOPIFY_ERROR" && err.includes("order not found")) {
      return "login to shopify order not found, manual search";
    }
    return String(data.error || "");
  };

  const runReturnToHomeFromScan = async (scan: ScanResult) => {
    if (!scan?.inboundHome) return;
    const code = scan.awb || scan.inboundHome.stockxAwb || scan.inboundHome.stockxOrderNumber;
    if (!code) return;
    setFulfillLoading(true);
    setFulfillResult(null);
    try {
      const res = await fetch("/api/scan-return-to-home", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, includeLabelData: true }),
      });
      const data: FulfillResponse = await res.json();
      setFulfillResult(data);
      if (res.ok && data.ok && data.labelData?.base64) {
        presentScanLabel({
          labelData: data.labelData,
          browserPrintConfig: data.browserPrintConfig,
          printJobResult: data.printJobResult,
          blockedMessage:
            "Home label generated but popup blocked. Allow popups, then scan again.",
        });
      } else if (!res.ok || !data.ok) {
        window.alert(data.error || "Home label generation failed");
      }
    } catch (err: any) {
      setFulfillResult({ ok: false, error: err?.message || "Network error" });
      window.alert(err?.message || "Home label network error");
    } finally {
      setFulfillLoading(false);
    }
  };

  const runFulfillFromScan = async (
    scan: ScanResult,
    options?: {
      allowAlreadyFulfilled?: boolean;
      scanStartedAt?: string;
      scanCompletedAt?: string;
      gtinFulfill?: boolean;
    }
  ) => {
    if (!scan?.awb || !scan?.match || scan.galaxus) return;
    const allowAlreadyFulfilled = Boolean(options?.allowAlreadyFulfilled);
    const gtinFulfill = Boolean(options?.gtinFulfill);
    setFulfillLoading(true);
    setFulfillResult(null);
    try {
      const res = await fetch("/api/fulfill-from-awb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          awb: scan.awb,
          trackingUrl: scan.match?.trackingUrl || null,
          shopifyLineItemId: scan.match?.shopifyLineItemId || null,
          includeLabelData: true,
          allowAlreadyFulfilled,
          gtinFulfill,
          // Clients need the Shopify shipping email with Swiss Post tracking.
          notifyCustomer: true,
          scanSessionKey,
          scanStartedAt: options?.scanStartedAt ?? null,
          scanCompletedAt: options?.scanCompletedAt ?? null,
        }),
      });
      const data: FulfillResponse = await res.json();
      setFulfillResult(data);
      if (res.ok && data.ok && data.labelData?.base64) {
        presentScanLabel({
          labelData: data.labelData,
          browserPrintConfig: data.browserPrintConfig,
          printJobResult: data.printJobResult,
          blockedMessage:
            "Label generated but popup blocked. Allow popups for this page, then scan again.",
        });
      } else if (!res.ok || !data.ok) {
        window.alert(
          formatFulfillErrorMessage(data) ||
            data.error ||
            data.userErrors?.[0]?.message ||
            `Label/fulfill failed (${data.status || res.status})`
        );
      } else if (!data.labelData?.base64) {
        window.alert(
          data.status === "ALREADY_FULFILLED"
            ? "Order already fulfilled — no new Swiss Post label. Use Force fulfill to print label only."
            : "Match OK but Swiss Post label missing from response. Try Force fulfill."
        );
      }
    } catch (err: any) {
      setFulfillResult({ ok: false, error: err?.message || "Network error" });
      window.alert(err?.message || "Fulfill network error");
    } finally {
      setFulfillLoading(false);
    }
  };

  const handleFulfill = async () => {
    if (!result?.awb || !result?.match || result.galaxus || result.stxInboundBuy) return;
    await runFulfillFromScan(result);
  };

  const handleForceFulfill = async () => {
    if (!result?.awb || !result?.match || result.galaxus || result.stxInboundBuy) return;
    await runFulfillFromScan(result, { allowAlreadyFulfilled: true });
  };


  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  const statusColor = useMemo(() => {
    const s = result?.status;
    if (s === "FOUND") return "bg-green-50 border-green-200 text-green-800";
    if (s === "NOT_FOUND" || s === "UNMATCHED") return "bg-yellow-50 border-yellow-200 text-yellow-800";
    if (s === "ERROR") return "bg-red-50 border-red-200 text-red-800";
    return "bg-gray-50 border-gray-200 text-gray-800";
  }, [result?.status]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center p-6">
      <div className="w-full max-w-3xl relative">
        <div className="absolute right-0 top-0 flex items-center gap-2">
          <a
            href="/scan/stats"
            className="px-3 py-1 text-sm bg-emerald-100 text-emerald-900 rounded hover:bg-emerald-200 transition-colors"
          >
            Timing
          </a>
          <a
            href="https://admin.shopify.com/store/resell-lausanne"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200 transition-colors"
          >
            Shopify Login
          </a>
          <button
            onClick={handleLogout}
            className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
          >
            Logout
          </button>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-4 text-center">📦 Scan AWB / Barcode</h1>

        <div className="bg-white rounded-lg shadow p-6 flex flex-col items-center gap-4">
          <div className="relative w-full">
            <input
              ref={inputRef}
              value={code}
              onChange={(e) => {
                const next = e.target.value;
                const prevEmpty = code.length === 0;
                if (prevEmpty && next.length > 0) {
                  firstKeystrokeAtRef.current = Date.now();
                } else if (next.length === 0) {
                  firstKeystrokeAtRef.current = null;
                }
                setCode(next);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  if (suggestOpen && suggestions.length > 0) {
                    e.preventDefault();
                    setSuggestFocusIdx((i) => (i + 1) % suggestions.length);
                  }
                  return;
                }
                if (e.key === "ArrowUp") {
                  if (suggestOpen && suggestions.length > 0) {
                    e.preventDefault();
                    setSuggestFocusIdx((i) =>
                      i <= 0 ? suggestions.length - 1 : i - 1
                    );
                  }
                  return;
                }
                if (e.key === "Escape") {
                  if (suggestOpen) {
                    e.preventDefault();
                    closeSuggestions();
                  }
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  const startedAt = firstKeystrokeAtRef.current;
                  const isScannerBurst =
                    startedAt !== null &&
                    Date.now() - startedAt < SCANNER_BURST_THRESHOLD_MS;
                  if (
                    !isScannerBurst &&
                    suggestOpen &&
                    suggestFocusIdx >= 0 &&
                    suggestions[suggestFocusIdx]
                  ) {
                    handleSuggestionSelect(suggestions[suggestFocusIdx]);
                    return;
                  }
                  closeSuggestions();
                  void handleSubmit();
                }
              }}
              onBlur={() => {
                // Delay so mousedown on a row still fires selection.
                setTimeout(() => setSuggestOpen(false), 120);
              }}
              onFocus={() => {
                if (suggestions.length > 0 && looksLikeManualQuery(code)) {
                  setSuggestOpen(true);
                }
              }}
              placeholder="Scan AWB / barcode (GTIN / SKU auto-adds to packing box)"
              className="w-full text-center text-xl px-4 py-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            {suggestOpen && (suggestLoading || suggestions.length > 0) && (
              <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-gray-300 rounded-lg shadow-lg max-h-96 overflow-y-auto text-left">
                {suggestLoading && suggestions.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500 flex items-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
                    Searching…
                  </div>
                ) : null}
                {(() => {
                  const rows: JSX.Element[] = [];
                  let lastGroup: string | null = null;
                  suggestions.forEach((item, idx) => {
                    const groupKey =
                      (item.gtin || "").trim() ||
                      item.productName.trim().toLowerCase();
                    if (lastGroup !== null && groupKey !== lastGroup) {
                      rows.push(
                        <div
                          key={`div-${idx}`}
                          className="h-px bg-gray-200 mx-2"
                        />
                      );
                    }
                    lastGroup = groupKey;
                    const isFocus = idx === suggestFocusIdx;
                    const kindLabel =
                      item.kind === "galaxus_direct"
                        ? "Direct"
                        : item.kind === "galaxus_warehouse"
                          ? "Warehouse"
                          : item.kind === "shopify"
                            ? "Shopify"
                            : "Decathlon";
                    const kindClass =
                      item.kind === "galaxus_direct"
                        ? "bg-teal-100 text-teal-900"
                        : item.kind === "galaxus_warehouse"
                          ? "bg-sky-100 text-sky-900"
                          : item.kind === "shopify"
                            ? "bg-emerald-100 text-emerald-900"
                            : "bg-amber-100 text-amber-900";
                    rows.push(
                      <button
                        type="button"
                        key={item.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSuggestionSelect(item);
                        }}
                        onMouseEnter={() => setSuggestFocusIdx(idx)}
                        className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 last:border-b-0 ${
                          isFocus ? "bg-indigo-50" : "bg-white hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium text-gray-900 truncate">
                            {item.productName}
                          </div>
                          <span
                            className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${kindClass}`}
                          >
                            {kindLabel}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-600 mt-0.5 flex flex-wrap gap-x-2">
                          <span>Size {item.sizeEU || "—"}</span>
                          <span className="font-mono">
                            SKU {item.supplierPid || "—"}
                          </span>
                          <span className="font-mono">
                            GTIN {item.gtin || "—"}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                          <span className="font-mono">
                            {item.orderNumber || item.orderId}
                          </span>
                          <span>
                            {new Date(item.orderDate).toLocaleDateString("de-CH")}
                          </span>
                          {item.customerCity ? <span>{item.customerCity}</span> : null}
                        </div>
                      </button>
                    );
                  });
                  return rows;
                })()}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleSubmit()}
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400"
            >
              {loading ? "Searching..." : "Search"}
            </button>
            <button
              onClick={() => {
                setCode("");
                setResult(null);
                closeSuggestions();
                focusInput();
              }}
              className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md hover:bg-gray-200"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Packing session panel — always visible. Empty until first warehouse-pair scan lands. */}
        <div className="mt-6 border rounded-lg bg-white shadow p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="text-base font-semibold text-gray-900">
                Packing session · {packingSession.length}/{PACKING_SESSION_CAP} pairs
              </div>
              <div className="flex gap-2">
                {packingSession.length > 0 && packingSession.length < PACKING_SESSION_CAP && (
                  <button
                    type="button"
                    onClick={() => setPackingSessionReady(true)}
                    className="px-3 py-1.5 text-sm rounded bg-green-700 text-white hover:bg-green-800"
                  >
                    Mark session ready (Done)
                  </button>
                )}
                {packingSession.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setPackingSession([]);
                      setPackingSessionReady(false);
                      setPackingReject(null);
                      setFinalizeStatus(null);
                      setFinalizeBusy(false);
                    }}
                    className="px-3 py-1.5 text-sm rounded bg-gray-200 text-gray-800 hover:bg-gray-300"
                  >
                    Clear session
                  </button>
                )}
              </div>
            </div>

            {packingReject && (
              <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                <span className="font-mono">{packingReject.scanCode || "(empty)"}</span>{" "}
                — {packingReject.reason}
              </div>
            )}

            {packingSession.length === 0 ? (
              <p className="text-sm text-gray-600">
                Scan an AWB / GTIN / SKU per pair. Each scan is FIFO-matched to the oldest pending
                warehouse Galaxus order that still needs that shoe.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b text-gray-600 text-left">
                      <th className="py-1 pr-2">#</th>
                      <th className="py-1 pr-2">Shoe</th>
                      <th className="py-1 pr-2">Size</th>
                      <th className="py-1 pr-2">GTIN / PID</th>
                      <th className="py-1 pr-2">Order</th>
                      <th className="py-1 pr-2">Order date</th>
                      <th className="py-1 pr-2">Unit</th>
                      <th className="py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {packingSession.map((e, idx) => (
                      <tr key={`${e.lineId}-${e.unitIndex}-${idx}`} className="border-b align-top">
                        <td className="py-1 pr-2 font-mono">{idx + 1}</td>
                        <td className="py-1 pr-2">
                          {e.productName || "—"}
                          <div className="text-[10px] text-gray-500">
                            line #{e.lineNumber} · via {e.resolvedVia}
                          </div>
                        </td>
                        <td className="py-1 pr-2">{e.sizeEU || "—"}</td>
                        <td className="py-1 pr-2 font-mono">
                          {e.gtin || "—"}
                          <div className="text-[10px] text-gray-500">{e.supplierPid || "—"}</div>
                        </td>
                        <td className="py-1 pr-2 font-mono">
                          {e.galaxusOrderId}
                          {e.galaxusOrderNumber ? ` (${e.galaxusOrderNumber})` : ""}
                        </td>
                        <td className="py-1 pr-2 whitespace-nowrap">
                          {new Date(e.orderDate).toLocaleDateString("de-CH")}
                        </td>
                        <td className="py-1 pr-2">#{e.unitIndex + 1}</td>
                        <td className="py-1 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              const next = packingSession.filter((_, i) => i !== idx);
                              setPackingSession(next);
                              if (next.length < PACKING_SESSION_CAP) {
                                setPackingSessionReady(false);
                              }
                            }}
                            className="text-red-700 hover:underline text-[11px]"
                          >
                            remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(packingSessionReady || packingSession.length >= PACKING_SESSION_CAP) &&
              packingSession.length > 0 && (
                <div className="mt-4 rounded-lg border border-green-400 bg-green-50 p-4 text-green-950">
                  <div className="font-semibold text-green-900">
                    Session ready — one warehouse shipment
                  </div>
                  <p className="text-sm mt-1">
                    Put the {packingSession.length} pair
                    {packingSession.length === 1 ? "" : "s"} in one box. One button = same as
                    warehouse builder: <strong>one composite Shipment</strong> across these
                    orders (one SSCC, one Swiss Post label, one delivery note). DELR only for
                    the pairs in this box — not the rest of each order.
                  </p>
                  <p className="text-xs mt-1 text-green-800">
                    Reminder: put the Swiss Post label + delivery note (+ any required customs docs)
                    inside the parcel before sealing.
                  </p>
                  <div className="mt-3 space-y-2">
                    {(() => {
                      const byOrder = new Map<
                        string,
                        {
                          dbId: string;
                          orderId: string;
                          orderNumber: string | null;
                          orderDate: string;
                          count: number;
                        }
                      >();
                      for (const e of packingSession) {
                        const key = e.galaxusOrderDbId;
                        const prev = byOrder.get(key);
                        if (prev) {
                          prev.count += 1;
                        } else {
                          byOrder.set(key, {
                            dbId: e.galaxusOrderDbId,
                            orderId: e.galaxusOrderId,
                            orderNumber: e.galaxusOrderNumber,
                            orderDate: e.orderDate,
                            count: 1,
                          });
                        }
                      }
                      const rows = Array.from(byOrder.values()).sort(
                        (a, b) =>
                          new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime()
                      );
                      if (finalizeStatus) {
                        return (
                          <div
                            className={`rounded border px-3 py-2 text-sm font-medium ${
                              finalizeStatus.tone === "ok"
                                ? "border-green-500 bg-white text-green-900"
                                : "border-red-500 bg-white text-red-800"
                            }`}
                          >
                            {finalizeStatus.text}
                          </div>
                        );
                      }
                      return (
                        <>
                          {rows.map((r) => (
                            <div
                              key={r.dbId}
                              className="rounded border border-green-300 bg-white px-3 py-2 text-sm"
                            >
                              <span className="font-mono">{r.orderId}</span>
                              {r.orderNumber ? ` (${r.orderNumber})` : ""} ·{" "}
                              <span className="text-gray-600">
                                {new Date(r.orderDate).toLocaleDateString("de-CH")}
                              </span>{" "}
                              · {r.count} pair{r.count === 1 ? "" : "s"}
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => void handleFinalizeSession()}
                            disabled={finalizeBusy || packingSession.length === 0}
                            className="w-full mt-1 px-3 py-2 rounded bg-green-700 text-white text-sm font-semibold hover:bg-green-800 disabled:opacity-50"
                          >
                            {finalizeBusy
                              ? "Creating composite shipment…"
                              : `Pack box — 1 shipment (${packingSession.length} pairs · ${rows.length} order${rows.length === 1 ? "" : "s"})`}
                          </button>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}
        </div>

        {/* Result */}
        {result && (
          <div className={`mt-6 border rounded-lg p-4 ${statusColor}`}>
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Status: {result.status}</div>
              <div className="text-sm text-gray-600">AWB: {result.awb || "—"}</div>
            </div>
            {result.stxInboundBuy && (
              <div className="mt-4 rounded-lg border border-fuchsia-300 bg-fuchsia-50 p-4 text-fuchsia-950">
                <div className="font-semibold text-fuchsia-900">
                  Inbound StockX buy → Galaxus{" "}
                  {result.stxInboundBuy.isDirectDelivery ? "direct-delivery" : "warehouse"} order
                </div>
                <p className="text-sm mt-1">
                  Galaxus order:{" "}
                  <span className="font-mono">
                    {result.stxInboundBuy.galaxusOrderNumber ||
                      result.stxInboundBuy.galaxusOrderId ||
                      "—"}
                  </span>
                  {result.stxInboundBuy.stockxOrderNumber ? (
                    <>
                      {" "}
                      · StockX{" "}
                      <span className="font-mono">{result.stxInboundBuy.stockxOrderNumber}</span>
                    </>
                  ) : null}
                  {result.stxInboundBuy.awb ? (
                    <>
                      {" "}
                      · AWB <span className="font-mono">{result.stxInboundBuy.awb}</span>
                    </>
                  ) : null}
                </p>
                <p className="text-xs mt-1 text-fuchsia-800">
                  {result.stxInboundBuy.isDirectDelivery
                    ? "Shopify auto-fulfill blocked (stale OrderMatch). Galaxus Swiss Post label auto-prints for this direct-delivery inbound."
                    : "Shopify auto-fulfill blocked. Warehouse inbound — pair goes to packing session, not a Shopify customer label."}
                  {result.shopifyMatchSuppressed ? " (Stale OrderMatch with same AWB suppressed.)" : ""}
                </p>
                {result.stxInboundBuy.isDirectDelivery && result.stxInboundBuy.galaxusOrderDbId ? (
                  <a
                    href={`/galaxus/direct-delivery`}
                    className="mt-2 inline-block text-sm font-medium text-fuchsia-800 underline hover:text-fuchsia-950"
                  >
                    Open Direct Delivery →
                  </a>
                ) : result.stxInboundBuy.galaxusOrderDbId ? (
                  <a
                    href={`/galaxus/warehouse?orderId=${encodeURIComponent(result.stxInboundBuy.galaxusOrderDbId)}`}
                    className="mt-2 inline-block text-sm font-medium text-fuchsia-800 underline hover:text-fuchsia-950"
                  >
                    Open Galaxus warehouse for this order →
                  </a>
                ) : null}
              </div>
            )}
            {result.inboundHome && (
              <div className="mt-4 rounded-lg border border-violet-300 bg-violet-50 p-4 text-violet-950">
                <div className="font-semibold text-violet-900">Inbound StockX → home</div>
                <p className="text-sm mt-1">
                  Order <span className="font-mono">{result.inboundHome.stockxOrderNumber}</span>
                  {result.inboundHome.stockxAwb ? (
                    <>
                      {" "}
                      · AWB <span className="font-mono">{result.inboundHome.stockxAwb}</span>
                    </>
                  ) : null}
                </p>
                <p className="text-sm mt-1 text-violet-800">
                  Scan generates Swiss Post label to Solutions Manzinali, Chemin de bas de plan 6, 1030 Bussigny.
                </p>
                <button
                  type="button"
                  onClick={() => void runReturnToHomeFromScan(result)}
                  disabled={fulfillLoading}
                  className="mt-2 px-3 py-1.5 rounded bg-violet-800 text-white text-sm disabled:opacity-50"
                >
                  {fulfillLoading ? "Generating…" : "Print home label"}
                </button>
              </div>
            )}
            {result.fulfillmentDemo && (
              <div className="mt-4 rounded-lg border border-indigo-300 bg-indigo-50 p-4 text-indigo-950">
                <div className="font-semibold text-indigo-900">Fulfillment demo mode</div>
                <p className="text-sm mt-1">
                  Code <span className="font-mono">{result.awb}</span> ·{" "}
                  {result.fulfillmentDemo === "decathlon"
                    ? "Decathlon T4 long (2 parcels: label + packing slip each)"
                    : "Galaxus direct delivery (label + delivery note)"}
                </p>
                <p className="text-xs mt-1 text-indigo-800">
                  Offline demo — no Mirakl, Galaxus EDI, or live Swiss Post calls.
                </p>
                <button
                  type="button"
                  onClick={() => void runFulfillmentDemoFromScan(result)}
                  disabled={fulfillLoading}
                  className="mt-2 px-3 py-1.5 rounded bg-indigo-800 text-white text-sm disabled:opacity-50"
                >
                  {fulfillLoading ? "Generating…" : "Run demo documents again"}
                </button>
              </div>
            )}
            {result.galaxus?.source === "galaxus_warehouse_shipment" && (
              <div className="mt-4 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sky-950">
                <div className="font-semibold text-sky-900">
                  Galaxus warehouse shipment (fallback)
                </div>
                <p className="text-sm mt-1">
                  Order:{" "}
                  <span className="font-mono">{galaxusOrderRef(result.galaxus)}</span>
                  {result.galaxus.warehouseShipment?.packageType ? (
                    <> · {result.galaxus.warehouseShipment.packageType}</>
                  ) : null}
                  {result.galaxus.warehouseShipment?.shipmentDeliveryType ? (
                    <> · {result.galaxus.warehouseShipment.shipmentDeliveryType}</>
                  ) : null}
                </p>
                <p className="text-sm mt-1">
                  AWB matched on{" "}
                  <code className="text-xs bg-sky-100 px-1 rounded">Shipment.trackingNumber</code>{" "}
                  — no direct-delivery match, order is a warehouse shipment.
                </p>
                <div className="text-sm mt-2 grid grid-cols-1 md:grid-cols-2 gap-1">
                  <div>
                    Carrier:{" "}
                    {result.galaxus.warehouseShipment?.carrierFinal ??
                      result.galaxus.warehouseShipment?.carrierRaw ??
                      "—"}
                  </div>
                  <div>
                    Shipped:{" "}
                    {result.galaxus.warehouseShipment?.shippedAt
                      ? new Date(result.galaxus.warehouseShipment.shippedAt).toLocaleString("de-CH")
                      : "—"}
                  </div>
                  <div>
                    DELR: {result.galaxus.warehouseShipment?.delrStatus ?? "—"}
                    {result.galaxus.warehouseShipment?.delrSentAt
                      ? ` (${new Date(result.galaxus.warehouseShipment.delrSentAt).toLocaleString("de-CH")})`
                      : ""}
                  </div>
                  <div>
                    Recipient:{" "}
                    {[
                      result.galaxus.warehouseShipment?.recipient?.name,
                      result.galaxus.warehouseShipment?.recipient?.postalCode,
                      result.galaxus.warehouseShipment?.recipient?.city,
                      result.galaxus.warehouseShipment?.recipient?.countryCode,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </div>
                </div>
                <a
                  href="/galaxus/warehouse"
                  className="mt-2 inline-block text-sm font-medium text-sky-800 underline hover:text-sky-950"
                >
                  Open Galaxus warehouse →
                </a>
              </div>
            )}
            {result.decathlon?.source === "decathlon_warehouse_shipment" && (
              <div className="mt-4 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sky-950">
                <div className="font-semibold text-sky-900">
                  Decathlon warehouse shipment (fallback)
                </div>
                <p className="text-sm mt-1">
                  Order:{" "}
                  <span className="font-mono">
                    {result.decathlon.orderNumber ||
                      result.decathlon.orderId ||
                      result.decathlon.orderDbId ||
                      "—"}
                  </span>
                </p>
                <p className="text-sm mt-1">
                  AWB matched on{" "}
                  <code className="text-xs bg-sky-100 px-1 rounded">
                    DecathlonShipment.trackingNumber
                  </code>
                  .
                </p>
                <div className="text-sm mt-2 grid grid-cols-1 md:grid-cols-2 gap-1">
                  <div>
                    Carrier:{" "}
                    {result.decathlon.warehouseShipment?.carrierFinal ??
                      result.decathlon.warehouseShipment?.carrierRaw ??
                      "—"}
                  </div>
                  <div>
                    Shipped:{" "}
                    {result.decathlon.warehouseShipment?.shippedAt
                      ? new Date(result.decathlon.warehouseShipment.shippedAt).toLocaleString("de-CH")
                      : "—"}
                  </div>
                </div>
              </div>
            )}
            {result.galaxus && !result.fulfillmentDemo && result.galaxus.source !== "galaxus_warehouse_shipment" && (
              <div className="mt-4 rounded-lg border border-teal-300 bg-teal-50 p-4 text-teal-950">
                <div className="font-semibold text-teal-900">
                  Galaxus {result.galaxus.isDirectDelivery ? "direct delivery" : "marketplace"}
                </div>
                <p className="text-sm mt-1">
                  Order ref: <span className="font-mono">{galaxusOrderRef(result.galaxus)}</span>
                  {result.galaxus.isDirectDelivery ? (
                    <>
                      {" "}
                      ·{" "}
                      {result.galaxus.allLinked === false
                        ? "Not fully linked"
                        : result.galaxus.alreadyFulfilled
                          ? "Fulfilled"
                          : "Linked"}
                      {result.galaxus.trackingNumber ? (
                        <>
                          {" "}
                          · Post <span className="font-mono">{result.galaxus.trackingNumber}</span>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <> — AWB linked on <code className="text-xs bg-teal-100 px-1 rounded">GalaxusStockxMatch</code>. No Shopify label step here.</>
                  )}
                </p>
                {result.galaxus.isDirectDelivery ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void runGalaxusDirectLabelFromScan(result)}
                      disabled={fulfillLoading || result.galaxus.allLinked === false}
                      className="px-3 py-1.5 rounded bg-teal-800 text-white text-sm disabled:opacity-50"
                    >
                      {fulfillLoading ? "Generating…" : "Generate Swiss Post label"}
                    </button>
                    <a
                      href="/galaxus/direct-delivery"
                      className="px-3 py-1.5 rounded bg-teal-100 text-teal-900 text-sm font-medium hover:bg-teal-200"
                    >
                      Open Direct Delivery →
                    </a>
                  </div>
                ) : (
                  <a
                    href="/galaxus/warehouse"
                    className="mt-2 inline-block text-sm font-medium text-teal-800 underline hover:text-teal-950"
                  >
                    Open Galaxus warehouse →
                  </a>
                )}
              </div>
            )}
            {result.gtin && (
              <div className="mt-4 rounded-lg border border-fuchsia-300 bg-fuchsia-50 p-4 text-fuchsia-950">
                <div className="font-semibold text-fuchsia-900">
                  Product GTIN {result.gtin.gtin}
                  {result.gtin.productName ? ` — ${result.gtin.productName}` : ""}
                </div>
                <p className="text-sm mt-1">
                  {result.gtin.totalOpen} open · {result.gtin.openDirect} Galaxus direct ·{" "}
                  {result.gtin.openWarehouse} Galaxus warehouse · {result.gtin.openShopify ?? 0}{" "}
                  Shopify · {result.gtin.openDecathlon ?? 0} Decathlon (of{" "}
                  {result.gtin.orders.length} recent lines).
                </p>
                <p className="text-xs mt-1 text-fuchsia-800">
                  No shipping AWB matched this code; treating it as a product GTIN. Oldest open
                  Galaxus-direct / Shopify / Decathlon line auto-fulfills.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-fuchsia-300 text-fuchsia-900 text-left">
                        <th className="py-1 pr-2">Channel</th>
                        <th className="py-1 pr-2">Order</th>
                        <th className="py-1 pr-2">Type</th>
                        <th className="py-1 pr-2">Ordered</th>
                        <th className="py-1 pr-2">Recipient</th>
                        <th className="py-1 pr-2">Qty</th>
                        <th className="py-1 pr-2">Remaining</th>
                        <th className="py-1 pr-2">Shipped/Reserved</th>
                        <th className="py-1">Ref</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.gtin.orders.map((o) => {
                        const remaining = Number(o.remaining ?? 0);
                        const closed = remaining <= 0 || Boolean(o.cancelledAt);
                        const channel = o.channel ?? "galaxus";
                        const orderLabel =
                          channel === "shopify"
                            ? o.shopifyOrderName || o.shopifyOrderId || o.orderNumber || "—"
                            : channel === "decathlon"
                              ? o.decathlonOrderId || o.orderNumber || "—"
                              : `${o.galaxusOrderId ?? ""}${o.orderNumber ? ` (${o.orderNumber})` : ""}`;
                        const typeLabel =
                          channel === "shopify"
                            ? "shopify"
                            : channel === "decathlon"
                              ? "decathlon"
                              : o.isDirectDelivery
                                ? "direct"
                                : o.deliveryType || "warehouse";
                        const refLabel =
                          channel === "shopify"
                            ? o.shopifySku || o.shopifyLineItemId || "—"
                            : channel === "decathlon"
                              ? o.decathlonOrderState || "—"
                              : (o.stockxLinks ?? [])
                                  .map((l) => l.stockxOrderNumber || l.awb)
                                  .filter(Boolean)
                                  .join(", ") || "—";
                        return (
                          <tr
                            key={`${channel}:${o.lineId}`}
                            className={
                              "border-b border-fuchsia-200 align-top " +
                              (closed ? "opacity-60" : "")
                            }
                          >
                            <td className="py-1 pr-2">
                              <span className="inline-block px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-900">
                                {channel}
                              </span>
                            </td>
                            <td className="py-1 pr-2 font-mono">{orderLabel}</td>
                            <td className="py-1 pr-2">
                              <span
                                className={
                                  "inline-block px-1.5 py-0.5 rounded " +
                                  (typeLabel === "direct"
                                    ? "bg-teal-100 text-teal-900"
                                    : typeLabel === "shopify"
                                      ? "bg-emerald-100 text-emerald-900"
                                      : typeLabel === "decathlon"
                                        ? "bg-orange-100 text-orange-900"
                                        : "bg-sky-100 text-sky-900")
                                }
                              >
                                {typeLabel}
                              </span>
                            </td>
                            <td className="py-1 pr-2 whitespace-nowrap">
                              {new Date(o.orderDate).toLocaleDateString("de-CH")}
                            </td>
                            <td className="py-1 pr-2">
                              {[
                                o.recipient?.name,
                                o.recipient?.postalCode,
                                o.recipient?.city,
                                o.recipient?.countryCode,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </td>
                            <td className="py-1 pr-2">{o.quantity}</td>
                            <td className="py-1 pr-2">
                              {closed ? (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">
                                  {o.cancelledAt ? "cancelled" : "closed"}
                                </span>
                              ) : (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 font-semibold">
                                  {remaining} left
                                </span>
                              )}
                            </td>
                            <td className="py-1 pr-2 whitespace-nowrap">
                              {(o.shipped ?? 0)}/{(o.reserved ?? 0)}
                              {o.warehouseMarkedShippedAt ? " · marked" : ""}
                            </td>
                            <td className="py-1 font-mono text-[10px]">{refLabel}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {result.error && (
              <p className="text-sm mt-2 text-red-700">
                {result.error.message || "Error"} {result.error.code ? `(${result.error.code})` : ""}
              </p>
            )}

            {result.match && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="bg-white bg-opacity-80 p-3 rounded border">
                  <h3 className="font-semibold text-gray-800 mb-1">Order</h3>
                  <div>Order #: {result.match.shopifyOrderName || "—"}</div>
                  <div>Order ID: {result.match.shopifyOrderId || "—"}</div>
                  <div>Line Item ID: {result.match.shopifyLineItemId || "—"}</div>
                  <div>Match: {result.match.matchConfidence || "—"} ({result.match.matchScore ?? "—"})</div>
                </div>
                <div className="bg-white bg-opacity-80 p-3 rounded border">
                  <h3 className="font-semibold text-gray-800 mb-1">Customer</h3>
                  <div>Name: {result.match.customer?.name || "—"}</div>
                  <div>Email: {result.match.customer?.email || "—"}</div>
                  <div>Phone: {result.match.customer?.phone || "—"}</div>
                  {result.match.shipToStore || result.match.isStorePickup ? (
                    <div className="mt-2 p-2 rounded border border-amber-300 bg-amber-50 text-amber-950">
                      <div className="font-semibold">
                        Ship to store · {result.match.pickupLabel || result.match.pickupLocation || "Store pickup"}
                      </div>
                      <div className="text-sm mt-1">
                        Label address:{" "}
                        {result.match.labelShippingAddress
                          ? [
                              result.match.labelShippingAddress.company,
                              result.match.labelShippingAddress.name
                                ? `(${result.match.labelShippingAddress.name})`
                                : null,
                              result.match.labelShippingAddress.address1,
                              result.match.labelShippingAddress.address2,
                              result.match.labelShippingAddress.zip,
                              result.match.labelShippingAddress.city,
                              result.match.labelShippingAddress.country,
                            ]
                              .filter(Boolean)
                              .join(", ")
                          : "—"}
                      </div>
                    </div>
                  ) : (
                    <div>
                      Address:{" "}
                      {result.match.customer?.shippingAddress
                        ? [
                            result.match.customer.shippingAddress.company,
                            result.match.customer.shippingAddress.address1,
                            result.match.customer.shippingAddress.address2,
                            result.match.customer.shippingAddress.zip,
                            result.match.customer.shippingAddress.city,
                            result.match.customer.shippingAddress.country,
                          ]
                            .filter(Boolean)
                            .join(", ")
                        : "—"}
                    </div>
                  )}
                </div>
                <div className="bg-white bg-opacity-80 p-3 rounded border md:col-span-2">
                  <h3 className="font-semibold text-gray-800 mb-1">Item</h3>
                  <div>Title: {result.match.lineItem?.title || "—"}</div>
                  <div>Variant/Size: {result.match.lineItem?.variantTitle || "—"}</div>
                  <div>SKU: {result.match.lineItem?.sku || "—"}</div>
                  <div>Qty: {result.match.lineItem?.quantity ?? "—"}</div>
                  <div>Tracking URL: {result.match.trackingUrl || "—"}</div>
                </div>
                {result.match.shopifyOrder && (
                  <div className="bg-white bg-opacity-80 p-3 rounded border md:col-span-2 text-xs space-y-1">
                    <h3 className="font-semibold text-gray-800 text-sm mb-1">Shopify order</h3>
                    <div>Name: {result.match.shopifyOrder.name || "—"}</div>
                    <div>Locale: {result.match.shopifyOrder.customerLocale || "—"}</div>
                    <div>
                      Payment:{" "}
                      {(result.match.shopifyOrder.paymentGatewayNames || []).join(", ") || "—"}
                    </div>
                    <div>
                      Shipping lines:{" "}
                      {(result.match.shopifyOrder.shippingLines || []).join(" · ") || "—"}
                    </div>
                    {(result.match.shopifyOrder.lineItems || []).length > 0 && (
                      <div className="mt-2 overflow-x-auto">
                        <div className="font-medium text-gray-700 mb-0.5">All line items</div>
                        <table className="w-full border-collapse text-left">
                          <thead>
                            <tr className="border-b text-gray-600">
                              <th className="py-0.5 pr-2">Qty</th>
                              <th className="py-0.5 pr-2">Title</th>
                              <th className="py-0.5 pr-2">Variant</th>
                              <th className="py-0.5">SKU</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.match.shopifyOrder.lineItems!.map((li) => (
                              <tr key={li.id} className="border-b border-gray-100">
                                <td className="py-0.5 pr-2">{li.quantity}</td>
                                <td className="py-0.5 pr-2">{li.title}</td>
                                <td className="py-0.5 pr-2">{li.variantTitle || "—"}</td>
                                <td className="py-0.5 font-mono">{li.sku || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {ENABLE_AUTO_FULFILLMENT && (
              <div className="mt-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={fulfillLoading || Boolean(result?.galaxus) || Boolean(result?.stxInboundBuy)}
                    onClick={handleFulfill}
                    className="px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400"
                    title={
                      result?.stxInboundBuy
                        ? "AWB is inbound StockX parcel for a Galaxus buy — do not print customer label"
                        : result?.galaxus
                          ? "Galaxus orders: no Shopify label on this page"
                          : undefined
                    }
                  >
                    {fulfillLoading ? "Processing..." : "Fulfill + Print Label"}
                  </button>
                  <button
                    disabled={fulfillLoading || Boolean(result?.galaxus) || Boolean(result?.stxInboundBuy)}
                    onClick={handleForceFulfill}
                    className="px-3 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:bg-gray-400"
                    title={
                      result?.stxInboundBuy
                        ? "AWB is inbound StockX parcel for a Galaxus buy — do not print customer label"
                        : result?.galaxus
                          ? "Galaxus orders: no Shopify label on this page"
                          : undefined
                    }
                  >
                    {fulfillLoading ? "Processing..." : "Force Fulfill"}
                  </button>
                </div>
                {result?.stxInboundBuy ? (
                  <p className="text-xs text-gray-600 mt-1">
                    Disabled: AWB is an inbound StockX parcel for Galaxus{" "}
                    {result.stxInboundBuy.isDirectDelivery ? "direct-delivery" : "warehouse"} order{" "}
                    <span className="font-mono">{result.stxInboundBuy.galaxusOrderNumber || result.stxInboundBuy.galaxusOrderId}</span>.
                    Old OrderMatch row with the same AWB was suppressed.
                  </p>
                ) : result?.galaxus ? (
                  <p className="text-xs text-gray-600 mt-1">Disabled: scan matched GalaxusStockxMatch (marketplace).</p>
                ) : null}
                <p className="text-xs text-gray-600 mt-1">
                  Force fulfill fulfills every remaining line on the order, then prints a label even if Shopify already
                  has tracking.
                </p>
                {fulfillResult && (
                  <div className="mt-3 text-sm">
                    {fulfillResult.ok ? (
                      <div className="text-green-700 space-y-0.5">
                        <div>
                          ✅ {fulfillResult.status}
                          {fulfillResult.galaxusOrderId || fulfillResult.orderNumber
                            ? ` · order ${fulfillResult.galaxusOrderId || fulfillResult.orderNumber}`
                            : ""}
                        </div>
                        {fulfillResult.trackingNumber ? (
                          <div className="text-xs font-mono text-green-800">
                            Tracking {fulfillResult.trackingNumber}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="text-red-700">
                        ❌ {fulfillResult.status || "ERROR"}{" "}
                        {formatFulfillErrorMessage(fulfillResult) ||
                          fulfillResult.userErrors?.[0]?.message ||
                          ""}
                      </div>
                    )}
                  </div>
                )}
                {(fulfillResult?.labelFilePath || fulfillResult?.printJobResult) && (
                  <div className="mt-3 text-xs text-gray-700 whitespace-pre-wrap break-words">
                    <div className={fulfillResult?.ok ? "text-green-700" : "text-red-700"}>
                      {fulfillResult?.ok ? "✅ Label generated" : "❌ Label error"}
                    </div>
                    {fulfillResult?.labelFilePath && (
                      <div className="text-gray-500">
                        Stored at <span className="font-mono">{fulfillResult.labelFilePath}</span>
                      </div>
                    )}
                    {fulfillResult?.printJobResult && (
                      <div className="mt-1 text-gray-600">
                        {fulfillResult.printJobResult.ok
                          ? "Print job sent to the configured printer"
                          : fulfillResult.printJobResult.skipped
                          ? `Print skipped: ${fulfillResult.printJobResult.message || "disabled"}`
                          : `Print error: ${
                              fulfillResult.printJobResult.error ||
                              fulfillResult.printJobResult.message ||
                              "unknown"
                            }`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="mt-8 bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">Scan History (last 20)</h3>
              <button
                onClick={() => setHistory([])}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                Clear history
              </button>
            </div>
            <div className="space-y-2 text-sm">
              {history.map((h, idx) => (
                <div key={`${h.ts}-${idx}`} className="flex flex-col md:flex-row md:justify-between border-b pb-1 gap-1">
                  <div className="text-gray-700">
                    {new Date(h.ts).toLocaleTimeString()} — {h.awb}
                  </div>
                  <div className="text-right text-gray-600">
                    {h.status} {h.orderName ? `(${h.orderName})` : ""}
                  </div>
                  <div className="text-xs text-gray-500">
                    Processing: {formatDuration(h.durationMs)} • Gap: {formatDuration(h.gapMs)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AWB List */}
        <div className="mt-8 bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-800">AWB List (from DB)</h3>
            <span className="text-xs text-gray-500">{awbList.length} items</span>
          </div>
          <input
            value={awbFilter}
            onChange={(e) => setAwbFilter(e.target.value)}
            placeholder="Filter by AWB or order #"
            className="w-full mb-3 px-3 py-2 border rounded text-sm"
          />
          <div className="max-h-80 overflow-y-auto text-sm">
            {awbList
              .filter((a) => {
                if (!awbFilter.trim()) return true;
                const q = awbFilter.trim().toLowerCase();
                return (
                  a.awb.toLowerCase().includes(q) ||
                  (a.shopifyOrderName || "").toLowerCase().includes(q)
                );
              })
              .map((a) => (
                <div key={`${a.awb}-${a.shopifyOrderId || ""}`} className="flex justify-between border-b py-2">
                  <div className="text-gray-800">
                    <span className="font-mono">{a.awb}</span>
                    {a.shopifyOrderName ? ` — ${a.shopifyOrderName}` : ""}
                  </div>
                  <div className="text-gray-500">
                    {a.shopifyCreatedAt
                      ? new Date(a.shopifyCreatedAt).toLocaleDateString("de-CH")
                      : "—"}
                  </div>
                </div>
              ))}
            {awbList.length === 0 && (
              <div className="text-gray-500">No AWBs found in DB.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

