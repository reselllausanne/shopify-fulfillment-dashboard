-- Profil de couverture des tables clés (lecture seule)
select 'ShopifyOrder' t, count(*) n, min("createdAt")::date mn, max("createdAt")::date mx, max("syncedAt")::date lastsync from "ShopifyOrder"
union all select 'OrderMatch', count(*), min("shopifyCreatedAt")::date, max("shopifyCreatedAt")::date, max("updatedAt")::date from "OrderMatch"
union all select 'ShopifyPayout', count(*), min("issuedAt")::date, max("issuedAt")::date, max("updatedAt")::date from "ShopifyPayout"
union all select 'DailyAdSpend', count(*), min(date)::date, max(date)::date, max("updatedAt")::date from "DailyAdSpend"
union all select 'ads_campaign_daily', count(*), min(date)::date, max(date)::date, null from ads_campaign_daily
union all select 'ads_product_daily', count(*), min(date)::date, max(date)::date, null from ads_product_daily
union all select 'funnel_events', count(*), min(created_at)::date, max(created_at)::date, null from funnel_events
union all select 'ManualFinanceEvent', count(*), min("eventDate")::date, max("eventDate")::date, null from "ManualFinanceEvent"
union all select 'OperatingEvent', count(*), min("eventDate")::date, max("eventDate")::date, null from "OperatingEvent"
union all select 'ExpectedCashEvent', count(*), min("expectedDate")::date, max("expectedDate")::date, null from "ExpectedCashEvent"
union all select 'BankTransaction', count(*), min("bookingDate")::date, max("bookingDate")::date, null from "BankTransaction"
union all select 'BankBalanceSnapshot', count(*), min("snapshotDate")::date, max("snapshotDate")::date, null from "BankBalanceSnapshot"
union all select 'CashLedgerDaily', count(*), min(date)::date, max(date)::date, null from "CashLedgerDaily"
union all select 'MarketplaceRemittance', count(*), min("paidAt")::date, max("paidAt")::date, null from "MarketplaceRemittance"
union all select 'RecurringExpense', count(*), min("startDate")::date, max("startDate")::date, null from "RecurringExpense"
union all select 'MonthlyVariableCosts', count(*), min(make_date(year,month,1)), max(make_date(year,month,1)), null from "MonthlyVariableCosts"
union all select 'PersonalExpense', count(*), min(date)::date, max(date)::date, null from "PersonalExpense"
union all select 'GalaxusOrder', count(*), min("createdAt")::date, max("createdAt")::date, null from "GalaxusOrder"
union all select 'DecathlonOrder', count(*), min("createdAt")::date, max("createdAt")::date, null from "DecathlonOrder"
union all select 'StxPurchaseUnit', count(*), min("createdAt")::date, max("createdAt")::date, null from "StxPurchaseUnit"
union all select 'marketplace_returns', count(*), min("createdAt")::date, max("createdAt")::date, null from marketplace_returns
union all select 'LocalStockLot', count(*), min("enteredAt")::date, max("enteredAt")::date, null from "LocalStockLot"
union all select 'ShopifyFulfillmentRecord', count(*), min("createdAt")::date, max("createdAt")::date, null from "ShopifyFulfillmentRecord"
