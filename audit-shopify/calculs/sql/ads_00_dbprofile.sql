select 'ads_campaign_settings_daily' t, count(*) n, min(snapshot_date)::text d0, max(snapshot_date)::text d1 from ads_campaign_settings_daily
union all select 'ads_inventory_funnel_daily', count(*), min(date)::text, max(date)::text from ads_inventory_funnel_daily
union all select 'ads_product_daily', count(*), min(date)::text, max(date)::text from ads_product_daily
union all select 'ads_campaign_daily', count(*), min(date)::text, max(date)::text from ads_campaign_daily
union all select 'ads_shopping_product_current(is_current)', count(*), min(last_seen_at)::text, max(last_seen_at)::text from ads_shopping_product_current where is_current
union all select 'ads_shopping_product_current(all)', count(*), min(last_seen_at)::text, max(last_seen_at)::text from ads_shopping_product_current
union all select 'ads_explorer_batches', count(*), min(created_at)::text, max(created_at)::text from ads_explorer_batches
union all select 'ads_explorer_batch_models', count(*), min(created_at)::text, max(created_at)::text from ads_explorer_batch_models
union all select 'ads_explorer_offer_writes', count(*), min(created_at)::text, max(created_at)::text from ads_explorer_offer_writes
union all select 'ads_explorer_campaigns', count(*), min(created_at)::text, max(created_at)::text from ads_explorer_campaigns
union all select 'ads_explorer_product_age', count(*), min(created_at)::text, max(created_at)::text from ads_explorer_product_age
union all select 'ads_explorer_listing_backups', count(*), min(created_at)::text, max(created_at)::text from ads_explorer_listing_backups
union all select 'ads_sync_runs', count(*), min(started_at)::text, max(started_at)::text from ads_sync_runs
union all select 'DailyAdSpend', count(*), min(date)::text, max(date)::text from "DailyAdSpend"
