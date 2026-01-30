import { useState } from "react";
import {
  matchShopifyToSupplier,
  type NormalizedSupplierOrder,
  type ShopifyLineItem,
  type MatchResult,
  EXCLUDED_SKUS,
} from "@/app/utils/matching";
import type { PricingResult } from "@/app/types";
import { postJson, getJson } from "@/app/lib/api";
import { toNumber } from "@/app/utils/format";

type SetMetafieldsArgs = {
  token: string;
  pricingByOrder: Record<string, PricingResult | null>;
  enrichedOrders: any[] | null;
  orders: any[];
  matchResults: MatchResult[];
  confirmedMatches: Record<string, string>;
  manualCostOverrides: Record<string, string>;
  setManualCostOverrides: (v: Record<string, string>) => void;
  metafieldsSet: Record<string, { timestamp: string; supplierOrderNumber: string }>;
  setMetafieldsSet: (v: Record<string, { timestamp: string; supplierOrderNumber: string }>) => void;
  metafieldsLoading: Record<string, boolean>;
  setMetafieldsLoading: (v: Record<string, boolean>) => void;
};

type UseMatchingArgs = {
  enrichedOrders: any[] | null;
  orders: NormalizedSupplierOrder[] | any[];
  pricingByOrder: Record<string, PricingResult | null>;
  reloadDb?: () => Promise<void>;
};

export function useMatching({ enrichedOrders, orders, pricingByOrder, reloadDb }: UseMatchingArgs) {
  const [shopifyItems, setShopifyItems] = useState<ShopifyLineItem[]>([]);
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [loadingShopify, setLoadingShopify] = useState(false);
  const [manualOverrides, setManualOverrides] = useState<Record<string, { supplierOrderNumber: string; method: string }>>({});
  const [confirmedMatches, setConfirmedMatches] = useState<Record<string, string>>({});
  const [manualCostOverrides, setManualCostOverrides] = useState<Record<string, string>>({});
  const [metafieldsSet, setMetafieldsSet] = useState<Record<string, { timestamp: string; supplierOrderNumber: string }>>({});
  const [metafieldsLoading, setMetafieldsLoading] = useState<Record<string, boolean>>({});
  const [manualShopifyOrder, setManualShopifyOrder] = useState("");
  const [manualSupplierOrder, setManualSupplierOrder] = useState("");
  const [manualMatchLoading, setManualMatchLoading] = useState(false);
  const [manualOverrideExpanded, setManualOverrideExpanded] = useState<Record<string, boolean>>({});
  const [manualOverrideData, setManualOverrideData] = useState<
    Record<
      string,
      {
        status: string;
        returnReason: string;
        returnFeePercent: string;
        returnedStockValue: string;
        adjustment: string;
        note: string;
        manualCost: string;
      }
    >
  >({});
  const [manualOverrideLoading, setManualOverrideLoading] = useState<Record<string, boolean>>({});

  const runMatching = async (items: ShopifyLineItem[]) => {
    setShopifyItems(items);

    // Normalize Supplier orders for matching (use enriched if available)
    const sourceOrders = enrichedOrders || orders;
    console.log(`[MATCHING] Using ${enrichedOrders ? "ENRICHED" : "BASIC"} orders (${sourceOrders.length} total)`);

    const sourceIds = sourceOrders.map((o: any) => o.orderId);
    const uniqueSourceIds = new Set(sourceIds);
    if (uniqueSourceIds.size !== sourceOrders.length) {
      console.error(
        `[MATCHING] ⚠️ WARNING: Source has duplicates! ${sourceOrders.length} orders but only ${uniqueSourceIds.size} unique IDs`
      );
    }

    const normalizedSupplier: NormalizedSupplierOrder[] = sourceOrders.map((o: any) => {
      const supplierCostFromB = (o as any).supplierCost ?? null;
      const supplierCostFromPricing =
        o.orderNumber && pricingByOrder[o.orderNumber]?.total != null ? pricingByOrder[o.orderNumber]!.total : null;
      const finalTotalTTC = supplierCostFromB ?? supplierCostFromPricing;

      return {
        supplierOrderNumber: o.orderNumber || "",
        chainId: o.chainId || "",
        orderId: o.orderId || "",
        purchaseDate: o.purchaseDate || "",
        offerAmount: o.amount,
        totalTTC: finalTotalTTC,
        productTitle: o.displayName,
        skuKey: o.skuKey,
        sizeEU: o.size,
        statusKey: o.statusKey ?? o.statusKeyB ?? o.statusB ?? null,
        statusTitle: o.statusTitle ?? o.statusB ?? null,
        currencyCode: o.currencyCode,
        estimatedDeliveryDate:
          (o as any).estimatedDeliveryDate ??
          (o as any).estimatedDeliveryB ??
          (o as any).estimatedDeliveryDateRange?.estimatedDeliveryDate ??
          null,
        latestEstimatedDeliveryDate:
          (o as any).latestEstimatedDeliveryDate ??
          (o as any).latestEstimatedDeliveryB ??
          (o as any).estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ??
          null,
        awb: (o as any).awb || null,
        trackingUrl: (o as any).trackingUrl || null,
        stockxCheckoutType: o.stockxCheckoutType ?? null,
        stockxStates: o.stockxStates ?? null,
      };
    });

    console.log(`[MATCHING] Normalized ${normalizedSupplier.length} supplier orders for matching`);
    const withSupplierCostB = normalizedSupplier.filter((o) => o.totalTTC !== null).length;
    console.log(`[MATCHING] ${withSupplierCostB}/${normalizedSupplier.length} orders have totalTTC (Query B supplier cost)`);

    // 🔒 Filter out already matched supplier orders (DB)
    let availableSupplier = normalizedSupplier;
    try {
      const dbRes = await getJson<any>("/api/db/matches");
      if (dbRes.ok) {
        const usedSupplierNumbers = new Set(dbRes.data?.matches?.map((m: any) => m.supplierOrderNumber));
        availableSupplier = normalizedSupplier.filter((order) => !usedSupplierNumbers.has(order.supplierOrderNumber));
        const filteredOut = normalizedSupplier.filter((order) => usedSupplierNumbers.has(order.supplierOrderNumber));
        console.log(
          `🔒 Filtered out ${filteredOut.length} already-matched Supplier orders:`,
          filteredOut.map((o) => o.supplierOrderNumber).join(", ")
        );
      } else {
        console.warn("Failed to fetch DB matches for filtering");
      }
    } catch (err) {
      console.warn("Error fetching DB matches, proceeding without filtering", err);
    }

    const results = items.map((item: ShopifyLineItem) => matchShopifyToSupplier(item, availableSupplier));

    setMatchResults(results);
    console.log(`Matched ${results.length} Shopify items`);
  };

  const loadShopifyOrders = async (sinceDays = 30) => {
    setLoadingShopify(true);
    try {
      const res = await postJson<any>("/api/shopify/orders", { sinceDays });
      if (!res.ok) {
        alert(`Shopify error: ${res.data?.error || "Unknown error"}`);
        return;
      }
      const items = res.data?.lineItems || [];
      await runMatching(items);
    } catch (error) {
      console.error("Error loading Shopify orders:", error);
      alert("Failed to load Shopify orders");
    } finally {
      setLoadingShopify(false);
    }
  };

  const loadExchangeOrderByName = async (orderName: string) => {
    setLoadingShopify(true);
    try {
      const res = await postJson<any>("/api/shopify/order-exchange-by-name", { orderName });
      if (!res.ok) {
        alert(`Shopify error: ${res.data?.error || "Unknown error"}`);
        return;
      }
      const items = res.data?.lineItems || [];
      if (!items.length) {
        alert(`No exchange line items found for ${orderName}`);
        return;
      }
      await runMatching(items);
    } catch (error: any) {
      console.error("Error loading exchange order:", error);
      alert("Failed to load exchange order");
    } finally {
      setLoadingShopify(false);
    }
  };

  /**
   * Refresh existing DB matches (tracking + states + ETA range) from the currently loaded
   * supplier orders/enriched StockX data, without re-matching.
   *
   * This is critical because the matching flow filters out already-matched supplier orders,
   * so pressing "match all" alone may not update old DB rows.
   */
  const refreshDbMatchesTracking = async () => {
    try {
      const dbRes = await getJson<any>("/api/db/matches");
      if (!dbRes.ok) {
        throw new Error(`Failed to load DB matches: ${dbRes.status}`);
      }

      const matches: any[] = dbRes.data?.matches || [];
      const sourceOrders = (enrichedOrders || orders) as any[];

      let updated = 0;
      let skipped = 0;

      for (const m of matches) {
        // Only refresh StockX-backed matches
        const supplierSource = (m.supplierSource || "STOCKX").toString();
        if (supplierSource !== "STOCKX") {
          skipped += 1;
          continue;
        }

        const supplierOrderNumber = m.stockxOrderNumber;
        if (!supplierOrderNumber) {
          skipped += 1;
          continue;
        }

        const raw = sourceOrders.find((o: any) => o.orderNumber === supplierOrderNumber);
        if (!raw) {
          skipped += 1;
          continue;
        }

        const trackingUrl =
          raw.trackingUrl || (raw as any).trackingUrl || (raw as any).buyOrder?.shipping?.shipment?.trackingUrl || null;
        const awb = (raw as any).awb || null;
        const checkoutType = (raw as any).stockxCheckoutType || (raw as any)?.buyOrder?.checkoutType || null;
        const states = (raw as any).stockxStates || (raw as any)?.buyOrder?.states || null;
        const status =
          (raw as any).statusKey ??
          (raw as any).statusKeyB ??
          (raw as any).statusB ??
          (raw as any)?.buyOrder?.currentStatus?.key ??
          null;
        const estimatedStart =
          (raw as any).estimatedDeliveryB ||
          (raw as any).estimatedDeliveryDate ||
          (raw as any)?.buyOrder?.estimatedDeliveryDateRange?.estimatedDeliveryDate ||
          null;
        const estimatedEnd =
          (raw as any).latestEstimatedDeliveryB ||
          (raw as any).latestEstimatedDeliveryDate ||
          (raw as any)?.buyOrder?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ||
          null;

        await postJson("/api/db/save-match", {
          shopifyLineItemId: m.shopifyLineItemId,
          stockxOrderNumber: supplierOrderNumber,
          stockxStatus: status,
          stockxTrackingUrl: trackingUrl,
          stockxAwb: awb,
          stockxCheckoutType: checkoutType,
          stockxStates: states,
          stockxEstimatedDelivery: estimatedStart,
          stockxLatestEstimatedDelivery: estimatedEnd,
          updateTrackingOnly: true,
        });

        updated += 1;
        // light pacing to avoid hammering
        await new Promise((r) => setTimeout(r, 120));
      }

      alert(
        `✅ Refresh existing DB matches done.\n\n` +
          `Updated: ${updated}\n` +
          `Skipped: ${skipped}\n\n` +
          `This repopulates ETA start/end + tracking/states for old orders when data is available in the currently loaded StockX list.`
      );
    } catch (err: any) {
      console.error("[DB_REFRESH] Failed:", err);
      alert(`❌ Failed to refresh DB matches:\n\n${err?.message || "Unknown error"}`);
    }
  };

  // Manual clear overrides helper
  const clearManualOverrides = () => {
    if (!confirm(`Clear ${Object.keys(manualOverrides).length} manual override(s)?`)) {
      return;
    }
    setManualOverrides({});
    alert("✅ Manual overrides cleared");
  };

  const handleManualMatch = async (manualShopifyOrderInput: string, manualSupplierOrderInput: string) => {
    if (!manualShopifyOrderInput.trim() || !manualSupplierOrderInput.trim()) {
      alert("Please enter both Shopify and Supplier order numbers");
      return;
    }

    setManualMatchLoading(true);
    try {
      const cleanShopifyNum = manualShopifyOrderInput.replace("#", "").trim();
      const cleanSupplierNum = manualSupplierOrderInput.trim();

      let shopifyItem = shopifyItems.find((item) => item.orderName.replace("#", "") === cleanShopifyNum);

      if (!shopifyItem) {
        const fetchRes = await postJson<any>("/api/shopify/order-by-name", { orderName: `#${cleanShopifyNum}` });
        if (!fetchRes.ok) {
          alert(
            `❌ Failed to fetch Shopify order #${cleanShopifyNum}\n\n` +
              `Error: ${fetchRes.data?.error || "Unknown error"}\n\n` +
              `Make sure the order number is correct and exists in your Shopify store.`
          );
          return;
        }
        const fetchedLineItems = fetchRes.data?.lineItems || [];
        if (fetchedLineItems.length === 0) {
          alert(`❌ Shopify order #${cleanShopifyNum} has no line items`);
          return;
        }

        setShopifyItems((prev) => [...prev, ...fetchedLineItems]);

        if (fetchedLineItems.length > 1) {
          const proceed = confirm(
            `ℹ️ Order #${cleanShopifyNum} has ${fetchedLineItems.length} line items.\n\n` +
              `This will match the Supplier order to the FIRST line item:\n` +
              `"${fetchedLineItems[0].title}"\n\n` +
              `Continue?`
          );
          if (!proceed) return;
        }

        shopifyItem = fetchedLineItems[0];

        const sourceOrders = enrichedOrders || orders;
        const normalizedSupplier: NormalizedSupplierOrder[] = sourceOrders.map((o: any) => {
          const supplierCostFromB = (o as any).supplierCost ?? null;
          const supplierCostFromPricing =
            o.orderNumber && pricingByOrder[o.orderNumber]?.total != null ? pricingByOrder[o.orderNumber]!.total : null;
          const finalTotalTTC = supplierCostFromB ?? supplierCostFromPricing;
          const stockxCheckoutType = (o as any).stockxCheckoutType || (o as any).buyOrder?.checkoutType || null;
          const stockxStates = (o as any).stockxStates || (o as any).buyOrder?.states || null;

          return {
            supplierOrderNumber: o.orderNumber || "",
            chainId: o.chainId || "",
            orderId: o.orderId || "",
            purchaseDate: o.purchaseDate || "",
            offerAmount: o.amount,
            totalTTC: finalTotalTTC,
            productTitle: o.displayName,
            skuKey: o.skuKey,
            sizeEU: o.size,
            statusKey: o.statusKey,
            statusTitle: o.statusTitle,
            currencyCode: o.currencyCode,
            awb: (o as any).awb || null,
            trackingUrl: (o as any).trackingUrl || null,
            stockxCheckoutType,
            stockxStates,
          };
        });

        const newMatchResults = fetchedLineItems.map((item: ShopifyLineItem) =>
          matchShopifyToSupplier(item, normalizedSupplier)
        );
        setMatchResults((prev) => [...prev, ...newMatchResults]);
      }

      if (!shopifyItem) {
        alert(`❌ Internal error: Shopify item not found after fetch`);
        return;
      }

      const supplierOrder = orders.find((o: any) => o.orderNumber === cleanSupplierNum);
      if (!supplierOrder) {
        const proceed = confirm(
          `⚠️ Supplier order ${cleanSupplierNum} not found in currently loaded Supplier orders.\n\n` +
            `This might be because:\n` +
            `- The order hasn't been fetched yet\n` +
            `- The order number is incorrect\n\n` +
            `Do you want to save this match anyway?`
        );
        if (!proceed) return;
      }

      setManualOverrides((prev) => ({
        ...prev,
        [shopifyItem!.lineItemId]: {
          supplierOrderNumber: cleanSupplierNum,
          method: "MANUAL_OVERRIDE",
        },
      }));

      setConfirmedMatches((prev) => ({
        ...prev,
        [shopifyItem!.lineItemId]: cleanSupplierNum,
      }));

      alert(
        `✅ Manual match saved!\n\n` +
          `${shopifyItem.orderName} → ${cleanSupplierNum}\n\n` +
          `Product: ${shopifyItem.title}`
      );
      setManualShopifyOrder("");
      setManualSupplierOrder("");
    } catch (error: any) {
      console.error("[MANUAL MATCH] Error:", error);
      alert(`❌ Error creating manual match:\n\n${error.message}`);
    } finally {
      setManualMatchLoading(false);
    }
  };


  const createManualCostEntry = async (shopifyItem: ShopifyLineItem) => {
    const isLiquidation = /%/.test(shopifyItem.title);
    const isEssentialHoodie = shopifyItem.sku && EXCLUDED_SKUS.includes(shopifyItem.sku);

    let supplierCost: number;
    if (isEssentialHoodie) {
      const autoConfirm = confirm(
        `💰 Essential Hoodie Detected!\n\n` +
          `Product: ${shopifyItem.title}\n` +
          `SKU: ${shopifyItem.sku}\n\n` +
          `Auto-apply 42 CHF supplier cost?\n\n` +
          `Click OK to auto-apply 42 CHF\n` +
          `Click Cancel to enter custom cost`
      );
      if (autoConfirm) {
        supplierCost = 42;
      } else {
        const customInput = prompt(`Enter custom supplier cost for ${shopifyItem.title}:`, "42");
        if (!customInput) return;
        supplierCost = parseFloat(customInput);
        if (isNaN(supplierCost) || supplierCost < 0) {
          alert("❌ Invalid cost. Please enter a positive number.");
          return;
        }
      }
    } else {
      const promptMessage = isLiquidation
        ? `💰 Liquidation Order: ${shopifyItem.title}\n\nEnter your buy price (supplier cost) in CHF:`
        : `💰 Manual Cost Entry: ${shopifyItem.title}\n\nEnter supplier cost in CHF:`;
      const supplierCostInput = prompt(promptMessage, "");
      if (!supplierCostInput) return;
      supplierCost = parseFloat(supplierCostInput);
      if (isNaN(supplierCost) || supplierCost < 0) {
        alert("❌ Invalid cost. Please enter a positive number.");
        return;
      }
    }

    const revenue = parseFloat(shopifyItem.totalPrice);
    const margin = revenue - supplierCost;
    const marginPercent = revenue > 0 ? (margin / revenue) * 100 : 0;

    const confirmMessage =
      `📝 Create Manual Cost Entry?\n\n` +
      `Order: ${shopifyItem.orderName}\n` +
      `Product: ${shopifyItem.title}\n` +
      `Size: ${shopifyItem.sizeEU || "N/A"}\n\n` +
      `💰 Financial Summary:\n` +
      `Revenue: CHF ${revenue.toFixed(2)}\n` +
      `Supplier Cost: CHF ${supplierCost.toFixed(2)}\n` +
      `Margin: CHF ${margin.toFixed(2)} (${marginPercent.toFixed(1)}%)\n\n` +
      `⚠️ This will:\n` +
      `✅ Add to dashboard metrics\n` +
      `✅ Mark as "MANUAL_COST" (no Supplier link)\n` +
      `❌ NOT appear in fulfillment queue\n` +
      `${isLiquidation ? "✅ Track liquidation sale\n" : ""}` +
      `${isEssentialHoodie ? "✅ Track Essential Hoodie with 42 CHF cost\n" : ""}`;

    if (!confirm(confirmMessage)) return;

    try {
      const res = await postJson<any>("/api/db/save-match", {
        shopifyOrderId: shopifyItem.shopifyOrderId,
        shopifyOrderName: shopifyItem.orderName,
        shopifyCreatedAt: shopifyItem.createdAt,
        shopifyLineItemId: shopifyItem.lineItemId,
        shopifyProductTitle: shopifyItem.title,
        shopifySku: shopifyItem.sku,
        shopifySizeEU: shopifyItem.sizeEU,
        shopifyTotalPrice: revenue,
        shopifyCurrencyCode: shopifyItem.currencyCode,
        shopifyCustomerEmail: shopifyItem.customerEmail,
        shopifyCustomerFirstName: shopifyItem.customerFirstName,
        shopifyCustomerLastName: shopifyItem.customerLastName,
        shopifyLineItemImageUrl: shopifyItem.lineItemImageUrl,
        stockxOrderNumber: null,
        stockxProductName: shopifyItem.title,
        stockxSizeEU: shopifyItem.sizeEU,
        stockxSkuKey: shopifyItem.sku,
        stockxPurchaseDate: shopifyItem.createdAt || null,
        supplierPurchaseDate: shopifyItem.createdAt || null,
        matchConfidence: "manual",
        matchScore: 100,
        matchType: "MANUAL_COST",
        matchReasons: [
          isLiquidation
            ? "Liquidation order (% in title)"
            : isEssentialHoodie
            ? "Essential Hoodie (auto 42 CHF)"
            : "Manual cost entry",
        ],
        timeDiffHours: 0,
        stockxStatus: "MANUAL_COST_ONLY",
        stockxEstimatedDelivery: null,
        supplierCost,
        marginAmount: margin,
        marginPercent,
        manualCostOverride: supplierCost,
        shopifyMetafieldsSynced: false,
      });

      if (!res.ok) {
        alert(`❌ Failed to create entry:\n\n${res.data?.error}\n\n${res.data?.details || ""}`);
        return;
      }

      alert(
        `✅ Manual cost entry created!\n\n` +
          `Order: ${shopifyItem.orderName}\n` +
          `Product: ${shopifyItem.title}\n` +
          `Revenue: CHF ${revenue.toFixed(2)}\n` +
          `Cost: CHF ${supplierCost.toFixed(2)}\n` +
          `Margin: CHF ${margin.toFixed(2)} (${marginPercent.toFixed(1)}%)\n\n` +
          `✅ Added to dashboard\n` +
          `🔒 Won't appear in fulfillment`
      );

      if (reloadDb) await reloadDb();
    } catch (error: any) {
      console.error("[MANUAL_COST] Error:", error);
      alert(`❌ Error creating entry:\n\n${error.message}`);
    }
  };

  const applyManualOverride = async (
    matchId: string,
    match: any,
    overrideData: {
      status: string;
      returnReason: string;
      returnFeePercent: string;
      returnedStockValue: string;
      adjustment: string;
      note: string;
      manualCost: string;
    }
  ) => {
    if (!overrideData) return;
    const adjustment = parseFloat(overrideData.adjustment || "0");
    const manualCost = overrideData.manualCost ? parseFloat(overrideData.manualCost) : null;
    const revenue = toNumber(match.shopifyTotalPrice);
    const returnReason = overrideData.returnReason || null;
    const returnFeePercent =
      overrideData.returnFeePercent
        ? parseFloat(overrideData.returnFeePercent)
        : returnReason === "STORE_CREDIT"
        ? 25
        : returnReason === "EXCHANGE"
        ? 15
        : returnReason === "DAMAGE"
        ? 0
        : null;
    const returnFeeAmount =
      returnReason && returnFeePercent != null && !isNaN(returnFeePercent)
        ? Number(((revenue * returnFeePercent) / 100).toFixed(2))
        : null;
    const effectiveRevenue =
      returnReason && returnFeeAmount != null ? returnFeeAmount : revenue + adjustment;
    const effectiveCost = manualCost !== null ? manualCost : toNumber(match.supplierCost);
    const resolvedReturnedStockValue =
      overrideData.returnedStockValue?.trim()
        ? parseFloat(overrideData.returnedStockValue)
        : returnReason
        ? Number(effectiveCost)
        : null;

    const marginPct =
      effectiveRevenue > 0 ? ((effectiveRevenue - effectiveCost) / effectiveRevenue) * 100 : 0;

    const confirmMessage =
      `📝 Apply Manual Override?\n\n` +
      `Order: ${match.shopifyOrderName}\n` +
      `Product: ${match.shopifyProductTitle}\n\n` +
      `Status: ${overrideData.status || "ACTIVE (default)"}\n` +
      (returnReason ? `Return Reason: ${returnReason}\n` : "") +
      (returnFeeAmount != null ? `Return Fee: CHF ${returnFeeAmount.toFixed(2)}\n` : "") +
      (resolvedReturnedStockValue != null
        ? `Returned Stock Value: CHF ${resolvedReturnedStockValue.toFixed(2)}\n`
        : "") +
      `Revenue Adjustment: CHF ${adjustment.toFixed(2)}\n` +
      (manualCost !== null ? `Manual Supplier Cost: CHF ${manualCost.toFixed(2)}\n` : "") +
      `Note: ${overrideData.note || "(none)"}\n\n` +
      `💰 Financial Impact:\n` +
      `Original Revenue: CHF ${toNumber(match.shopifyTotalPrice).toFixed(2)}\n` +
      `Adjusted Revenue: CHF ${effectiveRevenue.toFixed(2)}\n` +
      `Supplier Cost: CHF ${effectiveCost.toFixed(2)}\n` +
      `Adjusted Margin: CHF ${(effectiveRevenue - effectiveCost).toFixed(2)} (${marginPct.toFixed(1)}%)\n\n` +
      `⚠️ This will ${manualCost !== null ? "mark as MANUAL COST (no Supplier) and " : ""}protect this match from auto-sync updates.`;

    if (!confirm(confirmMessage)) return;

    setManualOverrideLoading((prev) => ({ ...prev, [matchId]: true }));
    try {
      const res = await postJson<any>("/api/db/manual-override", {
        matchId,
        manualCaseStatus: overrideData.status || null,
        manualRevenueAdjustment: adjustment,
        manualNote: overrideData.note || null,
        manualSupplierCost: manualCost,
        returnReason,
        returnFeePercent,
        returnedStockValueChf: overrideData.returnedStockValue
          ? parseFloat(overrideData.returnedStockValue)
          : null,
      });

      if (!res.ok) {
        alert(`❌ Failed to apply override:\n\n${res.data?.error}\n\n${res.data?.details || ""}`);
        return;
      }

      const updated = res.data?.updatedMatch;
      const updatedSupplierCost = updated ? toNumber(updated.supplierCost) : null;
      const updatedMarginAmount = updated ? toNumber(updated.marginAmount) : null;
      const updatedMarginPercent = updated ? toNumber(updated.marginPercent) : null;
      alert(
        `✅ Manual override applied!\n\n` +
          `Order: ${match.shopifyOrderName}\n` +
          `Effective Revenue: CHF ${updated ? updated.shopifyTotalPrice + (updated.manualRevenueAdjustment || 0) : "N/A"}\n` +
          `Supplier Cost: CHF ${updatedSupplierCost != null ? updatedSupplierCost.toFixed(2) : "N/A"}\n` +
          `Margin: CHF ${updatedMarginAmount != null ? updatedMarginAmount.toFixed(2) : "N/A"} (${updatedMarginPercent != null ? updatedMarginPercent.toFixed(1) : "N/A"}%)\n\n` +
          `✅ Dashboard will reflect this change immediately.\n` +
          `🔒 Auto-sync will NOT overwrite this.`
      );

      setManualOverrideExpanded((prev) => ({ ...prev, [matchId]: false }));
      setManualOverrideData((prev) => ({
        ...prev,
        [matchId]: {
          status: "",
          returnReason: "",
          returnFeePercent: "",
          returnedStockValue: "",
          adjustment: "",
          note: "",
          manualCost: "",
        },
      }));

      if (reloadDb) await reloadDb();
    } catch (error: any) {
      console.error("[MANUAL_OVERRIDE] Error:", error);
      alert(`❌ Error applying override:\n\n${error.message}`);
    } finally {
      setManualOverrideLoading((prev) => ({ ...prev, [matchId]: false }));
    }
  };

  return {
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
    metafieldsSet,
    setMetafieldsSet,
    metafieldsLoading,
    setMetafieldsLoading,
    manualShopifyOrder,
    setManualShopifyOrder,
    manualSupplierOrder,
    setManualSupplierOrder,
    manualMatchLoading,
    loadShopifyOrders,
    loadExchangeOrderByName,
    clearManualOverrides,
    handleManualMatch,
    createManualCostEntry,
    handleSetMetafields: async (shopifyItem: ShopifyLineItem, supplierOrderNumber: string) => {
      const lineItemId = shopifyItem.lineItemId;
      setMetafieldsLoading((prev) => ({ ...prev, [lineItemId]: true }));

      try {
        const supplierOrder = (enrichedOrders || orders).find((o: any) => o.orderNumber === supplierOrderNumber);
        const rawStockxOrder = supplierOrder;
        let resolvedSupplier = supplierOrder;

        // Fallback for synthetic Essential Hoodie (not in loaded orders)
        if (!resolvedSupplier) {
          const matchResult = matchResults.find((r) => r.shopifyItem.lineItemId === lineItemId);
          const synthetic = matchResult?.bestMatch?.supplierOrder;
          if (synthetic && synthetic.supplierOrderNumber === supplierOrderNumber) {
            resolvedSupplier = synthetic;
          }
        }

        if (!resolvedSupplier) {
          alert(
            `⚠️ Supplier order ${supplierOrderNumber} not found in loaded orders.\n\n` +
              `If this is an Essential Hoodie auto (ESS-*), the synthetic order should be used.`
          );
          return;
        }

        const stockxAwb = (resolvedSupplier as any).awb || null;
        const stockxTrackingUrl = (resolvedSupplier as any).trackingUrl || null;

        const shopifyRevenue = parseFloat(shopifyItem.totalPrice) || 0;
        let supplierCost = 0;

        if (manualCostOverrides[lineItemId]) {
          supplierCost = parseFloat(manualCostOverrides[lineItemId]) || 0;
        } else {
          const supplierCostFromB = (resolvedSupplier as any).supplierCost ?? (resolvedSupplier as any).totalTTC ?? null;
          const pricingData = pricingByOrder[supplierOrderNumber];
          const supplierCostFromPricing = pricingData?.total ?? null;

          if (supplierCostFromB != null) {
            supplierCost = supplierCostFromB;
          } else if (supplierCostFromPricing != null) {
            supplierCost = supplierCostFromPricing;
          } else {
            supplierCost = (resolvedSupplier as any).amount || resolvedSupplier.offerAmount || 0;
            const manualCostInput = prompt(
              `⚠️ No TTC pricing found for Supplier order ${supplierOrderNumber}\n\n` +
                `Offer amount: ${supplierCost.toFixed(2)} ${supplierOrder.currencyCode || "CHF"}\n\n` +
                `Please enter the TOTAL cost (including fees) or press OK to use offer amount:`,
              supplierCost.toFixed(2)
            );
            if (manualCostInput === null) return;
            const parsedCost = parseFloat(manualCostInput);
            if (!isNaN(parsedCost) && parsedCost > 0) {
              supplierCost = parsedCost;
              setManualCostOverrides((prev) => ({ ...prev, [lineItemId]: manualCostInput }));
            }
          }
        }

        const marginAmount = shopifyRevenue - supplierCost;
        const marginPercent = shopifyRevenue > 0 ? (marginAmount / shopifyRevenue) * 100 : 0;

        const confirmMessage =
          `💾 Save match to database?\n\n` +
          `Shopify Order: ${shopifyItem.orderName}\n` +
          `Product: ${shopifyItem.title}\n\n` +
          `💰 Financial Data:\n` +
          `- Shopify Revenue: ${shopifyRevenue.toFixed(2)} ${shopifyItem.currencyCode}\n` +
          `- Supplier Cost: ${supplierCost.toFixed(2)} ${shopifyItem.currencyCode}\n` +
          `- Margin: ${marginAmount.toFixed(2)} ${shopifyItem.currencyCode} (${marginPercent.toFixed(2)}%)\n\n` +
          `📦 Supplier Data:\n` +
          `- Order Number: ${supplierOrderNumber}\n` +
          `- Status: ${resolvedSupplier.statusKey || "UNKNOWN"}\n` +
          `- Estimated Delivery: ${resolvedSupplier.estimatedDeliveryDate || "N/A"}`;

        if (!confirm(confirmMessage)) return;

        try {
          const matchResult = matchResults.find((r) => r.shopifyItem.lineItemId === lineItemId);
          const bestMatch = matchResult?.bestMatch;
          const fallbackCheckoutType =
            (resolvedSupplier as any).stockxCheckoutType ||
            (rawStockxOrder as any)?.stockxCheckoutType ||
            null;
          const fallbackStates =
            (resolvedSupplier as any).stockxStates ||
            (rawStockxOrder as any)?.stockxStates ||
            null;
          const fallbackStatus =
            resolvedSupplier.statusKey ||
            (rawStockxOrder as any)?.statusKeyB ||
            (rawStockxOrder as any)?.statusB ||
            "";
          const estimatedStart =
            (resolvedSupplier as any).estimatedDeliveryDate ||
            (rawStockxOrder as any)?.estimatedDeliveryB ||
            (rawStockxOrder as any)?.estimatedDeliveryDate ||
            null;
          const estimatedEnd =
            (rawStockxOrder as any)?.latestEstimatedDeliveryB ||
            (rawStockxOrder as any)?.latestEstimatedDeliveryDate ||
            null;

          await postJson("/api/db/save-match", {
            shopifyOrderId: shopifyItem.shopifyOrderId,
            shopifyOrderName: shopifyItem.orderName,
            shopifyCreatedAt: shopifyItem.createdAt,
            shopifyLineItemId: shopifyItem.lineItemId,
            shopifyProductTitle: shopifyItem.title,
            shopifySku: shopifyItem.sku,
            shopifySizeEU: shopifyItem.sizeEU,
            shopifyTotalPrice: shopifyRevenue,
            shopifyCurrencyCode: shopifyItem.currencyCode || "CHF",
            shopifyCustomerEmail: shopifyItem.customerEmail,
            shopifyCustomerFirstName: shopifyItem.customerFirstName,
            shopifyCustomerLastName: shopifyItem.customerLastName,
            shopifyLineItemImageUrl: shopifyItem.lineItemImageUrl,
            stockxChainId: (resolvedSupplier as any).chainId || null,
            stockxOrderId: (resolvedSupplier as any).orderId || null,
            stockxOrderNumber: supplierOrderNumber,
            stockxProductName: (resolvedSupplier as any).displayName || resolvedSupplier.productTitle,
            stockxSizeEU: resolvedSupplier.size || resolvedSupplier.sizeEU,
            stockxSkuKey: resolvedSupplier.skuKey,
            stockxPurchaseDate: resolvedSupplier.purchaseDate || null,
            matchConfidence: bestMatch?.confidence || "manual",
            matchScore: bestMatch?.score || 0,
            matchType: manualOverrides[lineItemId] ? "manual" : "auto",
            matchReasons: bestMatch?.reasons || ["Manual match"],
            timeDiffHours: bestMatch?.timeDiffHours || 0,
            stockxStatus: fallbackStatus,
            stockxAwb: stockxAwb,
            stockxTrackingUrl: stockxTrackingUrl,
            stockxEstimatedDelivery: estimatedStart,
            stockxLatestEstimatedDelivery: estimatedEnd,
            stockxCheckoutType: fallbackCheckoutType,
            stockxStates: fallbackStates,
            supplierCost: supplierCost,
            marginAmount: marginAmount,
            marginPercent: marginPercent,
            manualCostOverride: manualCostOverrides[lineItemId] || null,
            shopifyMetafieldsSynced: true,
            syncTracking: true,
          });
        } catch (dbError) {
          console.error("[METAFIELDS] Database save error:", dbError);
        }

        alert(
          `✅ Match saved to database.\n\n` +
            `${shopifyItem.orderName} → ${supplierOrderNumber}`
        );
      } catch (error: any) {
        console.error("[MATCH] Error:", error);
        alert(`❌ Error saving match:\n\n${error.message}`);
      } finally {
        setMetafieldsLoading((prev) => ({ ...prev, [lineItemId]: false }));
      }
    },
    autoSetAllHighMatches: async () => {
      const highMatches = matchResults.filter((r) => r.bestMatch?.confidence === "high");
      if (highMatches.length === 0) {
        alert("⚠️ No HIGH confidence matches to set");
        return;
      }
      if (
        !confirm(
          `🚀 Auto-save ${highMatches.length} HIGH confidence matches?\n\nThis will:\n- Save all matches to database\n- No manual approval for each one\n\nContinue?`
        )
      ) {
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (const result of highMatches) {
        const shopifyItem = result.shopifyItem as ShopifyLineItem;
        const match = result.bestMatch;
        if (!match) continue;

        const supplierOrder = match.supplierOrder;
        const supplierOrderNumber = supplierOrder.supplierOrderNumber || "";
        const rawStockxOrder = (enrichedOrders || orders).find((o: any) => o.orderNumber === supplierOrderNumber);

        const shopifyRevenue = parseFloat(shopifyItem.totalPrice) || 0;
      const supplierCostFromMatch = supplierOrder.totalTTC;
        const supplierCostFromEnriched = rawStockxOrder ? (rawStockxOrder as any).supplierCost : null;
        const pricingData = supplierOrderNumber ? pricingByOrder[supplierOrderNumber] : null;
        const supplierCostFromPricing = pricingData?.total || null;
        const supplierCostOverride = manualCostOverrides[shopifyItem.lineItemId];

        const hasTtc =
          supplierCostFromMatch !== null && supplierCostFromMatch !== undefined;

        if (!hasTtc && !supplierCostOverride && !supplierCostFromEnriched && !supplierCostFromPricing) {
          console.warn(
            `[AUTO-SET] Skipping ${shopifyItem.orderName} → ${supplierOrderNumber} (no TTC pricing)`
          );
          failCount++;
          continue;
        }

        let supplierCost =
          supplierCostFromMatch ??
          supplierCostFromEnriched ??
          supplierCostFromPricing ??
          supplierOrder.offerAmount ??
          rawStockxOrder?.amount ??
          0;

        if (supplierCostOverride) {
          const parsed = parseFloat(supplierCostOverride);
          if (!isNaN(parsed)) supplierCost = parsed;
        }

        const marginAmount = shopifyRevenue - supplierCost;
        const marginPercent = shopifyRevenue > 0 ? (marginAmount / shopifyRevenue) * 100 : 0;
        const trackingUrl = supplierOrder.trackingUrl || (rawStockxOrder as any)?.trackingUrl || null;
        const awb = supplierOrder.awb || (rawStockxOrder as any)?.awb || null;
        const estimatedStart =
          supplierOrder.estimatedDeliveryDate ||
          (rawStockxOrder as any)?.estimatedDeliveryB ||
          (rawStockxOrder as any)?.estimatedDeliveryDate ||
          null;
        const estimatedEnd =
          (rawStockxOrder as any)?.latestEstimatedDeliveryB ||
          (rawStockxOrder as any)?.latestEstimatedDeliveryDate ||
          null;

        try {
          const fallbackCheckoutType =
            (supplierOrder as any).stockxCheckoutType ||
            (rawStockxOrder as any)?.stockxCheckoutType ||
            null;
          const fallbackStates =
            (supplierOrder as any).stockxStates ||
            (rawStockxOrder as any)?.stockxStates ||
            null;
          const fallbackStatus =
            supplierOrder.statusKey ||
            (rawStockxOrder as any)?.statusKeyB ||
            (rawStockxOrder as any)?.statusB ||
            "";

          await postJson("/api/db/save-match", {
            shopifyOrderId: shopifyItem.shopifyOrderId,
            shopifyOrderName: shopifyItem.orderName,
            shopifyCreatedAt: shopifyItem.createdAt,
            shopifyLineItemId: shopifyItem.lineItemId,
            shopifyProductTitle: shopifyItem.title,
            shopifySku: shopifyItem.sku || null,
            shopifySizeEU: shopifyItem.sizeEU || null,
            shopifyTotalPrice: shopifyRevenue,
            shopifyCurrencyCode: shopifyItem.currencyCode || "CHF",
            shopifyCustomerEmail: shopifyItem.customerEmail,
            shopifyCustomerFirstName: shopifyItem.customerFirstName,
            shopifyCustomerLastName: shopifyItem.customerLastName,
            shopifyLineItemImageUrl: shopifyItem.lineItemImageUrl,
            stockxChainId: supplierOrder.chainId || null,
            stockxOrderId: supplierOrder.orderId || null,
            stockxOrderNumber: supplierOrderNumber,
            stockxProductName: supplierOrder.productName || supplierOrder.productTitle || "",
            stockxSizeEU: supplierOrder.sizeEU || null,
            stockxSkuKey: supplierOrder.skuKey || null,
            stockxPurchaseDate: supplierOrder.purchaseDate || null,
            matchConfidence: match.confidence,
            matchScore: match.score,
            matchType: "auto",
            matchReasons: match.reasons,
            timeDiffHours: match.timeDiffHours,
            stockxStatus: fallbackStatus,
            stockxAwb: awb,
            stockxTrackingUrl: trackingUrl,
            stockxEstimatedDelivery: estimatedStart,
            stockxLatestEstimatedDelivery: estimatedEnd,
            stockxCheckoutType: fallbackCheckoutType,
            stockxStates: fallbackStates,
            supplierCost: supplierCost,
            marginAmount: marginAmount,
            marginPercent: marginPercent,
            manualCostOverride: supplierCostOverride || null,
            shopifyMetafieldsSynced: true,
          updateTrackingOnly: true,
            syncTracking: true,
          });

          successCount++;
          await new Promise((r) => setTimeout(r, 300));
        } catch (err) {
          console.error("[AUTO-SET] error", err);
          failCount++;
        }
      }

      alert(
        `✅ Auto-Set Complete!\n\n` +
          `Success: ${successCount}/${highMatches.length}\n` +
          `Failed: ${failCount}\n\n` +
          `All successful matches are now synced to Shopify and saved to database.`
      );
    },
    refreshDbMatchesTracking,
    manualOverrideExpanded,
    setManualOverrideExpanded,
    manualOverrideData,
    setManualOverrideData,
    manualOverrideLoading,
    applyManualOverride,
  };
}

