-- Galaxus par mois : lignes, CA net HT (unitNetPrice*qty), coût StockX apparié, achats externes, annulations
with l as (
 select o.id oid, o."galaxusOrderId", o."orderDate", o."cancelledAt", o."ordrStatus", ol.id lid, ol.quantity q, ol."lineNetAmount" net, ol."vatRate" vr, ol."providerKey" pk
 from "GalaxusOrder" o join "GalaxusOrderLine" ol on ol."orderId"=o.id),
m as (select "galaxusOrderLineId" lid, count(*) n_match, sum("stockxAmount") cost from "GalaxusStockxMatch" group by 1),
e as (select "galaxusOrderLineId" lid, count(*) n_ext, sum("costAmount") ecost from "GalaxusExternalBuy" where "cancelledAt" is null group by 1)
select to_char(l."orderDate",'YYYY-MM') mois, count(*) lignes, sum(l.q) unites, round(sum(l.net),0) ca_net_ht,
 count(*) filter (where l."cancelledAt" is not null) lignes_annulees, round(sum(l.net) filter (where l."cancelledAt" is not null),0) ca_annule,
 count(m.lid) lignes_avec_match_stx, round(sum(m.cost),0) cout_stx, count(e.lid) lignes_ext, round(sum(e.ecost),0) cout_ext,
 round(sum(l.net) filter (where m.lid is not null or e.lid is not null),0) ca_lignes_couvertes
from l left join m using(lid) left join e using(lid) group by 1 order by 1
