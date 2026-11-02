-- Funnel par session (pixel maison, 2026-10-15 -> 2026-11-02), hors bots (device_type='bot' ou webdriver)
with s as (
 select session_id, coalesce(max(device_type) filter (where device_type<>'bot'),'bot') device,
   bool_or(webdriver) wd,
   max((event_name='page_viewed')::int) pv, max((event_name='collection_viewed')::int) coll, max((event_name='search_submitted')::int) srch,
   max((event_name='product_viewed')::int) prod, max((event_name='variant_selected')::int) var,
   max((event_name in ('product_added_to_cart','cart_item_added'))::int) atc, max((event_name='cart_viewed')::int) cartv,
   max((event_name='checkout_started')::int) cs, max((event_name='checkout_contact_info_submitted')::int) ci,
   max((event_name='checkout_shipping_info_submitted')::int) si, max((event_name='payment_info_submitted')::int) pi,
   max((event_name='checkout_completed')::int) cc,
   max((event_name='alert_displayed')::int) alert
 from funnel_events where occurred_at >= '2026-10-16' and session_id is not null group by 1)
select device, count(*) sessions, sum(pv) page_viewed, sum(coll) collection, sum(srch) search, sum(prod) product_viewed, sum(var) variant_selected, sum(atc) added_to_cart,
 sum(cartv) cart_viewed, sum(cs) checkout_started, sum(ci) contact_info, sum(si) shipping_info, sum(pi) payment_info, sum(cc) checkout_completed, sum(alert) with_checkout_alert
from s where not coalesce(wd,false) group by 1 order by sessions desc
