-- Lignes OrderMatch (sans PII) ; dates en UTC explicite (timestamps naïfs stockés en UTC par Prisma)
select id, "shopifyOrderId", "shopifyOrderName", "shopifyLineItemId", "shopifyProductTitle", "shopifySku", "shopifySizeEU",
 "shopifyTotalPrice", "shopifyCurrencyCode", "stockxOrderNumber", "stockxStatus", "matchConfidence", "matchType", "supplierSource", "stockxCheckoutType",
 "supplierCost", "marginAmount", "marginPercent", "manualCostOverride", "manualCaseStatus", "manualRevenueAdjustment", left("manualNote",120) manual_note,
 "shopifyCreatedAt"::text shopify_created_utc, "stockxPurchaseDate"::text stockx_purchase_utc, "stockxEstimatedDelivery"::text stx_eta, "stockxLatestEstimatedDelivery"::text stx_latest_eta,
 "returnAppliedAt"::text return_applied, "returnFeeAmountChf", "returnFeePercent", "returnReason"::text return_reason, "returnedStockValueChf", "localStockLotId", "createdAt"::text created_utc
from "OrderMatch"
