select table_name, string_agg(column_name||':'||data_type, ', ' order by ordinal_position) cols
from information_schema.columns where table_schema='public' and table_name in ('OrderMatch','StockXStatusEvent','OrderStatusEvent','ShopifyOrder','StockxOrderAlert','ShopifyFulfillmentRecord','OperatingEvent')
group by 1
