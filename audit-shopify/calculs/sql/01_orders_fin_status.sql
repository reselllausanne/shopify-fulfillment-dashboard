select "financialStatus", "currencyCode", count(*) n, round(sum("totalSalesChf"),0) tot, round(sum("netSalesChf"),0) net, round(sum("refundedAmountChf"),0) refd,
 count(*) filter (where "cancelledAt" is not null) canc, string_agg(distinct array_to_string("paymentGatewayNames",'+'), ' ; ') gw
from "ShopifyOrder" group by 1,2 order by n desc
