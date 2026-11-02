-- sessions utm cpc -> checkout_completed
with s as (select session_id, bool_or(utm_medium='cpc') cpc, bool_or(gclid is not null) gcl, bool_or(event_name='checkout_completed') bought, bool_or(event_name='checkout_started') chk, bool_or(event_name='product_added_to_cart') atc, max(device_type) dev
 from funnel_events where device_type is distinct from 'bot' and coalesce(webdriver,false)=false group by 1)
select cpc, gcl, count(*) sessions, count(*) filter (where atc) atc, count(*) filter (where chk) chk, count(*) filter (where bought) bought from s group by 1,2 order by 1,2
