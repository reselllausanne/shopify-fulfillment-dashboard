select to_char(date,'YYYY-MM') m,
 count(*) rows_n, count(distinct offer_id) offers, count(distinct shopify_product_id) models,
 round(sum(cost_micros)/1e6) cost, round(sum(cost_micros) filter (where shopify_product_id is null)/1e6) cost_unmapped,
 round(sum(conversion_value)::numeric) val, round(sum(conversion_value) filter (where shopify_product_id is null)::numeric) val_unmapped,
 sum(clicks) clicks, round(sum(conversions)::numeric,1) conv,
 count(*) filter (where attribute_conflict) conflicts
from ads_product_daily group by 1 order by 1
