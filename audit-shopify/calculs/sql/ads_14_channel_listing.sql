select channel::text ch, status, count(*) n,
 count(*) filter (where "lastSyncedAt" > now() - interval '1 day') synced_24h,
 count(*) filter (where "lastSyncedAt" > now() - interval '7 day') synced_7d,
 count(*) filter (where "lastSyncedAt" <= now() - interval '7 day' or "lastSyncedAt" is null) older_7d,
 count(*) filter (where "lastPushedStock" > 0) stock_pos, count(*) filter (where "soldOutAt" is not null) soldout_marked,
 count(*) filter (where "archivedAt" is not null) archived,
 min("lastSyncedAt")::text oldest, max("lastSyncedAt")::text newest
from "ChannelListingState" group by 1,2 order by 3 desc
