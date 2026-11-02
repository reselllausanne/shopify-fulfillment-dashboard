-- part des sessions (hors bots) avec consentement marketing ; part des landing avec gclid ; utm
select count(distinct session_id) sessions, count(distinct session_id) filter (where consent_marketing) sessions_consent_mkt,
 count(distinct session_id) filter (where gclid is not null) sessions_gclid,
 count(distinct session_id) filter (where utm_medium='cpc') sessions_utm_cpc,
 count(distinct session_id) filter (where utm_source='google') sessions_utm_google
from funnel_events where device_type is distinct from 'bot' and coalesce(webdriver,false)=false
