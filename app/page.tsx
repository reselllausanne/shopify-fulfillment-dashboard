"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthenticationCard from "@/app/components/AuthenticationCard";
import QueryControls from "@/app/components/QueryControls";
import FetchActions from "@/app/components/FetchActions";
import DebugPanel from "@/app/components/DebugPanel";
import ManualEntryModal from "@/app/components/ManualEntryModal";
import ResultsTable from "@/app/components/ResultsTable";
import ManualMatchingOverride from "@/app/components/ManualMatchingOverride";
import DatabaseAutoSync from "@/app/components/DatabaseAutoSync";
import OrderMatchingSection from "@/app/components/OrderMatchingSection";
import { type ShopifyLineItem, isShopifyFinancialRefunded } from "./utils/matching";
import {
  DEFAULT_QUERY,
  DEFAULT_VARIABLES,
  STOCKX_PERSISTED_OPERATION_NAME,
  STOCKX_PERSISTED_QUERY_HASH,
  STOCKX_PERSISTED_VARIABLES,
} from "@/app/lib/constants";
import type { OrderNode } from "@/app/types";
import { toNumber } from "@/app/utils/format";
import { useSupplierOrders } from "@/app/hooks/useSupplierOrders";
import { exportOrdersToCSV } from "@/app/utils/csv";
import { useMatching } from "@/app/hooks/useMatching";
import { getJson, postJson, delJson } from "@/app/lib/api";

const STOCKX_QUERY_CONFIG_STORAGE_KEY = "supplier_stockx_query_config_v1";
const STOCKX_TOKEN_STORAGE_KEY = "supplier_stockx_token";
/** Once-per-day auto AWB backfill after a manual token paste (Zurich calendar day). */
const STOCKX_AWB_AUTOFILL_DAY_KEY = "supplier_stockx_awb_autofill_day_v1";

const decodeJwtPayloadSafe = (token: string): Record<string, unknown> | null => {
  try {
    const payloadPart = String(token || "").split(".")[1] || "";
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = atob(padded);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const isExpiredStockxJwt = (token: string, skewSeconds = 60): boolean => {
  const payload = decodeJwtPayloadSafe(token);
  const exp = typeof payload?.exp === "number" ? payload.exp : null;
  if (!exp) return false;
  const now = Math.floor(Date.now() / 1000);
  return exp <= now + skewSeconds;
};

export default function Home() {
  const router = useRouter();
  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  const [stockxToken, setStockxToken] = useState("");
  const [awbBackfillBusy, setAwbBackfillBusy] = useState(false);
  const [awbBackfillStatus, setAwbBackfillStatus] = useState<string | null>(null);
  const awbAutoFillRef = React.useRef(false);
  const normalizeStockxTokenInput = (value: string) => {
    if (!value) return "";
    let token = String(value).trim();
    try {
      const parsed = JSON.parse(token) as Record<string, any>;
      const extracted =
        parsed?.value ||
        parsed?.token ||
        parsed?.accessToken ||
        parsed?.access_token ||
        parsed?.authToken;
      if (typeof extracted === "string" && extracted.trim()) {
        token = extracted.trim();
      }
    } catch {
      // not JSON
    }
    token = token.replace(/^authorization:\s*/i, "");
    token = token.replace(/^bearer\s+/i, "");
    token = token.replace(/^"+|"+$/g, "");
    return token.trim();
  };
  const syncStockxTokenFromSession = async (options?: { silent?: boolean; force?: boolean }) => {
    try {
      const res = await fetch("/api/stockx/token", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false || typeof json?.token !== "string") {
        if (!options?.silent && res.status !== 404) {
          alert(`⚠️ StockX token sync failed: ${json?.error || `HTTP ${res.status}`}`);
        }
        return null as null | { source: string | null; accountMismatch: boolean };
      }
      const normalized = normalizeStockxTokenInput(json.token);
      if (!normalized) {
        return null;
      }
      const currentNormalized = normalizeStockxTokenInput(stockxToken);
      const savedNormalized =
        typeof window !== "undefined"
          ? normalizeStockxTokenInput(localStorage.getItem(STOCKX_TOKEN_STORAGE_KEY) || "")
          : "";
      const existingPreferred = currentNormalized || savedNormalized;
      const accountMismatch = Boolean(json?.accountMismatch);
      if (
        options?.silent &&
        !options?.force &&
        existingPreferred &&
        existingPreferred !== normalized
      ) {
        return {
          source: typeof json?.source === "string" ? json.source : null,
          accountMismatch: accountMismatch || true,
        };
      }
      setStockxToken(normalized);
      return {
        source: typeof json?.source === "string" ? json.source : null,
        accountMismatch,
      };
    } catch (error: any) {
      if (!options?.silent) {
        alert(`⚠️ StockX token sync error: ${error?.message || "Unknown error"}`);
      }
      return null;
    }
  };

  const [goatCookie, setGoatCookie] = useState("");
  const [goatCsrfToken, setGoatCsrfToken] = useState("");
  const [saveToken, setSaveToken] = useState(false);
  const [tokenStorageHydrated, setTokenStorageHydrated] = useState(false);
  const [operationName, setOperationName] = useState(STOCKX_PERSISTED_OPERATION_NAME);
  const [persistedQueryHash, setPersistedQueryHash] = useState(STOCKX_PERSISTED_QUERY_HASH);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [variables, setVariables] = useState(JSON.stringify(STOCKX_PERSISTED_VARIABLES, null, 2));
  const [stateFilter, setStateFilter] = useState<string>(String(DEFAULT_VARIABLES.state || "PENDING"));
  const [stockxManualPageIndex, setStockxManualPageIndex] = useState(1);

  const {
    orders,
    pageInfo,
    lastStatus,
    lastErrors,
    lastRequestPayload,
    lastResponsePayload,
    enrichedOrders,
    isEnriching,
    detailsProgress,
    loading,
    isFetchingAll,
    pricingByOrder,
    pricingLoading,
    fetchPage,
    handleFetchAllPages,
    handleEnrichLoadedOrders,
    fetchPricingForOrder,
    fetchAllPricing,
    setOrders,
    setPageInfo,
    setLastStatus,
    setLastErrors,
    setLastRequestPayload,
    setLastResponsePayload,
    setEnrichedOrders,
  } = useSupplierOrders();

  // DB + Workers state
  const [dbMatches, setDbMatches] = useState<any[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [orderTestResult, setOrderTestResult] = useState<string | null>(null);
  const [orderTestLoading, setOrderTestLoading] = useState(false);
  const [trackingAlert, setTrackingAlert] = useState<{
    count: number;
    items: any[];
  } | null>(null);
  const [trackingAlertLoading, setTrackingAlertLoading] = useState(false);
  const [trackingAlertError, setTrackingAlertError] = useState<string | null>(null);
  const [unmatchedOrders, setUnmatchedOrders] = useState<{
    count: number;
    paidPositiveCount: number;
    paidPositiveNetChf: number;
    netTotalChf: number;
    days: number;
    orders: Array<{
      shopifyOrderId: string;
      orderName: string;
      createdAt: string;
      financialStatus: string | null;
      netSalesChf: number;
    }>;
  } | null>(null);
  const [unmatchedLoading, setUnmatchedLoading] = useState(false);
  const [unmatchedError, setUnmatchedError] = useState<string | null>(null);
  const [unmatchedDays, setUnmatchedDays] = useState(30);
  const [unmatchedReconcile, setUnmatchedReconcile] = useState<{
    orderId: string;
    orderName: string;
    loading: boolean;
    error: string | null;
    lines: ShopifyLineItem[];
  } | null>(null);
  const [unmatchedReconcileBusy, setUnmatchedReconcileBusy] = useState<string | null>(null);
  const [goatDebugLoading, setGoatDebugLoading] = useState(false);
  const [goatDebugResult, setGoatDebugResult] = useState<string | null>(null);
  const [stockxLoginLoading, setStockxLoginLoading] = useState(false);

  const loadFromDB = async () => {
    setDbLoading(true);
    try {
      const res = await getJson<any>("/api/db/matches");
      if (!res.ok) {
        throw new Error(`Failed to load from DB: ${res.status}`);
      }
      setDbMatches(res.data.matches || []);
      console.log(`[DB] Loaded ${res.data.matches?.length || 0} matches from DB`);
      alert(`✅ Loaded ${res.data.matches?.length || 0} matches from database`);
    } catch (error: any) {
      console.error("[DB] Error loading matches:", error);
      alert(`❌ Error loading from DB:\n\n${error.message}`);
    } finally {
      setDbLoading(false);
    }
  };

  const loadTrackingAlert = async () => {
    setTrackingAlertLoading(true);
    setTrackingAlertError(null);
    try {
      const res = await fetch("/api/notifications/missing-tracking");
      const data = await res.json();
      if (res.ok && data?.ok) {
        setTrackingAlert({
          count: data.count || 0,
          items: data.items || [],
        });
      } else {
        setTrackingAlertError(data?.error || "Failed to load tracking alerts");
      }
    } catch (error: any) {
      setTrackingAlertError(error?.message || "Failed to load tracking alerts");
    } finally {
      setTrackingAlertLoading(false);
    }
  };

  const loadUnmatchedOrders = async (days = unmatchedDays) => {
    setUnmatchedLoading(true);
    setUnmatchedError(null);
    try {
      const res = await fetch(`/api/orders/unmatched?days=${days}`);
      const data = await res.json();
      if (res.ok && data?.ok) {
        setUnmatchedOrders({
          count: data.count || 0,
          paidPositiveCount: data.paidPositiveCount || 0,
          paidPositiveNetChf: Number(data.paidPositiveNetChf || 0),
          netTotalChf: Number(data.netTotalChf || 0),
          days: data.days || days,
          orders: (data.orders || []).map((o: any) => ({
            shopifyOrderId: o.shopifyOrderId,
            orderName: o.orderName,
            createdAt: o.createdAt,
            financialStatus: o.financialStatus,
            netSalesChf: Number(o.netSalesChf || 0),
          })),
        });
        setUnmatchedDays(data.days || days);
      } else {
        setUnmatchedError(data?.error || "Failed to load unmatched orders");
      }
    } catch (error: any) {
      setUnmatchedError(error?.message || "Failed to load unmatched orders");
    } finally {
      setUnmatchedLoading(false);
    }
  };

  const openUnmatchedReconcile = async (order: {
    shopifyOrderId: string;
    orderName: string;
  }) => {
    setUnmatchedReconcileBusy(order.shopifyOrderId);
    setUnmatchedReconcile({
      orderId: order.shopifyOrderId,
      orderName: order.orderName,
      loading: true,
      error: null,
      lines: [],
    });
    try {
      const res = await fetch(
        `/api/orders/unmatched/lines?orderId=${encodeURIComponent(order.shopifyOrderId)}`
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const openLines: ShopifyLineItem[] = (data.openLines || []).map((l: any) => ({
        shopifyOrderId: l.shopifyOrderId,
        orderName: l.orderName,
        createdAt: l.createdAt,
        displayFinancialStatus: l.displayFinancialStatus || "",
        displayFulfillmentStatus: l.displayFulfillmentStatus,
        customerEmail: l.customerEmail,
        customerName: l.customerName,
        customerFirstName: l.customerFirstName,
        customerLastName: l.customerLastName,
        shippingCountry: l.shippingCountry,
        shippingCity: l.shippingCity,
        lineItemId: l.lineItemId,
        title: l.title,
        sku: l.sku,
        variantTitle: l.variantTitle,
        quantity: l.quantity,
        price: l.price,
        totalPrice: l.totalPrice,
        currencyCode: l.currencyCode,
        sizeEU: l.sizeEU,
        lineItemImageUrl: l.lineItemImageUrl,
      }));

      if (openLines.length === 0) {
        setUnmatchedReconcile(null);
        alert(
          `${order.orderName}: plus de lignes à matcher (déjà matchées ou protection colis uniquement). Refresh la liste.`
        );
        await loadUnmatchedOrders(unmatchedDays);
        return;
      }

      if (openLines.length === 1) {
        setUnmatchedReconcile(null);
        openManualEntryModal(openLines[0]);
        return;
      }

      setUnmatchedReconcile({
        orderId: order.shopifyOrderId,
        orderName: order.orderName,
        loading: false,
        error: null,
        lines: openLines,
      });
    } catch (error: any) {
      setUnmatchedReconcile({
        orderId: order.shopifyOrderId,
        orderName: order.orderName,
        loading: false,
        error: error?.message || "Failed to load lines",
        lines: [],
      });
    } finally {
      setUnmatchedReconcileBusy(null);
    }
  };

  const runOrderTest = async () => {
    setOrderTestLoading(true);
    setOrderTestResult(null);
    try {
      const res = await postJson<any>("/api/shopify/orders", {
        first: 5,
        includeExchanges: true,
        orderExchange: true,
        orderId: "gid://shopify/Order/12560147906946",
      });
      if (!res.ok) {
        throw new Error(res.data?.error || "Failed to fetch orders");
      }
      setOrderTestResult(JSON.stringify(res.data, null, 2));
    } catch (error: any) {
      setOrderTestResult(error?.message || "Unknown error");
    } finally {
      setOrderTestLoading(false);
    }
  };

  const handleFetchExchangeOrder = async () => {
    if (!exchangeOrderName.trim()) {
      alert("Please enter a Shopify order number (e.g. #4745)");
      return;
    }
    setExchangeOrderLoading(true);
    try {
      const outcome = await loadExchangeOrderByName(exchangeOrderName.trim());
      if (!outcome) return;
      const saveMsg =
        outcome.saved > 0
          ? `\nAuto-saved ${outcome.saved} HIGH match(es) to DB.`
          : outcome.noHighMatch
          ? "\nNo HIGH confidence match to auto-save."
          : outcome.failed > 0
          ? `\nAuto-save failed for ${outcome.failed} line(s) (missing cost?).`
          : "";
      const returnedMsg =
        outcome.returnedMarked > 0
          ? `\nMarked ${outcome.returnedMarked} returned line(s): RETURNED + stock + negative revenue.`
          : outcome.returnedSkipped > 0
          ? `\nReturned line not updated (${outcome.returnedSkipped} — no prior DB match?).`
          : "";
      alert(
        `✅ Loaded ${outcome.itemCount} exchange line item(s) for ${exchangeOrderName.trim()}${saveMsg}${returnedMsg}`
      );
    } catch (err: any) {
      alert(`❌ Failed to load exchange order:\n\n${err?.message || "Unknown error"}`);
    } finally {
      setExchangeOrderLoading(false);
    }
  };

  // Shopify matching (hook)
  const {
    shopifyItems,
    matchResults,
    loadingShopify,
    setShopifyItems,
    setMatchResults,
    manualOverrides,
    setManualOverrides,
    confirmedMatches,
    setConfirmedMatches,
    manualCostOverrides,
    setManualCostOverrides,
    manualFetchOrder,
    setManualFetchOrder,
    manualFetchLoading,
    loadShopifyOrders,
    handleFetchShopifyOrder,
    createManualCostEntry,
    handleSetMetafields,
    autoSetAllHighMatches,
    manualOverrideExpanded,
    setManualOverrideExpanded,
    manualOverrideData,
    setManualOverrideData,
    manualOverrideLoading,
    applyManualOverride,
    loadExchangeOrderByName,
    refreshDbMatchesTracking,
  } = useMatching({
    enrichedOrders,
    orders,
    pricingByOrder,
    reloadDb: loadFromDB,
  });

  const autoSetAllHighMatchesAndRefresh = async () => {
    await autoSetAllHighMatches();
    // Important: update existing DB rows too (ETA range, tracking, states)
    await refreshDbMatchesTracking(stockxToken, {
      onlyMissingTracking: true,
      limit: 800,
      detailPersistedQueryHash: persistedQueryHash,
    });
    await loadFromDB();
  };

  const refreshTrackingFromStockx = async () => {
    if (!stockxToken.trim()) {
      alert("Please enter a StockX token first.");
      return;
    }
    await refreshDbMatchesTracking(stockxToken, {
      onlyMissingTracking: true,
      limit: 800,
      detailPersistedQueryHash: persistedQueryHash,
    });
    await loadFromDB();
  };

  const zurichDayKey = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Zurich",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

  const runAwbBackfillFromAuth = async (opts?: { auto?: boolean }) => {
    const token = normalizeStockxTokenInput(stockxToken);
    if (!token) {
      if (!opts?.auto) alert("Paste a StockX bearer token first.");
      return;
    }
    if (isExpiredStockxJwt(token, 60)) {
      setAwbBackfillStatus("Token expired — paste a fresh one.");
      if (!opts?.auto) alert("StockX token expired. Paste a fresh bearer.");
      return;
    }
    if (awbBackfillBusy) return;

    setAwbBackfillBusy(true);
    setAwbBackfillStatus(opts?.auto ? "Auto AWB backfill…" : "Backfilling AWBs…");
    try {
      const res = await fetch("/api/db/backfill-awb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          days: 21,
          limit: 60,
          dryRun: false,
          includeFulfilled: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        const msg = data?.error || data?.details || `HTTP ${res.status}`;
        setAwbBackfillStatus(`AWB backfill failed: ${msg}`);
        if (!opts?.auto) alert(`AWB backfill failed: ${msg}`);
        return;
      }
      const updated = Number(data.updated ?? 0);
      const scanned = Number(data.scanned ?? 0);
      const candidates = Number(data.candidates ?? 0);
      const summary = `AWB backfill OK — updated ${updated}/${scanned} (candidates ${candidates})`;
      setAwbBackfillStatus(summary);
      try {
        localStorage.setItem(
          STOCKX_AWB_AUTOFILL_DAY_KEY,
          `${zurichDayKey()}:${token.slice(-16)}`
        );
      } catch {
        // ignore
      }
      await loadFromDB();
    } catch (err: any) {
      const msg = err?.message || "Network error";
      setAwbBackfillStatus(`AWB backfill failed: ${msg}`);
      if (!opts?.auto) alert(`AWB backfill failed: ${msg}`);
    } finally {
      setAwbBackfillBusy(false);
    }
  };

  // After manual token paste: once per Zurich day, auto-save + backfill AWBs.
  useEffect(() => {
    if (!tokenStorageHydrated) return;
    const token = normalizeStockxTokenInput(stockxToken);
    if (!token || token.length < 40 || isExpiredStockxJwt(token, 60)) return;

    const day = zurichDayKey();
    const marker = `${day}:${token.slice(-16)}`;
    let already = "";
    try {
      already = localStorage.getItem(STOCKX_AWB_AUTOFILL_DAY_KEY) || "";
    } catch {
      already = "";
    }
    if (already === marker) return;

    const timer = window.setTimeout(() => {
      if (awbAutoFillRef.current || awbBackfillBusy) return;
      awbAutoFillRef.current = true;
      void runAwbBackfillFromAuth({ auto: true }).finally(() => {
        awbAutoFillRef.current = false;
      });
    }, 2000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fire on token paste
  }, [stockxToken, tokenStorageHydrated]);

  const handleFetchShopifyOrderWrapper = async () => {
    await handleFetchShopifyOrder(manualFetchOrder);
  };

  const applyManualOverrideWrapper = async (matchId: string, match: any) => {
    const data = manualOverrideData[matchId];
    await applyManualOverride(matchId, match, data);
  };
  
  // Manual entry modal state
  const [manualEntryModal, setManualEntryModal] = useState<{
    isOpen: boolean;
    shopifyItem: ShopifyLineItem | null;
    mode: 'create' | 'edit';
    matchId?: string;
  }>({ isOpen: false, shopifyItem: null, mode: 'create' });
  const [manualEntryData, setManualEntryData] = useState<any>({});
  const [originalEntryData, setOriginalEntryData] = useState<any>({}); // Pour comparer les changements
  const [exchangeOrderName, setExchangeOrderName] = useState("");
  const [exchangeOrderLoading, setExchangeOrderLoading] = useState(false);

  // Load credentials from localStorage on mount
  useEffect(() => {
    const savedStockx = localStorage.getItem(STOCKX_TOKEN_STORAGE_KEY);
    const savedGoatCookie = localStorage.getItem("supplier_goat_cookie");
    const savedGoatCsrf = localStorage.getItem("supplier_goat_csrf");
    const savedStockxQueryConfig = localStorage.getItem(STOCKX_QUERY_CONFIG_STORAGE_KEY);
    const normalizedSavedStockx = normalizeStockxTokenInput(savedStockx || "");
    const savedStockxExpired = normalizedSavedStockx
      ? isExpiredStockxJwt(normalizedSavedStockx, 120)
      : false;
    if (normalizedSavedStockx && !savedStockxExpired) {
      setStockxToken(normalizedSavedStockx);
    } else if (normalizedSavedStockx && savedStockxExpired) {
      localStorage.removeItem(STOCKX_TOKEN_STORAGE_KEY);
    }
    if (savedStockxQueryConfig) {
      try {
        const parsed = JSON.parse(savedStockxQueryConfig) as Record<string, unknown>;
        const parsedHash =
          typeof parsed.persistedQueryHash === "string" ? parsed.persistedQueryHash : "";
        if (typeof parsed.operationName === "string" && parsed.operationName.trim()) {
          const normalizedOp =
            parsedHash.trim() === STOCKX_PERSISTED_QUERY_HASH
              ? STOCKX_PERSISTED_OPERATION_NAME
              : parsed.operationName;
          setOperationName(normalizedOp);
        }
        if (typeof parsedHash === "string") {
          setPersistedQueryHash(parsedHash);
        }
        if (typeof parsed.query === "string") {
          setQuery(parsed.query);
        }
        if (typeof parsed.variables === "string" && parsed.variables.trim()) {
          setVariables(parsed.variables);
        }
        if (typeof parsed.stateFilter === "string") {
          setStateFilter(parsed.stateFilter);
        }
      } catch {
        // ignore invalid saved query config
      }
    }
    if (savedGoatCookie || savedGoatCsrf) {
      setGoatCookie(savedGoatCookie || "");
      setGoatCsrfToken(savedGoatCsrf || "");
      setSaveToken(true);
    }
    // Local token first; if missing/expired, pull fresh token from session files.
    if (!normalizedSavedStockx || savedStockxExpired) {
      void syncStockxTokenFromSession({ silent: true, force: true });
    }
    setTokenStorageHydrated(true);
  }, []);

  // Always persist StockX token locally so manual rotation survives refresh.
  useEffect(() => {
    if (!tokenStorageHydrated) return;
    const normalized = normalizeStockxTokenInput(stockxToken);
    if (normalized) {
      localStorage.setItem(STOCKX_TOKEN_STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(STOCKX_TOKEN_STORAGE_KEY);
    }
  }, [stockxToken, tokenStorageHydrated]);

  // Optional persistence only for GOAT credentials.
  useEffect(() => {
    if (saveToken) {
      localStorage.setItem("supplier_goat_cookie", goatCookie);
      localStorage.setItem("supplier_goat_csrf", goatCsrfToken);
    } else {
      localStorage.removeItem("supplier_goat_cookie");
      localStorage.removeItem("supplier_goat_csrf");
    }
  }, [saveToken, goatCookie, goatCsrfToken]);

  // Persist StockX query config so hash/op survives refresh.
  useEffect(() => {
    const payload = {
      operationName,
      persistedQueryHash,
      query,
      variables,
      stateFilter,
    };
    localStorage.setItem(STOCKX_QUERY_CONFIG_STORAGE_KEY, JSON.stringify(payload));
  }, [operationName, persistedQueryHash, query, variables, stateFilter]);

  useEffect(() => {
    loadTrackingAlert();
    loadUnmatchedOrders(30);
  }, []);

  const formatDate = (value?: string | null) => {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleDateString("fr-CH");
    } catch {
      return "—";
    }
  };

  const over7TrackingItems = React.useMemo(() => {
    if (!trackingAlert?.items) return [];
    return trackingAlert.items.filter((item: any) => {
      const ageDays = typeof item.ageDays === "number" ? item.ageDays : null;
      return ageDays != null && ageDays > 7;
    });
  }, [trackingAlert?.items]);

  const resolveActiveStockxToken = () => normalizeStockxTokenInput(stockxToken);
  const isFetchCurrentBidsMode = (op: string, hash: string) =>
    String(op || "").trim() === STOCKX_PERSISTED_OPERATION_NAME ||
    String(hash || "").trim() === STOCKX_PERSISTED_QUERY_HASH;
  const resolveOperationName = () => {
    const op = String(operationName || "").trim();
    const hash = String(persistedQueryHash || "").trim();
    if (isFetchCurrentBidsMode(op, hash)) return STOCKX_PERSISTED_OPERATION_NAME;
    return op || STOCKX_PERSISTED_OPERATION_NAME;
  };
  const resolveVariablesJSON = (op: string) => {
    const raw = String(variables || "").trim();
    if (raw) return raw;
    return isFetchCurrentBidsMode(op, persistedQueryHash)
      ? JSON.stringify(STOCKX_PERSISTED_VARIABLES, null, 2)
      : JSON.stringify(DEFAULT_VARIABLES, null, 2);
  };
  const resolvePersistedHash = (op: string) => {
    const hash = String(persistedQueryHash || "").trim();
    if (hash) return hash;
    return isFetchCurrentBidsMode(op, hash) ? STOCKX_PERSISTED_QUERY_HASH : "";
  };
  const resolveState = () => String(stateFilter || "").trim() || String(DEFAULT_VARIABLES.state || "PENDING");
  const isPersistedListOp = (op: string, hash: string) => isFetchCurrentBidsMode(op, hash);

  const handleFetchFirstPage = async () => {
    const op = resolveOperationName();
    const vars = resolveVariablesJSON(op);
    const hash = resolvePersistedHash(op);
    const state = resolveState();
    const persistedListMode = isPersistedListOp(op, hash);
    const result = await fetchPage({
      token: resolveActiveStockxToken(),
      operationName: op,
      query,
      persistedQueryHash: hash,
      variablesJSON: vars,
      stateFilter: state,
      cursor: null,
      append: false,
      stockxPageIndex: persistedListMode ? 1 : null,
    });
    if (result && persistedListMode) {
      const usedIndex =
        typeof (result as any).stockxPageIndexUsed === "number"
          ? Number((result as any).stockxPageIndexUsed)
          : 1;
      setStockxManualPageIndex(usedIndex);
    }
  };

  const handleFetchNextPage = async () => {
    if (pageInfo?.endCursor && pageInfo.hasNextPage) {
      const op = resolveOperationName();
      const vars = resolveVariablesJSON(op);
      const hash = resolvePersistedHash(op);
      const state = resolveState();
      const persistedListMode = isPersistedListOp(op, hash);
      const nextPageIndex = persistedListMode ? stockxManualPageIndex + 1 : null;
      const result = await fetchPage({
        token: resolveActiveStockxToken(),
        operationName: op,
        query,
        persistedQueryHash: hash,
        variablesJSON: vars,
        stateFilter: state,
        cursor: pageInfo.endCursor,
        append: true,
        stockxPageIndex: nextPageIndex,
      });
      if (result && persistedListMode && nextPageIndex != null) {
        const usedIndex =
          typeof (result as any).stockxPageIndexUsed === "number"
            ? Number((result as any).stockxPageIndexUsed)
            : nextPageIndex;
        setStockxManualPageIndex(usedIndex);
      }
    } else {
      alert("No next page available");
    }
  };

  const handleFetchAllOrdersWrapper = async () => {
    const op = resolveOperationName();
    const vars = resolveVariablesJSON(op);
    const hash = resolvePersistedHash(op);
    const state = resolveState();
    if (isPersistedListOp(op, hash)) {
      setStockxManualPageIndex(1);
    }
    await handleFetchAllPages({
      token: resolveActiveStockxToken(),
      operationName: op,
      query,
      persistedQueryHash: hash,
      variablesJSON: vars,
      stateFilter: state,
      goatCookie,
      goatCsrfToken,
    });
  };

  const handleEnrichLoadedOrdersWrapper = async () => {
    await handleEnrichLoadedOrders({
      token: resolveActiveStockxToken(),
      detailPersistedQueryHash: persistedQueryHash,
    });
  };

  const handleFetchAllPricingWrapper = async () => {
    await fetchAllPricing(resolveActiveStockxToken());
  };
  const handleClearResults = () => {
    setOrders([]);
    setEnrichedOrders(null);
    setPageInfo(null);
    setStockxManualPageIndex(1);
    setLastStatus(null);
    setLastErrors([]);
    setLastRequestPayload(null);
    setLastResponsePayload(null);
  };

  const mapGoatRows = (goatOrdersRaw: any[]) =>
    goatOrdersRaw.map((o: any) => ({
      ...o,
      provider: "GOAT",
      productTitleB: o.productTitle || o.displayName || null,
      brandB: null,
      sizeB: o.size || null,
      thumbUrlB: o.thumbUrl || null,
      imageUrlB: o.thumbUrl || null,
      statusB: o.statusTitle || o.statusKey || null,
      statusKeyB: o.statusKey || null,
      estimatedDeliveryB: o.estimatedDeliveryDate || null,
      latestEstimatedDeliveryB: o.latestEstimatedDeliveryDate || null,
      styleId: o.skuKey || o.styleId || null,
    }));

  const mergeGoatRowsIntoTable = (goatRows: any[]) => {
    if (goatRows.length === 0) return;
    const existingRows = (enrichedOrders && enrichedOrders.length > 0 ? enrichedOrders : orders) as any[];
    const combinedRows = [...existingRows, ...goatRows];
    const seen = new Set<string>();
    const dedupedRows = combinedRows.filter((row: any) => {
      const key = `${row?.provider || "STOCKX"}:${row?.orderId || ""}:${row?.orderNumber || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setOrders(dedupedRows as OrderNode[]);
    setEnrichedOrders(dedupedRows);
  };

  const handleGoatLogin = async () => {
    setGoatDebugLoading(true);
    try {
      const res = await fetch("/api/goat/playwright", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          headless: false,
          includeRaw: false,
          browser: "chromium",
          persistent: true,
          maxWaitMs: 600000,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.cookie) {
        setGoatCookie(String(json.cookie));
        setSaveToken(true);
      }
      if (json?.csrfToken) {
        setGoatCsrfToken(String(json.csrfToken));
        setSaveToken(true);
      }
      if (!res.ok || json?.ok === false) {
        const message = String(json?.error || `HTTP ${res.status}`);
        const lastUrl = json?.debug?.lastUrl ? `\nURL: ${json.debug.lastUrl}` : "";
        alert(`❌ GOAT login failed: ${message}${lastUrl}\nFinish Cloudflare + login in the Playwright window, then click again.`);
        return;
      }
      const goatOrdersRaw = Array.isArray(json?.orders) ? json.orders : [];
      mergeGoatRowsIntoTable(mapGoatRows(goatOrdersRaw));

      setLastStatus(res.status);
      setLastErrors([]);
      setPageInfo(null);

      alert(`✅ GOAT session ready. Orders: ${json?.count || 0}. Added to results table.`);
    } catch (error: any) {
      alert(`❌ GOAT login error: ${error?.message || "Unknown error"}`);
    } finally {
      setGoatDebugLoading(false);
    }
  };

  const handleGoatDebug = async () => {
    setGoatDebugLoading(true);
    setGoatDebugResult(null);
    try {
      const res = await fetch("/api/goat/playwright", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          headless: false,
          includeRaw: true,
          browser: "chromium",
          persistent: true,
          maxWaitMs: 600000,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        setGoatDebugResult(JSON.stringify(json, null, 2));
        return;
      }
      setGoatDebugResult(JSON.stringify(json?.rawOrders || json, null, 2));
    } catch (error: any) {
      setGoatDebugResult(JSON.stringify({ error: error?.message || "Unknown error" }, null, 2));
    } finally {
      setGoatDebugLoading(false);
    }
  };

  const handleExportGoatSession = async () => {
    try {
      const res = await fetch("/api/goat/session", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok || !json?.session) {
        alert(`❌ GOAT session export failed: ${json?.error || `HTTP ${res.status}`}`);
        return;
      }
      const blob = new Blob([JSON.stringify(json.session, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "goat-session.json";
      a.click();
      URL.revokeObjectURL(url);
      alert("✅ GOAT session exported.");
    } catch (error: any) {
      alert(`❌ GOAT session export error: ${error?.message || "Unknown error"}`);
    }
  };

  const handleImportGoatSession = async (file: File | null) => {
    if (!file) return;
    try {
      const raw = await file.text();
      const session = JSON.parse(raw);
      const res = await fetch("/api/goat/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        alert(`❌ GOAT session import failed: ${json?.error || `HTTP ${res.status}`}`);
        return;
      }
      alert("✅ GOAT session imported.");
    } catch (error: any) {
      alert(`❌ GOAT session import error: ${error?.message || "Invalid JSON file"}`);
    }
  };

  const handleStockxLogin = async () => {
    setStockxLoginLoading(true);
    try {
      const res = await fetch("/api/stockx/playwright", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          headless: false,
          forceLogin: true,
          browser: "chromium",
          persistent: true,
          autoNavigate: false,
          waitForUserClose: true,
          waitForCloseMs: 600000,
          sessionFile: ".data/stockx-session.json",
          sessionMetaFile: ".data/stockx-session-meta.json",
          tokenFile: ".data/stockx-token.json",
          reuseTokenFile: true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        alert(`❌ StockX login failed: ${json?.error || `HTTP ${res.status}`}`);
        return;
      }
      if (json?.token) {
        const capturedToken = normalizeStockxTokenInput(json.token);
        if (capturedToken) {
          setStockxToken(capturedToken);
        }
        const synced = await syncStockxTokenFromSession({ silent: true, force: true });
        const fallbackNotice = json?.persistentFallback
          ? "\n⚠️ Persistent browser profile was busy, temporary context used for this login."
          : "";
        const syncSource =
          synced?.source === "session_cookie"
            ? "session cookie"
            : synced?.source === "token_file"
              ? "token file"
              : "captured token";
        const mismatchNotice = synced?.accountMismatch
          ? "\n⚠️ Session cookie token and token file differed. UI uses session cookie token."
          : "";
        const capturedHashes = json?.captured?.persistedHashes || {};
        const hashEntries = Object.entries(capturedHashes).filter(
          ([op, value]) => typeof op === "string" && typeof value === "string"
        );
        const hashNotice =
          hashEntries.length > 0
            ? `\nCaptured hashes: ${hashEntries
                .map(([op, value]) => `${op}:${String(value).slice(0, 10)}...`)
                .join(" | ")}`
            : "\nCaptured hashes: none (open StockX order list/view during Playwright session)";
        const captureNotice = `\nDeviceId: ${json?.captured?.deviceId ? "yes" : "no"} | SessionId: ${
          json?.captured?.sessionId ? "yes" : "no"
        } | CookieHeader: ${json?.captured?.hasCookieHeader ? "yes" : "no"}${hashNotice}`;
        alert(
          `✅ StockX token captured and synced (${syncSource})${fallbackNotice}${captureNotice}${mismatchNotice}`
        );
      } else {
        alert("⚠️ StockX login succeeded but no token found");
      }
    } catch (error: any) {
      alert(`❌ StockX login error: ${error?.message || "Unknown error"}`);
    } finally {
      setStockxLoginLoading(false);
    }
  };

  const handleExportCSV = () => {
    exportOrdersToCSV(orders, pricingByOrder);
  };

  const fetchPricingForOrderWrapper = async (order: OrderNode) => {
    await fetchPricingForOrder(order, resolveActiveStockxToken());
  };

  // Sync worker removed from UI (no-op placeholder)

  // ✅ NEW: Open full manual entry modal with ALL DB fields (CREATE mode)
  const openManualEntryModal = (shopifyItem: ShopifyLineItem) => {
    if (isShopifyFinancialRefunded(shopifyItem.displayFinancialStatus)) {
      alert("This Shopify line is refunded. Manual full entry is disabled.");
      return;
    }
    // Pre-fill with intelligent defaults
    const defaultData = {
      // Shopify data (pre-filled)
      shopifyOrderId: shopifyItem.shopifyOrderId,
      shopifyOrderName: shopifyItem.orderName,
      shopifyCreatedAt: shopifyItem.createdAt,
      shopifyLineItemId: shopifyItem.lineItemId,
      shopifyProductTitle: shopifyItem.title,
      shopifySku: shopifyItem.sku || "",
      shopifySizeEU: shopifyItem.sizeEU || "",
      shopifyTotalPrice: parseFloat(shopifyItem.totalPrice),
      shopifyCurrencyCode: shopifyItem.currencyCode || "CHF",
      
      // Supplier data (can be filled manually)
      stockxOrderNumber: "",
      stockxChainId: "",
      stockxOrderId: "",
      stockxProductName: shopifyItem.title, // Default to Shopify title
      stockxSizeEU: shopifyItem.sizeEU || "",
      stockxSkuKey: shopifyItem.sku || "",
      stockxPurchaseDate: new Date().toISOString().slice(0, 16), // Current datetime
      stockxStatus: "MANUAL",
      stockxAwb: "",
      stockxTrackingUrl: "",
      stockxEstimatedDelivery: "",
      stockxLatestEstimatedDelivery: "",
      
      // Financial data
      supplierCost: "",
      marginAmount: "",
      marginPercent: "",
      
      // Match metadata
      matchConfidence: "manual",
      matchScore: 100,
      matchType: "MANUAL",
      matchReasons: "Manual entry",
      timeDiffHours: 0,
      supplierSource: "MANUAL",
      
      // Optional fields
      manualCostOverride: "",
      manualNote: "",
      shopifyMetafieldsSynced: false,
    };
    
    setManualEntryData(defaultData);
    setOriginalEntryData({});
    setManualEntryModal({ isOpen: true, shopifyItem, mode: 'create' });
  };

  // ✅ NEW: Open modal for EDITING existing entry
  const openManualEntryModalForEdit = (match: any) => {
    // Pre-fill with existing data from DB
    const existingData = {
      // Shopify data
      shopifyOrderId: match.shopifyOrderId,
      shopifyOrderName: match.shopifyOrderName,
      shopifyCreatedAt: match.shopifyCreatedAt || "",
      shopifyLineItemId: match.shopifyLineItemId,
      shopifyProductTitle: match.shopifyProductTitle,
      shopifySku: match.shopifySku || "",
      shopifySizeEU: match.shopifySizeEU || "",
      shopifyTotalPrice: toNumber(match.shopifyTotalPrice),
      shopifyCurrencyCode: match.shopifyCurrencyCode || "CHF",
      
      // Supplier data
      stockxOrderNumber: match.stockxOrderNumber || "",
      stockxChainId: match.stockxChainId || "",
      stockxOrderId: match.stockxOrderId || "",
      stockxProductName: match.stockxProductName || "",
      stockxSizeEU: match.stockxSizeEU || "",
      stockxSkuKey: match.stockxSkuKey || "",
      stockxPurchaseDate: match.stockxPurchaseDate 
        ? new Date(match.stockxPurchaseDate).toISOString().slice(0, 16) 
        : "",
      stockxStatus: match.stockxStatus || "MANUAL",
      stockxAwb: match.stockxAwb || "",
      stockxTrackingUrl: match.stockxTrackingUrl || "",
      stockxEstimatedDelivery: match.stockxEstimatedDelivery
        ? new Date(match.stockxEstimatedDelivery).toISOString().split("T")[0]
        : "",
      stockxLatestEstimatedDelivery: match.stockxLatestEstimatedDelivery
        ? new Date(match.stockxLatestEstimatedDelivery).toISOString().split("T")[0]
        : "",
      stockxCheckoutType: match.stockxCheckoutType || "",
      stockxStates: match.stockxStates ? JSON.stringify(match.stockxStates, null, 2) : "",
      
      // Financial data
      supplierCost: toNumber(match.supplierCost).toString(),
      marginAmount: toNumber(match.marginAmount).toString(),
      marginPercent: toNumber(match.marginPercent).toString(),
      
      // Match metadata
      matchConfidence: match.matchConfidence || "manual",
      matchScore: match.matchScore || 100,
      matchType: match.matchType || "MANUAL",
      matchReasons: match.matchReasons || "Manual entry",
      timeDiffHours: toNumber(match.timeDiffHours) || 0,
      
      // Optional fields
      manualCostOverride: match.manualCostOverride ? toNumber(match.manualCostOverride).toString() : "",
      manualNote: match.manualNote || "",
      shopifyMetafieldsSynced: match.shopifyMetafieldsSynced || false,
    };
    
    setManualEntryData(existingData);
    setOriginalEntryData(existingData); // Store original for comparison
    setManualEntryModal({ 
      isOpen: true, 
      shopifyItem: null, // No shopify item in edit mode
      mode: 'edit',
      matchId: match.id 
    });
  };

  // ✅ NEW: Save manual entry with ALL fields (CREATE or EDIT with partial update)
  const saveManualEntry = async (dataOverride?: any, modeOverride?: 'create' | 'edit') => {
    const data = dataOverride ?? manualEntryData;
    const mode = modeOverride ?? manualEntryModal.mode;
    const isEditMode = mode === 'edit';
    
    // In create mode, shopifyItem must exist
    if (!isEditMode && !manualEntryModal.shopifyItem) return;
    
    try {
      // Calculate margin if supplier cost is provided
      const supplierCost = parseFloat(data.supplierCost) || 0;
      const revenue = data.shopifyTotalPrice || 0;
      const marginAmount = revenue - supplierCost;
      const marginPercent = revenue > 0 ? (marginAmount / revenue) * 100 : 0;
      
      let saveData: any;
      
      if (isEditMode) {
        // ✅ EDIT MODE: Send ALL current data (ensures upsert works)
        // Track changed fields for logging only
        const changedFields: string[] = [];
        
        Object.keys(data).forEach(key => {
          const oldValue = originalEntryData[key];
          const newValue = data[key];
          
          const isChanged = (oldValue !== newValue) && 
            !((!oldValue || oldValue === "") && (!newValue || newValue === ""));
          
          if (isChanged) {
            changedFields.push(key);
            console.log(`[EDIT] Changed field "${key}": "${oldValue}" → "${newValue}"`);
          }
        });
        
      const parsedStatesEdit =
        typeof data.stockxStates === "string" && data.stockxStates.trim()
          ? (() => {
              try {
                return JSON.parse(data.stockxStates);
              } catch {
                return null;
              }
            })()
          : data.stockxStates || null;

      saveData = {
        // Shopify fields
        shopifyOrderId: data.shopifyOrderId,
        shopifyOrderName: data.shopifyOrderName,
        shopifyCreatedAt: data.shopifyCreatedAt || null,
        shopifyLineItemId: data.shopifyLineItemId,
        shopifyProductTitle: data.shopifyProductTitle,
        shopifySku: data.shopifySku || null,
        shopifySizeEU: data.shopifySizeEU || null,
        shopifyTotalPrice: data.shopifyTotalPrice,
        shopifyCurrencyCode: data.shopifyCurrencyCode || "CHF",
        
        // Supplier fields
        stockxOrderNumber: data.stockxOrderNumber || `MANUAL-${Date.now()}`,
        stockxChainId: data.stockxChainId || null,
        stockxOrderId: data.stockxOrderId || null,
        stockxProductName: data.stockxProductName || data.shopifyProductTitle,
        stockxSizeEU: data.stockxSizeEU || null,
        stockxSkuKey: data.stockxSkuKey || null,
        stockxPurchaseDate: data.stockxPurchaseDate || null,
        stockxStatus: data.stockxStatus || "MANUAL",
        stockxAwb: data.stockxAwb || null,
        stockxTrackingUrl: data.stockxTrackingUrl || null,
        stockxEstimatedDelivery: data.stockxEstimatedDelivery || null,
        stockxLatestEstimatedDelivery: data.stockxLatestEstimatedDelivery || null,
        stockxCheckoutType: data.stockxCheckoutType || null,
        stockxStates: parsedStatesEdit,
          
          // Match metadata
          matchConfidence: data.matchConfidence || "manual",
          matchScore: parseFloat(data.matchScore?.toString() || "100"),
          matchType: data.matchType || "MANUAL",
          matchReasons: Array.isArray(data.matchReasons) 
            ? data.matchReasons 
            : [data.matchReasons || "Manual entry"],
          timeDiffHours: parseFloat(data.timeDiffHours?.toString() || "0"),
          
          // Financial fields (always recalculate)
          supplierCost: supplierCost,
          marginAmount: marginAmount,
          marginPercent: marginPercent,
          
          // Optional fields
          manualCostOverride: data.manualCostOverride ? parseFloat(data.manualCostOverride) : null,
          manualNote: data.manualNote || null,
          shopifyMetafieldsSynced: data.shopifyMetafieldsSynced || false,
        };
        
        console.log(`[EDIT] Updating entry with ${changedFields.length} changed field(s):`, changedFields);
        
        // Store count for alert message (will be filtered out by API)
        (saveData as any).__changedFieldsCount = changedFields.length;
        
      } else {
        // ✅ CREATE MODE: Send all fields
        const parsedStatesCreate =
          typeof data.stockxStates === "string" && data.stockxStates.trim()
            ? (() => {
                try {
                  return JSON.parse(data.stockxStates);
                } catch {
                  return null;
                }
              })()
            : data.stockxStates || null;

        saveData = {
          ...data,
          shopifyCreatedAt: data.shopifyCreatedAt || null,
          supplierCost: supplierCost || 0,
          marginAmount,
          marginPercent,
          supplierSource: data.supplierSource || "MANUAL",
          // Convert empty strings to null
          stockxOrderNumber: data.stockxOrderNumber || `MANUAL-${Date.now()}`,
          stockxChainId: data.stockxChainId || null,
          stockxOrderId: data.stockxOrderId || null,
          stockxPurchaseDate: data.stockxPurchaseDate || null,
          stockxEstimatedDelivery: data.stockxEstimatedDelivery || null,
          stockxLatestEstimatedDelivery: data.stockxLatestEstimatedDelivery || null,
          stockxAwb: data.stockxAwb || null,
          stockxTrackingUrl: data.stockxTrackingUrl || null,
          stockxCheckoutType: data.stockxCheckoutType || null,
          stockxStates: parsedStatesCreate,
          manualCostOverride: data.manualCostOverride ? parseFloat(data.manualCostOverride) : null,
          matchReasons: Array.isArray(data.matchReasons) 
            ? data.matchReasons 
            : [data.matchReasons || "Manual entry"],
        };
      }
      
      const res = await postJson<any>("/api/db/save-match", saveData);
      if (!res.ok) {
        alert(`❌ Failed to save:\n\n${res.data?.error}\n\n${res.data?.details || ""}`);
        return;
      }
      
      const modeText = isEditMode ? "updated" : "saved";
      const changedCount = isEditMode ? (saveData as any).__changedFieldsCount || 0 : 0;
      const savedSupplierNumber = String(
        saveData.stockxOrderNumber || data.stockxOrderNumber || ""
      );
      const savedLineItemId = String(
        data.shopifyLineItemId || manualEntryModal.shopifyItem?.lineItemId || ""
      );
      const savedSupplierSource =
        (data.supplierSource as "STOCKX" | "MANUAL" | "LOCAL" | "OTHER" | undefined) ||
        "MANUAL";
      if (savedLineItemId) {
        setMatchResults((prev) =>
          prev.map((r) => {
            if (r.shopifyItem.lineItemId !== savedLineItemId) return r;
            const supplierOrder = r.bestMatch?.supplierOrder;
            return {
              ...r,
              alreadySaved: true,
              bestMatch: {
                supplierOrder: supplierOrder
                  ? {
                      ...supplierOrder,
                      supplierOrderNumber:
                        savedSupplierNumber || supplierOrder.supplierOrderNumber,
                      supplierSource: savedSupplierSource,
                      totalTTC: supplierCost,
                      offerAmount: supplierCost,
                      statusKey: data.stockxStatus || supplierOrder.statusKey || "MANUAL",
                      statusTitle: "Saved match",
                    }
                  : {
                      chainId: "",
                      orderId: savedSupplierNumber,
                      supplierOrderNumber: savedSupplierNumber || `MANUAL-${Date.now()}`,
                      supplierSource: savedSupplierSource,
                      purchaseDate: r.shopifyItem.createdAt,
                      offerAmount: supplierCost,
                      totalTTC: supplierCost,
                      productTitle:
                        data.stockxProductName || r.shopifyItem.title,
                      skuKey: r.shopifyItem.sku || "",
                      sizeEU: r.shopifyItem.sizeEU,
                      statusKey: data.stockxStatus || "MANUAL",
                      statusTitle: "Saved match",
                      currencyCode: r.shopifyItem.currencyCode || "CHF",
                    },
                score: 1000,
                confidence: "high" as const,
                reasons: ["✓ Already saved in DB", "manual"],
                timeDiffHours: 0,
                overThreshold: true,
              },
              allCandidates: r.allCandidates,
            };
          })
        );
        if (savedSupplierNumber) {
          setConfirmedMatches((prev) => ({
            ...prev,
            [savedLineItemId]: savedSupplierNumber,
          }));
        }
      }
      alert(
        `✅ Manual entry ${modeText}!\n\n` +
        `Order: ${data.shopifyOrderName}\n` +
        `Supplier Order: ${savedSupplierNumber}\n` +
        `Cost: CHF ${supplierCost.toFixed(2)}\n` +
        `Margin: CHF ${marginAmount.toFixed(2)} (${marginPercent.toFixed(1)}%)\n\n` +
        (isEditMode && changedCount > 0 ? `${changedCount} field(s) modified\n` : "") +
        `Stays green on reload until fulfilled.`
      );
      
      // Close modal and reload
      setManualEntryModal({ isOpen: false, shopifyItem: null, mode: 'create' });
      setUnmatchedReconcile(null);
      await loadFromDB();
      await loadUnmatchedOrders(unmatchedDays);
      
    } catch (error: any) {
      console.error("[MANUAL_ENTRY] Error:", error);
      alert(`❌ Error saving:\n\n${error.message}`);
    }
  };

  const deleteMatch = async (matchId: string, orderName: string) => {
    if (!confirm(`🗑️ Delete match for ${orderName}?\n\nThis will remove it from the database permanently.`)) {
      return;
    }

    try {
      console.log(`[DB] Deleting match ${matchId}...`);
      const res = await delJson<any>("/api/db/delete-match", { id: matchId });
      if (!res.ok) {
        throw new Error(`Delete failed: ${res.status}`);
      }

      alert(`✅ Match deleted successfully`);
      
      // Reload DB matches
      await loadFromDB();
    } catch (error: any) {
      console.error("[DB] Delete error:", error);
      alert(`❌ Failed to delete match:\n\n${error.message}`);
    }
  };


  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Supplier Pro GraphQL Playground
        </h1>

        {/* Navigation */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <nav className="flex flex-wrap gap-3">
            <span className="text-gray-900 font-bold py-2 px-3 bg-blue-100 rounded-md">
              🏠 Orders (Current)
            </span>
            <a
              href="/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
            >
              📊 Margin Dashboard
            </a>
            <a
              href="/expenses"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium"
            >
              💰 Expenses
            </a>
            <a
              href="/financial"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors font-medium"
            >
              📈 Financial Overview
            </a>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors font-medium ml-auto"
            >
              🔒 Logout
            </button>
          </nav>
        </div>

        <div className="mb-6 border-2 border-red-600 rounded-lg p-4 bg-red-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-base font-bold text-red-900">
                Commandes sans coût d&apos;achat: {unmatchedOrders?.count ?? "…"}
                {unmatchedOrders != null && (
                  <span className="font-semibold text-red-800">
                    {" "}
                    · {unmatchedOrders.paidPositiveNetChf.toLocaleString("fr-CH", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    })}{" "}
                    CHF net
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-red-800">
                Shopify net&gt;0, pas encore OrderMatch. Refund/void complets exclus. Clique{" "}
                <strong>Reconcile</strong> → coût / StockX / AWB. Tri: vieux → récent.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {[14, 30, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setUnmatchedDays(d);
                    void loadUnmatchedOrders(d);
                  }}
                  className={`text-xs px-2 py-1 rounded ${
                    unmatchedDays === d
                      ? "bg-red-700 text-white"
                      : "bg-red-200 text-red-900 hover:bg-red-300"
                  }`}
                >
                  {d}j
                </button>
              ))}
              <button
                type="button"
                onClick={() => void loadUnmatchedOrders(unmatchedDays)}
                disabled={unmatchedLoading}
                className="text-xs px-2 py-1 bg-red-200 text-red-900 rounded hover:bg-red-300 disabled:opacity-60"
              >
                {unmatchedLoading ? "…" : "Refresh"}
              </button>
            </div>
          </div>
          {unmatchedError && (
            <p className="mt-2 text-xs text-red-700">Erreur: {unmatchedError}</p>
          )}
          {unmatchedReconcile && (
            <div className="mt-3 border border-red-300 rounded bg-white p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm font-semibold text-red-900">
                  Choisir la ligne — {unmatchedReconcile.orderName}
                </div>
                <button
                  type="button"
                  className="text-xs px-2 py-1 bg-gray-200 rounded hover:bg-gray-300"
                  onClick={() => setUnmatchedReconcile(null)}
                >
                  Fermer
                </button>
              </div>
              {unmatchedReconcile.loading && (
                <p className="text-xs text-gray-500">Chargement lignes Shopify…</p>
              )}
              {unmatchedReconcile.error && (
                <p className="text-xs text-red-700">{unmatchedReconcile.error}</p>
              )}
              {!unmatchedReconcile.loading && unmatchedReconcile.lines.length > 0 && (
                <div className="space-y-2">
                  {unmatchedReconcile.lines.map((line) => (
                    <button
                      key={line.lineItemId}
                      type="button"
                      onClick={() => {
                        setUnmatchedReconcile(null);
                        openManualEntryModal(line);
                      }}
                      className="w-full text-left px-3 py-2 border border-red-200 rounded hover:bg-red-50 text-xs"
                    >
                      <div className="font-semibold text-gray-900">{line.title}</div>
                      <div className="text-gray-600 mt-0.5">
                        {line.sku || "—"} · size {line.sizeEU || "—"} · qty {line.quantity} ·{" "}
                        {line.totalPrice} {line.currencyCode}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {(unmatchedOrders?.orders?.length ?? 0) > 0 && (
            <div className="mt-3 max-h-80 overflow-auto border border-red-200 rounded bg-white">
              <table className="min-w-full text-xs">
                <thead className="bg-red-100 sticky top-0">
                  <tr className="text-left text-red-900">
                    <th className="px-2 py-1.5">Commande</th>
                    <th className="px-2 py-1.5">Date</th>
                    <th className="px-2 py-1.5">Statut</th>
                    <th className="px-2 py-1.5 text-right">Net CHF</th>
                    <th className="px-2 py-1.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedOrders!.orders.map((o) => (
                    <tr key={o.shopifyOrderId || o.orderName} className="border-t border-red-100">
                      <td className="px-2 py-1 font-semibold text-gray-900">{o.orderName}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {formatDate(o.createdAt)}
                      </td>
                      <td className="px-2 py-1">{o.financialStatus ?? "—"}</td>
                      <td className="px-2 py-1 text-right font-mono">
                        {Number(o.netSalesChf).toLocaleString("fr-CH", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <button
                          type="button"
                          disabled={
                            unmatchedReconcileBusy === o.shopifyOrderId ||
                            !o.shopifyOrderId
                          }
                          onClick={() =>
                            void openUnmatchedReconcile({
                              shopifyOrderId: o.shopifyOrderId,
                              orderName: o.orderName,
                            })
                          }
                          className="px-2 py-1 bg-red-700 text-white rounded hover:bg-red-800 disabled:opacity-50 font-semibold"
                        >
                          {unmatchedReconcileBusy === o.shopifyOrderId
                            ? "…"
                            : "Reconcile"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!unmatchedLoading && unmatchedOrders?.count === 0 && (
            <p className="mt-2 text-xs text-green-800 font-medium">
              Aucune commande sans match sur {unmatchedDays} jours.
            </p>
          )}
        </div>

        {(over7TrackingItems.length > 0 || trackingAlertError) && (
          <div className="mb-6 space-y-3">
            {over7TrackingItems.length > 0 && (
              <div className="border rounded-lg p-4 bg-yellow-50 border-yellow-200">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-yellow-800">
                    ⚠️ Orders missing tracking more than 7 days old: {over7TrackingItems.length}
                  </div>
                  <button
                    onClick={loadTrackingAlert}
                    disabled={trackingAlertLoading}
                    className="text-xs px-2 py-1 bg-yellow-200 text-yellow-900 rounded hover:bg-yellow-300 disabled:opacity-60"
                  >
                    {trackingAlertLoading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
                <div className="mt-2 space-y-1 text-xs text-yellow-900">
                  {over7TrackingItems.map((item: any) => (
                    <div key={item.id} className="flex flex-wrap gap-2">
                      <span className="font-semibold">{item.shopifyOrderName}</span>
                      <span>Ref: {item.stockxOrderNumber}</span>
                      <span>Age: {item.ageDays ?? "—"}d</span>
                      <span>ETA: {formatDate(item.deliveryDate)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {trackingAlertError && (
              <div className="border rounded-lg p-4 bg-yellow-50 border-yellow-200 text-xs text-yellow-900">
                Failed to load tracking alerts: {trackingAlertError}
              </div>
            )}
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <h2 className="text-lg font-semibold mb-2">Shopify Order Fetch Test</h2>
          <p className="text-sm text-gray-600 mb-3">
            API version in use: <strong>2026-07</strong>
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            <input
              type="text"
              value={exchangeOrderName}
              onChange={(e) => setExchangeOrderName(e.target.value)}
              placeholder="Order #5816 or return #5816-R1"
              className="px-3 py-2 border border-gray-300 rounded-md text-sm w-56"
            />
            <button
              type="button"
              onClick={handleFetchExchangeOrder}
              disabled={exchangeOrderLoading}
              className="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-colors disabled:bg-gray-400"
            >
              {exchangeOrderLoading ? "Loading exchange…" : "Load exchange order"}
            </button>
          </div>
          <button
            type="button"
            onClick={runOrderTest}
            disabled={orderTestLoading}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors disabled:bg-gray-400"
          >
            {orderTestLoading ? "Fetching…" : "Fetch latest 5 orders"}
          </button>
          {orderTestResult && (
            <pre className="mt-3 max-h-48 overflow-auto bg-gray-900 text-xs text-white p-3 rounded">
              {orderTestResult}
            </pre>
          )}
        </div>

        <AuthenticationCard
          stockxToken={stockxToken}
          onStockxTokenChange={(value) => setStockxToken(normalizeStockxTokenInput(value))}
          goatCookie={goatCookie}
          onGoatCookieChange={setGoatCookie}
          goatCsrfToken={goatCsrfToken}
          onGoatCsrfTokenChange={setGoatCsrfToken}
          saveToken={saveToken}
          onSaveTokenToggle={setSaveToken}
          onBackfillAwb={() => void runAwbBackfillFromAuth({ auto: false })}
          awbBackfillBusy={awbBackfillBusy}
          awbBackfillStatus={awbBackfillStatus}
        />

        <QueryControls
          persistedQueryHash={persistedQueryHash}
          onPersistedQueryHashChange={setPersistedQueryHash}
        />

        <FetchActions
          onFetchFirst={handleFetchFirstPage}
          onFetchNext={handleFetchNextPage}
          onFetchAllOrders={handleFetchAllOrdersWrapper}
          onEnrichLoaded={handleEnrichLoadedOrdersWrapper}
          onFetchPricing={handleFetchAllPricingWrapper}
          onClear={handleClearResults}
          onExport={handleExportCSV}
          onGoatLogin={handleGoatLogin}
          goatLoginLoading={goatDebugLoading}
          onGoatDebug={handleGoatDebug}
          onExportGoatSession={handleExportGoatSession}
          onImportGoatSession={handleImportGoatSession}
          onStockxLogin={handleStockxLogin}
          stockxLoginLoading={stockxLoginLoading}
          loading={loading}
          isFetchingAll={isFetchingAll}
          isEnriching={isEnriching}
          detailsProgress={detailsProgress}
          ordersCount={orders.length}
          hasNextPage={!!pageInfo?.hasNextPage}
        />

        <DebugPanel
          lastStatus={lastStatus}
          pageInfo={pageInfo}
          ordersCount={orders.length}
          lastErrors={lastErrors}
          lastRequestPayload={lastRequestPayload}
          lastResponsePayload={lastResponsePayload}
        />

        <ResultsTable
          orders={orders}
          enrichedOrders={enrichedOrders}
          pricingByOrder={pricingByOrder}
          pricingLoading={pricingLoading}
        fetchPricingForOrder={fetchPricingForOrderWrapper}
        />

        {goatDebugLoading && (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
            Loading GOAT debug JSON...
          </div>
        )}
        {goatDebugResult && (
          <pre className="mt-4 max-h-[60vh] overflow-auto bg-gray-900 text-xs text-white p-3 rounded">
            {goatDebugResult}
          </pre>
        )}

        <ManualMatchingOverride
          manualFetchOrder={manualFetchOrder}
          manualFetchLoading={manualFetchLoading}
          setManualFetchOrder={setManualFetchOrder}
          handleFetchShopifyOrder={handleFetchShopifyOrderWrapper}
        />

        <DatabaseAutoSync
          onLoadFromDatabase={loadFromDB}
          onRefreshTrackingFromStockx={refreshTrackingFromStockx}
          dbLoading={dbLoading}
          token={stockxToken}
          dbMatches={dbMatches}
          manualOverrideExpanded={manualOverrideExpanded}
          setManualOverrideExpanded={setManualOverrideExpanded}
          manualOverrideData={manualOverrideData}
          setManualOverrideData={setManualOverrideData}
          manualOverrideLoading={manualOverrideLoading}
          applyManualOverride={applyManualOverrideWrapper}
          deleteMatch={deleteMatch}
          toNumber={toNumber}
          openManualEntryModalForEdit={openManualEntryModalForEdit}
        />

        <OrderMatchingSection
          matchResults={matchResults}
          loadShopifyOrders={loadShopifyOrders}
          loadingShopify={loadingShopify}
          orders={orders}
          enrichedOrders={enrichedOrders}
          pricingByOrder={pricingByOrder}
          pricingLoading={pricingLoading}
        fetchPricingForOrder={fetchPricingForOrderWrapper}
          manualOverrides={manualOverrides}
          setManualOverrides={setManualOverrides}
          confirmedMatches={confirmedMatches}
          setConfirmedMatches={setConfirmedMatches}
          manualCostOverrides={manualCostOverrides}
          setManualCostOverrides={setManualCostOverrides}
          createManualCostEntry={createManualCostEntry}
          autoSetAllHighMatches={autoSetAllHighMatchesAndRefresh}
          handleSetMetafields={handleSetMetafields}
          openManualEntryModal={openManualEntryModal}
        />
      </div>

      <ManualEntryModal
        isOpen={manualEntryModal.isOpen}
        mode={manualEntryModal.mode}
        initialData={manualEntryData}
        shopifyItem={manualEntryModal.shopifyItem}
        onSave={(data, mode) => saveManualEntry(data, mode)}
        onClose={() => setManualEntryModal({ isOpen: false, shopifyItem: null, mode: 'create' })}
      />


    </div>
  );
}

