select b.id, b.status, b.model_count, b.offer_count, round(b.daily_budget_micros/1e6,1) budget, round(b.max_cpc_micros/1e6,2) maxcpc, b.planned_at::text planned, b.activated_at::text activated, b.ends_at::text ends, b.google_campaign_id,
 (select count(*) from ads_explorer_batch_models m where m.batch_id=b.id) models,
 (select sum(m.clicks) from ads_explorer_batch_models m where m.batch_id=b.id) clicks,
 (select round(sum(m.cost_micros)/1e6,1) from ads_explorer_batch_models m where m.batch_id=b.id) cost,
 (select round(sum(m.conversions)::numeric,1) from ads_explorer_batch_models m where m.batch_id=b.id) conv,
 (select round(sum(m.conversion_value)::numeric,1) from ads_explorer_batch_models m where m.batch_id=b.id) val
from ads_explorer_batches b order by b.created_at
