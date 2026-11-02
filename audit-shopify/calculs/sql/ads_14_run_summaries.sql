select "jobKey", status, count(*) runs, min("startedAt")::text first, max("startedAt")::text last
from "InventorySyncRun" group by 1,2 order by 1,2
