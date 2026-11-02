select event_name, device_type, count(*) n, count(distinct session_id) sessions, count(distinct client_id) clients, min(occurred_at)::text mn, max(occurred_at)::text mx
from funnel_events group by 1,2 order by 1,2
