select date::date::text d, round(sum("amountChf")::numeric,2) pub_chf from "DailyAdSpend" where date >= '2026-07-01' and channel ilike '%google%' group by 1 order by 1
