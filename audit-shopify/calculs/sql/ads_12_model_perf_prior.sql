-- historique 2026-02-18..2026-08-01 par modèle (pour "testé auparavant")
select shopify_product_id, sum(clicks) clicks, round(sum(cost_micros)/1e6,2) cost, round(sum(conversions)::numeric,2) conv, round(sum(conversion_value)::numeric,2) val
from ads_product_daily where date>='2025-07-01' and date<'2026-08-02' and shopify_product_id is not null group by 1
