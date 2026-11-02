-- performance par modèle Shopify (shopify_product_id) sur 90 jours (2026-08-02..2026-11-01) ; date = jour du compte Google Ads (Europe/Zurich)
select shopify_product_id, max(brand) brand, max(custom_attr0) a0, max(custom_attr1) a1, max(custom_attr2) a2, max(left(title,70)) title,
 count(distinct offer_id) offers_seen, sum(impressions) impr, sum(clicks) clicks,
 round(sum(cost_micros)/1e6,2) cost, round(sum(conversions)::numeric,2) conv, round(sum(conversion_value)::numeric,2) val
from ads_product_daily where date>='2026-08-02' and shopify_product_id is not null group by 1
