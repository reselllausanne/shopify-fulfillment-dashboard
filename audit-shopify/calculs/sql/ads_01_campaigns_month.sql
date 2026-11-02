select to_char(date,'YYYY-MM') as month, campaign_id, max(campaign_name) as name, max(channel_type) as channel,
 round(sum(cost_micros)/1e6) as cost_chf, sum(clicks) as clicks, sum(impressions) as impr,
 round(sum(conversions)::numeric,1) as conv, round(sum(conversion_value)::numeric) as conv_value
from ads_campaign_daily group by 1,2 order by 1,5 desc
