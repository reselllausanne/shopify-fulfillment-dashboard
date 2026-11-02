select 'LocalStockLot' t, count(*) n, min("createdAt")::text mn, max("createdAt")::text mx from "LocalStockLot"
union all select 'StxPurchaseUnit', count(*), min("createdAt")::text, max("createdAt")::text from "StxPurchaseUnit"
