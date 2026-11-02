select left(regexp_replace(description,'[0-9]+','#','g'),60) d, count(*) n, round(sum(amount),0) total, min("eventDate")::date mn, max("eventDate")::date mx, direction, "sourceType"
from "ManualFinanceEvent" group by 1,6,7 order by n desc limit 40
