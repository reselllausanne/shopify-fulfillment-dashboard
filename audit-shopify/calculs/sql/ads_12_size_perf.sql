-- taille : offer_id = shopify_CH_<product>_<variant>; titre se termine par ", <taille>"
select regexp_replace(title, '^.*, ', '') size_raw, count(distinct offer_id) offers, sum(impressions) impr, sum(clicks) clicks, round(sum(cost_micros)/1e6,2) cost, round(sum(conversions)::numeric,2) conv, round(sum(conversion_value)::numeric,2) val
from ads_product_daily where date>='2026-08-02' and language_code='fr' and custom_attr0='sneakers' group by 1 having sum(cost_micros)>0
