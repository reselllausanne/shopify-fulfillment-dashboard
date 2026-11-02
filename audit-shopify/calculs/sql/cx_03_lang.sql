-- Langue (locale pixel) des sessions humaines + région (préfixe NPA) des commandes finalisées, pixel maison 2026-10-16 -> 2026-11-02
with s as (select session_id, max(locale) loc, bool_or(webdriver) wd, coalesce(max(device_type) filter (where device_type<>'bot'),'bot') dev,
  max((event_name='checkout_completed')::int) cc, max(zip_prefix) filter (where zip_prefix is not null) zp
  from funnel_events where occurred_at>='2026-10-16' and session_id is not null group by 1)
select 'locale' k, coalesce(left(loc,2),'?') v, count(*) sessions, sum(cc) completed from s where not coalesce(wd,false) and dev<>'bot' group by 2
union all
select 'npa_completed', coalesce(left(zp,1),'?'), count(*), sum(cc) from s where not coalesce(wd,false) and cc=1 group by 2
order by 1,3 desc
