-- alertes ops par type/mois (StockxOrderAlert)
select to_char("createdAt",'YYYY-MM') m, scope, "alertType", count(*) n, count(distinct "orderRef") orders
from "StockxOrderAlert" group by 1,2,3 order by 1,2,3
