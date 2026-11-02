with l as (
 select o."orderDate", o."cancelledAt", ol.id lid, ol.quantity q, ol."lineNetAmount" net, split_part(ol."providerKey",'_',1) pk, ol."providerKey" pkfull
 from "GalaxusOrder" o join "GalaxusOrderLine" ol on ol."orderId"=o.id where o."orderDate">='2026-03-01'),
m as (select "galaxusOrderLineId" lid, sum("stockxAmount") cost, count(*) n from "GalaxusStockxMatch" group by 1),
e as (select "galaxusOrderLineId" lid, sum("costAmount") ecost, count(*) n from "GalaxusExternalBuy" where "cancelledAt" is null group by 1)
select pk, count(*) lignes, sum(q) unites, round(sum(net),0) ca_net_ht, count(m.lid) l_stx, round(sum(m.cost),0) cout_stx, count(e.lid) l_ext, round(sum(e.ecost),0) cout_ext,
 round(sum(net) filter (where m.lid is not null),0) ca_l_stx, round(sum(net) filter (where e.lid is not null),0) ca_l_ext,
 round(100*(sum(net) filter (where m.lid is not null) - sum(m.cost))/nullif(sum(net) filter (where m.lid is not null),0),1) marge_pct_stx
from l left join m using(lid) left join e using(lid) group by 1 order by 4 desc limit 15
