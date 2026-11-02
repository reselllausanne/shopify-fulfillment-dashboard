select snapshot_date::text as d, campaign_id, campaign_name, status, channel_type, round(budget_micros/1e6,2) as budget_chf, bidding_strategy, target_roas, feed_label
from ads_campaign_settings_daily order by campaign_id, snapshot_date
