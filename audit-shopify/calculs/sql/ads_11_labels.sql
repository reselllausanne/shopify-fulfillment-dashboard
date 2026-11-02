select 'attr0' a, custom_attr0 v, count(*) n, count(distinct shopify_product_id) models from ads_shopping_product_current where is_current group by 2
union all select 'attr1', custom_attr1, count(*), count(distinct shopify_product_id) from ads_shopping_product_current where is_current group by 2
union all select 'attr2', custom_attr2, count(*), count(distinct shopify_product_id) from ads_shopping_product_current where is_current group by 2
union all select 'attr3', custom_attr3, count(*), count(distinct shopify_product_id) from ads_shopping_product_current where is_current group by 2
union all select 'attr4', custom_attr4, count(*), count(distinct shopify_product_id) from ads_shopping_product_current where is_current group by 2
order by 1, 3 desc
