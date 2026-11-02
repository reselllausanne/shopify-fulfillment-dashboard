select campaign_id, max(campaign_name) as name, max(channel_type) as channel, max(campaign_status) as last_status,
 min(date) as d0, max(date) as d1, count(*) as days,
 round(sum(cost_micros)/1e6) as cost_chf, sum(clicks) as clicks, sum(impressions) as impr,
 round(sum(conversions)::numeric,1) as conv, round(sum(conversion_value)::numeric) as conv_value,
 round((sum(conversion_value)/nullif(sum(cost_micros)/1e6,0))::numeric,2) as roas
from ads_campaign_daily group by 1 order by 8 desc
