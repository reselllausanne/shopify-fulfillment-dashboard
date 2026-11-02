select coalesce(array_to_string(targeted_campaign_names,' + '),'(aucune)') camps, count(*) offers, count(distinct shopify_product_id) models,
 count(*) filter (where availability='IN_STOCK') in_stock
from ads_shopping_product_current where is_current and language_code='fr' group by 1 order by 2 desc
