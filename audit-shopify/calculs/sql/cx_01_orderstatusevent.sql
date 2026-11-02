select source, type, to_char("createdAt",'YYYY-MM') m, count(*) n, count(distinct "orderId") orders from "OrderStatusEvent" group by 1,2,3 order by 1,2,3
