-- (horodatages naïfs UTC exportés en texte pour éviter toute conversion) 1 ligne par commande Shopify 2026 : délais commande -> achat -> arrivée entrepôt -> expédition (timestamps naïfs UTC)
with om as (
  select "shopifyOrderId" oid,
    count(*) n_lines,
    count(*) filter (where "supplierSource"='STOCKX' and "stockxStatus" not in ('ESSENTIAL_STOCK')) n_stx_lines,
    count(*) filter (where "supplierSource"='STOCKX' and "stockxOrderNumber" is not null) n_stx_linked,
    count(*) filter (where upper(coalesce("stockxStatus",'')) like '%CANCEL%' or "stockxStatus" in ('canceled_by_seller')) n_stx_cancel,
    count(*) filter (where "returnAppliedAt" is not null) n_return_lines,
    min("stockxPurchaseDate") min_buy, max("stockxPurchaseDate") max_buy,
    max(coalesce("stockxLatestEstimatedDelivery","stockxEstimatedDelivery")) eta_max,
    bool_or("stockxCheckoutType" like 'EXPRESS%') has_express,
    bool_or("supplierSource" in ('LOCAL') or "stockxStatus" in ('PHYSICAL_STOCK','ESSENTIAL_STOCK')) has_stock_line
  from "OrderMatch" group by 1),
f as (
  select "shopifyOrderId" oid, min("createdAt") filter (where lower(status)='success') ship_at, min("stockxDeliveredAt") stx_del,
    count(*) filter (where lower(status)='cancelled') n_cancelled_fulfil, count(*) n_fulfil
  from "ShopifyFulfillmentRecord" group by 1)
select o."orderName", o."createdAt"::text created_at, o."financialStatus", o."cancelledAt"::text cancelled_at, o."totalSalesChf", o."refundedAmountChf",
  o."paymentGatewayNames"[1] gateway,
  om.n_lines, om.n_stx_lines, om.n_stx_linked, om.n_stx_cancel, om.n_return_lines, om.has_express, om.has_stock_line, om.eta_max::text eta_max,
  om.min_buy::text min_buy, om.max_buy::text max_buy, f.ship_at::text ship_at, f.stx_del::text stx_del,
  round((extract(epoch from (om.min_buy - o."createdAt"))/3600)::numeric,1) h_order_to_buy,
  round((extract(epoch from (f.stx_del - om.max_buy))/86400)::numeric,2) d_buy_to_warehouse,
  round((extract(epoch from (f.ship_at - o."createdAt"))/86400)::numeric,2) d_order_to_ship,
  round((extract(epoch from (f.ship_at - om.max_buy))/86400)::numeric,2) d_buy_to_ship
from "ShopifyOrder" o left join om on om.oid=o."shopifyOrderId" left join f on f.oid=o."shopifyOrderId"
where o."createdAt" >= '2026-01-01'
order by o."createdAt"
