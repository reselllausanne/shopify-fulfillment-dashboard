-- Commandes Shopify par mois (heure de Zurich), statut financier
select to_char(("createdAt" at time zone 'Europe/Zurich'),'YYYY-MM') mois,
 count(*) n, count(*) filter (where "cancelledAt" is not null) annulees,
 round(sum("totalSalesChf")::numeric,0) ventes_brutes_chf, round(sum("netSalesChf")::numeric,0) net_sales_chf,
 round(sum("refundedAmountChf")::numeric,0) rembourse_chf,
 count(*) filter (where "refundedAmountChf">0) n_remb
from "ShopifyOrder" group by 1 order by 1
