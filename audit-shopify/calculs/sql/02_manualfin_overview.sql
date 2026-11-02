select category, direction, "sourceType", count(*) n, round(sum(amount),0) total_chf, min("eventDate")::date mn, max("eventDate")::date mx
from "ManualFinanceEvent" group by 1,2,3 order by n desc
