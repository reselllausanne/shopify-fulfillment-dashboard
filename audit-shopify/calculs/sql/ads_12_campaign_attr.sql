-- campagne x label (attr0 catégorie, attr1 marque, attr3 routage) 90 jours
select campaign_id, max(campaign_name) cname, coalesce(custom_attr0,'') a0, coalesce(custom_attr1,'') a1, coalesce(custom_attr3,'') a3, count(distinct shopify_product_id) models, sum(impressions) impr, sum(clicks) clicks, round(sum(cost_micros)/1e6,2) cost, round(sum(conversions)::numeric,2) conv, round(sum(conversion_value)::numeric,2) val
from ads_product_daily where date>='2026-08-02' group by 1,3,4,5
