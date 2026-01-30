import React from "react";
import type { MatchResult, ShopifyLineItem } from "@/app/utils/matching";
import type { PricingResult, OrderNode } from "@/app/types";

type Props = {
  matchResults: MatchResult[];
  loadShopifyOrders: (sinceDays?: number) => Promise<void>;
  loadingShopify: boolean;
  orders: OrderNode[] | any[];
  enrichedOrders: OrderNode[] | any[] | null;
  pricingByOrder: Record<string, PricingResult | null>;
  pricingLoading: Record<string, boolean>;
  fetchPricingForOrder: (order: OrderNode) => Promise<void>;
  manualOverrides: Record<string, { supplierOrderNumber: string; method: string }>;
  setManualOverrides: (v: Record<string, { supplierOrderNumber: string; method: string }>) => void;
  confirmedMatches: Record<string, string>;
  setConfirmedMatches: (v: Record<string, string>) => void;
  manualCostOverrides: Record<string, string>;
  setManualCostOverrides: (v: Record<string, string>) => void;
  createManualCostEntry: (shopifyItem: ShopifyLineItem) => Promise<void>;
  autoSetAllHighMatches: () => Promise<void>;
  handleSetMetafields: (shopifyItem: ShopifyLineItem, supplierOrderNumber: string) => Promise<void>;
  openManualEntryModal: (shopifyItem: ShopifyLineItem) => void;
};

export default function OrderMatchingSection({
  matchResults,
  loadShopifyOrders,
  loadingShopify,
  orders,
  enrichedOrders,
  pricingByOrder,
  pricingLoading,
  fetchPricingForOrder,
  manualOverrides,
  setManualOverrides,
  confirmedMatches,
  setConfirmedMatches,
  manualCostOverrides,
  setManualCostOverrides,
  createManualCostEntry,
  autoSetAllHighMatches,
  handleSetMetafields,
  openManualEntryModal,
}: Props) {
  return (
    <div className="bg-white rounded-lg shadow p-6 mt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold">Order Matching (Shopify ↔ Supplier)</h2>
          <p className="text-sm text-gray-500 mt-1">Manual matching interface (for review and overrides)</p>
        </div>
        <button
          onClick={() => loadShopifyOrders(30)}
          disabled={loadingShopify || orders.length === 0}
          className="px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loadingShopify ? "Loading..." : "Load Shopify (100 recent unfulfilled)"}
        </button>
      </div>

      {matchResults.length === 0 ? (
        <p className="text-gray-500 text-center py-8">
          Click "Load Shopify Orders" to fetch recent unfulfilled orders and match with Supplier
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-gray-600">
                {matchResults.length} Shopify line items (unfulfilled) •{" "}
                {matchResults.filter((r: any) => r.bestMatch).length} matches found
              </p>
              <p className="text-xs text-gray-500 mt-1">
                HIGH: {matchResults.filter((r: any) => r.bestMatch?.confidence === "high").length} • MEDIUM:{" "}
                {matchResults.filter((r: any) => r.bestMatch?.confidence === "medium").length} • LOW:{" "}
                {matchResults.filter((r: any) => r.bestMatch?.confidence === "low").length}
              </p>
            </div>
            <button
              onClick={autoSetAllHighMatches}
              disabled={matchResults.filter((r: any) => r.bestMatch?.confidence === "high").length === 0}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold shadow"
            >
              🚀 Auto-Set All HIGH Matches ({matchResults.filter((r: any) => r.bestMatch?.confidence === "high").length})
            </button>
          </div>

          {matchResults.map((result: MatchResult, idx: number) => {
            const shopify = result.shopifyItem;
            const match = result.bestMatch;
            const isLiquidation = /%/.test(shopify.title);
            const isEssentialHoodie = false; // Already handled upstream; keep UI minimal here

            return (
              <div
                key={`${shopify.lineItemId}-${idx}`}
                className={`border rounded-lg p-4 ${
                  isLiquidation
                    ? "border-purple-300 bg-purple-50"
                    : isEssentialHoodie
                    ? "border-indigo-300 bg-indigo-50"
                    : match?.overThreshold
                    ? "border-yellow-300 bg-yellow-50"
                    : match?.confidence === "high"
                    ? "border-green-300 bg-green-50"
                    : match?.confidence === "medium"
                    ? "border-blue-300 bg-blue-50"
                    : "border-gray-300"
                }`}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold text-sm text-gray-700 mb-2">📦 Shopify Order: {shopify.orderName}</h3>
                    <div className="text-xs space-y-1">
                      <p>
                        <span className="font-medium">Created:</span>{" "}
                        {new Date(shopify.createdAt).toLocaleString("fr-CH")}
                      </p>
                      <p>
                        <span className="font-medium">Status:</span>{" "}
                        <span
                          className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                            shopify.displayFinancialStatus === "PAID"
                              ? "bg-green-100 text-green-800"
                              : shopify.displayFinancialStatus === "PENDING"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {shopify.displayFinancialStatus}
                        </span>
                        {shopify.displayFulfillmentStatus && (
                          <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-800">
                            {shopify.displayFulfillmentStatus}
                          </span>
                        )}
                      </p>
                      {shopify.customerName && (
                        <p>
                          <span className="font-medium">Customer:</span> {shopify.customerName}
                        </p>
                      )}
                      <p>
                        <span className="font-medium">Product:</span> {shopify.title}
                      </p>
                      <p>
                        <span className="font-medium">SKU:</span> {shopify.sku || "—"}
                      </p>
                      <p>
                        <span className="font-medium">Size:</span> {shopify.sizeEU || shopify.variantTitle || "—"}
                      </p>
                      <p>
                        <span className="font-medium">Price:</span> {shopify.currencyCode} {shopify.price}
                        {shopify.quantity > 1 && (
                          <span className="text-gray-500"> (×{shopify.quantity})</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div>
                    {match ? (
                      <>
                        <h3 className="font-semibold text-sm text-gray-700 mb-2">🎯 Suggested Supplier Match</h3>
                        <div className="text-xs space-y-1">
                          <p>
                            <span className="font-medium">Order:</span>{" "}
                            <input
                              type="text"
                              value={confirmedMatches[shopify.lineItemId] || match.supplierOrder.supplierOrderNumber}
                              onChange={(e) =>
                                setConfirmedMatches({
                                  ...confirmedMatches,
                                  [shopify.lineItemId]: e.target.value,
                                })
                              }
                              className="inline-block w-32 px-1 py-0.5 border rounded text-xs font-mono"
                            />
                          </p>
                          <p>
                            <span className="font-medium">Purchase:</span>{" "}
                            {new Date(match.supplierOrder.purchaseDate).toLocaleString("fr-CH")}
                          </p>
                          <p>
                            <span className="font-medium">Product:</span> {match.supplierOrder.productTitle}
                          </p>
                          <p>
                            <span className="font-medium">SKU:</span> {match.supplierOrder.skuKey}
                          </p>
                          <p>
                            <span className="font-medium">Size:</span> {match.supplierOrder.sizeEU || "—"}
                          </p>
                          <p>
                            <span className="font-medium">Offer:</span> CHF{" "}
                            {match.supplierOrder.offerAmount?.toFixed(2) || "—"}
                            {match.supplierOrder.totalTTC && (
                              <span className="text-green-700 font-semibold ml-2">
                                (Total: CHF {match.supplierOrder.totalTTC.toFixed(2)})
                              </span>
                            )}
                          </p>
                          <p>
                            <span className="font-medium">Status:</span> {match.supplierOrder.statusKey || "—"}
                          </p>
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <div className="flex items-center gap-2 text-xs">
                            <span
                              className={`px-2 py-1 rounded font-semibold ${
                                match.confidence === "high"
                                  ? "bg-green-200 text-green-800"
                                  : match.confidence === "medium"
                                  ? "bg-blue-200 text-blue-800"
                                  : "bg-gray-200 text-gray-800"
                              }`}
                            >
                              {match.confidence.toUpperCase()} (Score: {match.score})
                            </span>
                            <span className="text-gray-600">{match.timeDiffHours.toFixed(1)}h apart</span>
                          </div>
                          <div className="mt-1 text-xs text-gray-600">{match.reasons.join(" • ")}</div>
                        </div>


                        <div className="mt-3 pt-2 border-t border-gray-200">
                          {(() => {
                            const shopifyRevenue = parseFloat(shopify.totalPrice) || 0;
                            const supplierOrderNum =
                              confirmedMatches[shopify.lineItemId] || match.supplierOrder.supplierOrderNumber;
                            const supplierCostFromMatch = match.supplierOrder.totalTTC;
                            const pricingData = pricingByOrder[supplierOrderNum];
                            const supplierCostFromPricing = pricingData?.total || null;
                            const autoTTC = supplierCostFromMatch ?? supplierCostFromPricing;
                            const manualCost = manualCostOverrides[shopify.lineItemId];
                            const displayCost = manualCost
                              ? parseFloat(manualCost)
                              : autoTTC || match.supplierOrder.offerAmount || 0;
                            const marginAmount = shopifyRevenue - displayCost;
                            const marginPercent = shopifyRevenue > 0 ? (marginAmount / shopifyRevenue) * 100 : 0;

                            return (
                              <div className="text-xs space-y-1 mb-2 p-2 bg-purple-50 rounded">
                                <p className="font-semibold text-purple-800">💰 Financial Preview:</p>
                                <p>
                                  <span className="font-medium">Shopify Revenue:</span> {shopify.currencyCode}{" "}
                                  {shopifyRevenue.toFixed(2)}
                                </p>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">Supplier Cost:</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={
                                      manualCost ||
                                      (autoTTC ? autoTTC.toFixed(2) : (match.supplierOrder.offerAmount || 0).toFixed(2))
                                    }
                                    onChange={(e) =>
                                      setManualCostOverrides({
                                        ...manualCostOverrides,
                                        [shopify.lineItemId]: e.target.value,
                                      })
                                    }
                                    className="px-2 py-0.5 border rounded text-xs w-20 font-mono"
                                    placeholder="Cost"
                                  />
                                  {!autoTTC && <span className="text-orange-600 text-xs">⚠️ No TTC</span>}
                                  {manualCost && <span className="text-blue-600 text-xs">✏️ Manual</span>}
                                </div>
                                <p className={`font-semibold ${marginAmount >= 0 ? "text-green-700" : "text-red-700"}`}>
                                  Margin: {shopify.currencyCode} {marginAmount.toFixed(2)} ({marginPercent.toFixed(2)}
                                  %)
                                </p>
                              </div>
                            );
                          })()}
                        </div>

                        <div className="mt-2">
                          <button
                            onClick={() =>
                              handleSetMetafields(
                                shopify,
                                confirmedMatches[shopify.lineItemId] || match.supplierOrder.supplierOrderNumber
                              )
                            }
                            className="w-full px-3 py-2 bg-purple-600 text-white text-sm font-medium rounded hover:bg-purple-700"
                          >
                            📝 Set Metafields on Shopify
                          </button>
                          <button
                            onClick={() => openManualEntryModal(shopify)}
                            className="mt-2 w-full px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
                          >
                            ✏️ Manual Entry Anyway
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="text-gray-500 text-center py-4">
                        <p className="text-sm">No match found</p>
                        <p className="text-xs mt-1">Manual selection required</p>
                        <button
                          onClick={() => openManualEntryModal(shopify)}
                          className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
                        >
                          📝 Create Manual Entry (Full)
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

