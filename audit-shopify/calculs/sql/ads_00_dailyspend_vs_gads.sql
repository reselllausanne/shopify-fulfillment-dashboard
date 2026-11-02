with a as (select date::text d, sum(cost_micros)/1e6 cost from ads_campaign_daily group by 1),
 b as (select left(date::text,10) d, "amountChf" amt, notes from "DailyAdSpend")
select to_char(coalesce(a.d,b.d)::date,'YYYY-MM') m, round(sum(a.cost)) gads_cost, round(sum(b.amt)) dailyadspend, count(a.d) da, count(b.d) db,
 round(sum(abs(coalesce(a.cost,0)-coalesce(b.amt,0)))) abs_diff
from a full join b on a.d=b.d group by 1 order by 1
