select column_name, data_type from information_schema.columns where table_name='funnel_events' and column_name in ('occurred_at','created_at')
