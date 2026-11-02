-- Sessions mobiles/desktop humaines avec checkout_started : taux de finalisation selon présence d'une alerte de checkout (pixel maison, 2026-10-16 -> 2026-11-02)
with s as (
 select session_id, coalesce(max(device_type) filter (where device_type<>'bot'),'bot') device, bool_or(webdriver) wd,
   max((event_name='checkout_started')::int) cs, max((event_name='checkout_completed')::int) cc, max((event_name='alert_displayed')::int) alert
 from funnel_events where occurred_at >= '2026-10-16' and session_id is not null group by 1)
select device, alert, count(*) sessions, sum(cc) completed, round(100.0*sum(cc)/count(*),1) pct_completed
from s where not coalesce(wd,false) and cs=1 and device in ('mobile','desktop') group by 1,2 order by 1,2
