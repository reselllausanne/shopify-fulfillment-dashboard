select 'unit' src, "stockxOrderNumber" n, "stockxOrderId" oid, "stockxSettledAmount" settled, "createdAt"::text c from "StxPurchaseUnit" where "stockxOrderNumber" is not null or "stockxOrderId" is not null
union all select 'galmatch', "stockxOrderNumber", "stockxOrderId", null, "createdAt"::text from "GalaxusStockxMatch"
