-- checkout_completed du pixel maison par jour (Europe/Zurich ; occurred_at = timestamptz ou timestamp ? voir ads_20_types.sql)
select (occurred_at at time zone 'Europe/Zurich')::date::text d,
 count(*) filter (where event_name='checkout_completed') cc_events,
 count(distinct order_id) filter (where event_name='checkout_completed') cc_orders,
 count(*) filter (where event_name='checkout_completed' and consent_marketing) cc_consent_mkt,
 count(*) filter (where event_name='checkout_completed' and (gclid is not null or gbraid is not null or wbraid is not null)) cc_clickid,
 count(*) filter (where event_name='page_viewed') pv, count(*) filter (where event_name='product_viewed') pdp, count(*) filter (where event_name='product_added_to_cart') atc, count(*) filter (where event_name='checkout_started') chk,
 count(*) filter (where device_type='bot' or webdriver) bots
from funnel_events group by 1 order by 1
