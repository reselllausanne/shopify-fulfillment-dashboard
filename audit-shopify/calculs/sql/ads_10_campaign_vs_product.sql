-- ecart cout campagne (API) vs somme shopping_performance_view par mois
with p as (select to_char(date,'YYYY-MM') m, sum(cost_micros)/1e6 pc, sum(conversion_value) pv from ads_product_daily group by 1),
 c as (select to_char(date,'YYYY-MM') m, sum(cost_micros)/1e6 cc, sum(conversion_value) cv from ads_campaign_daily where channel_type in ('PERFORMANCE_MAX','SHOPPING') group by 1)
select c.m, round(cc) camp_cost, round(pc) prod_cost, round((pc/nullif(cc,0))::numeric,3) cost_ratio, round(cv::numeric) camp_val, round(pv::numeric) prod_val from c left join p using(m) order by 1
