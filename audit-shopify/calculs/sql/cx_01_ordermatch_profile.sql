select "supplierSource", "matchType", coalesce("stockxStatus",'(null)') stx_status, coalesce("stockxCheckoutType",'(null)') checkout, count(*) n,
 count("returnAppliedAt") returns_applied, count("returnReason") w_reason
from "OrderMatch" group by 1,2,3,4 order by n desc
