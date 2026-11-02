-- campagne x modèle, 90 jours (chevauchements : un modèle servi par plusieurs campagnes)
select campaign_id, max(campaign_name) cname, shopify_product_id, sum(impressions) impr, sum(clicks) clicks, round(sum(cost_micros)/1e6,2) cost, round(sum(conversions)::numeric,2) conv, round(sum(conversion_value)::numeric,2) val
from ads_product_daily where date>='2026-08-02' and shopify_product_id is not null group by 1,3
