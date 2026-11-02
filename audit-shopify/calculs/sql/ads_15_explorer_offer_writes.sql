select operation, status, count(*) n, count(distinct batch_id) batches, min(created_at)::text first, max(created_at)::text last, count(*) filter (where last_error is not null) errors
from ads_explorer_offer_writes group by 1,2 order by 3 desc
