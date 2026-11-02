-- top 3000 offres (fr) par coût sur 90 j (2026-08-02..2026-11-01) : base d'un échantillon pondéré par la dépense pour le contrôle feed/prix
select offer_id, max(shopify_product_id) shopify_product_id, max(left(title,90)) title, max(brand) brand, max(custom_attr1) a1,
 sum(impressions) impr, sum(clicks) clicks, round(sum(cost_micros)/1e6,2) cost, round(sum(conversions)::numeric,2) conv, round(sum(conversion_value)::numeric,2) val,
 string_agg(distinct campaign_name, ' + ') camps
from ads_product_daily where date>='2026-08-02' and language_code='fr' group by 1 order by sum(cost_micros) desc limit 3000
