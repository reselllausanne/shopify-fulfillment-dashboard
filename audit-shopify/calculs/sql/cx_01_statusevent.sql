select "milestoneKey", to_char("createdAt",'YYYY-MM') m, count(*) n, count("emailedAt") emailed, count("emailError") errs,
 sum(case when "emailProvider" is not null then 1 else 0 end) provider_set
from "StockXStatusEvent" group by 1,2 order by 2,1
