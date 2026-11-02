select language_code, feed_label, status, availability, count(*) n, count(distinct shopify_product_id) models,
 count(*) filter (where cardinality(targeted_campaign_ids)=0 or targeted_campaign_ids is null) not_targeted,
 count(*) filter (where cardinality(targeted_campaign_ids)>1) multi_targeted
from ads_shopping_product_current where is_current group by 1,2,3,4 order by 5 desc
