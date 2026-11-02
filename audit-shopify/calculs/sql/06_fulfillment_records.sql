select "shopifyOrderName" ord, "status", "trackingCompany", "createdAt"::text created_utc, "stockxDeliveredAt"::text stx_delivered, "scanCompletedAt"::text scan_done, "labelGeneratedAt"::text label_at, "requestCompletedAt"::text fulfilled_at, "swissPostStatus"
from "ShopifyFulfillmentRecord"
