select "supplierSource", "matchConfidence", "stockxStatus", count(*) n, count(*) filter (where "supplierCost" is not null) with_cost,
 round(sum("shopifyTotalPrice"),0) rev, round(sum("supplierCost"),0) cost, round(sum("marginAmount"),0) margin,
 count(*) filter (where "manualCaseStatus" is not null) manual, count(*) filter (where "returnAppliedAt" is not null) ret
from "OrderMatch" group by 1,2,3 order by n desc
