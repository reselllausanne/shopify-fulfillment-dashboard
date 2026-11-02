select lifecycle_status, coalesce(destination,'-') destination, coalesce(exit_reason,'-') exit_reason, count(*) models,
 sum(impressions) impr, sum(clicks) clicks, round(sum(cost_micros)/1e6,1) cost, round(sum(conversions)::numeric,1) conv, round(sum(conversion_value)::numeric,1) val,
 sum(lt_clicks) lt_clicks, round(sum(lt_cost_micros)/1e6,1) lt_cost, round(sum(lt_conversions)::numeric,1) lt_conv, round(sum(lt_conversion_value)::numeric,1) lt_val,
 count(*) filter (where lt_conversions>0) models_with_conv, count(*) filter (where lt_clicks>=30 and lt_conversions=0) models_30clicks_0conv
from ads_explorer_batch_models group by 1,2,3 order by 4 desc
