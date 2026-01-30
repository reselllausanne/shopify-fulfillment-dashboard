"use client";

import React, { useState, useEffect } from "react";
import AuthenticationCard from "@/app/components/AuthenticationCard";
import ActionBar from "@/app/components/ActionBar";
import QueryControls from "@/app/components/QueryControls";
import FetchActions from "@/app/components/FetchActions";
import DebugPanel from "@/app/components/DebugPanel";
import ManualEntryModal from "@/app/components/ManualEntryModal";
import ResultsTable from "@/app/components/ResultsTable";
import ManualMatchingOverride from "@/app/components/ManualMatchingOverride";
import DatabaseAutoSync from "@/app/components/DatabaseAutoSync";
import OrderMatchingSection from "@/app/components/OrderMatchingSection";
import { type ShopifyLineItem } from "./utils/matching";
import { DEFAULT_QUERY, DEFAULT_VARIABLES } from "@/app/lib/constants";
import type { PageInfo, PricingResult, OrderNode } from "@/app/types";
import { toNumber } from "@/app/utils/format";
import { useSupplierOrders } from "@/app/hooks/useSupplierOrders";
import { exportOrdersToCSV } from "@/app/utils/csv";
import { useMatching } from "@/app/hooks/useMatching";
import { getJson, postJson, delJson } from "@/app/lib/api";

export default function Home() {
  const [token, setToken] = useState("");
  const [saveToken, setSaveToken] = useState(false);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [variables, setVariables] = useState(JSON.stringify(DEFAULT_VARIABLES, null, 2));
  const [stateFilter, setStateFilter] = useState<string>("PENDING");

  const {
    orders,
    pageInfo,
    lastStatus,
    lastErrors,
    enrichedOrders,
    isEnriching,
    detailsProgress,
    loading,
    isFetchingAll,
    pricingByOrder,
    pricingLoading,
    fetchPage,
    handleFetchAllPages,
    fetchPricingForOrder,
    fetchAllPricing,
    setOrders,
    setPageInfo,
    setLastStatus,
    setLastErrors,
    setEnrichedOrders,
  } = useSupplierOrders();

  // DB + Workers state
  const [dbMatches, setDbMatches] = useState<any[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [orderTestResult, setOrderTestResult] = useState<string | null>(null);
  const [orderTestLoading, setOrderTestLoading] = useState(false);

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
      await loadExchangeOrderByName(exchangeOrderName.trim());
      alert(`✅ Loaded exchange line items for ${exchangeOrderName.trim()}`);
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
    manualShopifyOrder,
    setManualShopifyOrder,
    manualSupplierOrder,
    setManualSupplierOrder,
    manualMatchLoading,
    loadShopifyOrders,
    clearManualOverrides,
    handleManualMatch,
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
    await refreshDbMatchesTracking();
    await loadFromDB();
  };

  const handleManualMatchWrapper = async () => {
    await handleManualMatch(manualShopifyOrder, manualSupplierOrder);
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

  // Load token from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem("supplier_token");
    if (savedToken) {
      setToken(savedToken);
      setSaveToken(true);
    }
  }, []);

  // Save/remove token from localStorage
  useEffect(() => {
    if (saveToken && token) {
      localStorage.setItem("supplier_token", token);
    } else {
      localStorage.removeItem("supplier_token");
    }
  }, [saveToken, token]);

  const handleFetchFirstPage = async () => {
    await fetchPage({
      token,
      query,
      variablesJSON: variables,
      stateFilter,
      cursor: null,
      append: false,
    });
  };

  const handleFetchNextPage = async () => {
    if (pageInfo?.endCursor && pageInfo.hasNextPage) {
      await fetchPage({
        token,
        query,
        variablesJSON: variables,
        stateFilter,
        cursor: pageInfo.endCursor,
        append: true,
      });
    } else {
      alert("No next page available");
    }
  };

  const handleFetchAllPagesWrapper = async () => {
    await handleFetchAllPages({
      token,
      query,
      variablesJSON: variables,
      stateFilter,
    });
  };

  const handleFetchAllPricingWrapper = async () => {
    await fetchAllPricing(token);
  };
  const handleClearResults = () => {
    setOrders([]);
    setPageInfo(null);
    setLastStatus(null);
    setLastErrors([]);
  };

  const handleExportCSV = () => {
    exportOrdersToCSV(orders, pricingByOrder);
  };

  const fetchPricingForOrderWrapper = async (order: OrderNode) => {
    await fetchPricingForOrder(order, token);
  };

  // Sync worker removed from UI (no-op placeholder)

  // ✅ NEW: Open full manual entry modal with ALL DB fields (CREATE mode)
  const openManualEntryModal = (shopifyItem: ShopifyLineItem) => {
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
      alert(
        `✅ Manual entry ${modeText}!\n\n` +
        `Order: ${data.shopifyOrderName}\n` +
        `Supplier Order: ${saveData.stockxOrderNumber || data.stockxOrderNumber}\n` +
        `Cost: CHF ${supplierCost.toFixed(2)}\n` +
        `Margin: CHF ${marginAmount.toFixed(2)} (${marginPercent.toFixed(1)}%)\n\n` +
        (isEditMode && changedCount > 0 ? `${changedCount} field(s) modified` : "")
      );
      
      // Close modal and reload
      setManualEntryModal({ isOpen: false, shopifyItem: null, mode: 'create' });
      await loadFromDB();
      
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
          </nav>
        </div>

        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <h2 className="text-lg font-semibold mb-2">Shopify Order Fetch Test</h2>
          <p className="text-sm text-gray-600 mb-3">
            API version in use: <strong>2026-01</strong>
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            <input
              type="text"
              value={exchangeOrderName}
              onChange={(e) => setExchangeOrderName(e.target.value)}
              placeholder="Order number (e.g. #4745)"
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
          token={token}
          onTokenChange={setToken}
          saveToken={saveToken}
          onSaveTokenToggle={setSaveToken}
        />

        <QueryControls
          query={query}
          onQueryChange={setQuery}
          variables={variables}
          onVariablesChange={setVariables}
          stateFilter={stateFilter}
          onStateFilterChange={setStateFilter}
        />

        <FetchActions
          onFetchFirst={handleFetchFirstPage}
          onFetchNext={handleFetchNextPage}
        onFetchAll={handleFetchAllPagesWrapper}
        onFetchPricing={handleFetchAllPricingWrapper}
          onClear={handleClearResults}
          onExport={handleExportCSV}
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
        />

        <ResultsTable
          orders={orders}
          enrichedOrders={enrichedOrders}
          pricingByOrder={pricingByOrder}
          pricingLoading={pricingLoading}
        fetchPricingForOrder={fetchPricingForOrderWrapper}
        />

        <ManualMatchingOverride
          manualShopifyOrder={manualShopifyOrder}
          manualSupplierOrder={manualSupplierOrder}
          manualMatchLoading={manualMatchLoading}
          manualOverrides={manualOverrides}
          shopifyItems={shopifyItems}
          setManualShopifyOrder={setManualShopifyOrder}
          setManualSupplierOrder={setManualSupplierOrder}
          handleManualMatch={handleManualMatchWrapper}
          clearManualOverrides={clearManualOverrides}
        />

        <DatabaseAutoSync
          onLoadFromDatabase={loadFromDB}
          dbLoading={dbLoading}
          token={token}
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

