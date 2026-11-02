select to_char("date",'YYYY-MM') mois, type, "isBusiness" biz, count(*) n, round(sum(amount)::numeric,0) total_chf
from "PersonalExpense" group by 1,2,3 order by 1,2,3
