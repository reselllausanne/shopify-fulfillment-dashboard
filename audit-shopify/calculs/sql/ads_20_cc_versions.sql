select pixel_version, event_name, count(*) n, count(*) filter (where client_id is null) no_client, count(*) filter (where session_id is null) no_session, count(*) filter (where consent_marketing) consent_mkt, min(occurred_at)::text first, max(occurred_at)::text last
from funnel_events where event_name='checkout_completed' group by 1,2 order by 3 desc
