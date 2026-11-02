select table_name, column_name, data_type from information_schema.columns
where table_schema='public' and (table_name like 'ads\_%' or table_name in ('DailyAdSpend','funnel_events','GalaxusFeedRun','ChannelListingState','InventorySyncRun'))
order by table_name, ordinal_position
