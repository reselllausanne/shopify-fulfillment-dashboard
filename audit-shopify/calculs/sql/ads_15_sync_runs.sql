select command, status, count(*) n, min(started_at)::text first, max(started_at)::text last, count(*) filter (where error is not null) with_error
from ads_sync_runs group by 1,2 order by 3 desc limit 60
