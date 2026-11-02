select table_name, string_agg(column_name||':'||data_type, ', ' order by ordinal_position) cols from information_schema.columns
where table_name in ('LocalStockLot','StxPurchaseUnit','StxPurchase','LocalStockMovement','marketplace_returns') group by 1
