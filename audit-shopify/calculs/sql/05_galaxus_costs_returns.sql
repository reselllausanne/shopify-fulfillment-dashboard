select 'delr_'||case when description like '%packing%' then 'packing' else 'shipping' end k, to_char("eventDate",'YYYY-MM') mois, count(*) n, round(sum(amount),0) chf
from "ManualFinanceEvent" where description like 'Galaxus DELR%' and description not like '%TEST%' group by 1,2
union all
select 'retour_'||platform, to_char("createdAt",'YYYY-MM'), count(*), round(sum("returnAmount"),0) from marketplace_returns group by 1,2
union all
select 'decathlon_cmd', to_char("orderDate",'YYYY-MM'), count(*), round(sum("totalPrice"),0) from "DecathlonOrder" group by 1,2
order by 1,2
