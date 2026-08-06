import { resolveDateRange } from "@/adsanalytics/dates";
import { withSyncRun } from "@/adsanalytics/run";
import { syncDailyAdSpend } from "@/adsanalytics/syncDailyAdSpend";

export type SyncSpendOptions = {
  days?: number;
  from?: string;
  to?: string;
};

/** DB-only: ads_campaign_daily → DailyAdSpend (no Google Ads API call). */
export async function syncSpendCommand(options: SyncSpendOptions): Promise<number> {
  return withSyncRun("sync-spend", { ...options }, async () => {
    const range = resolveDateRange({
      from: options.from,
      to: options.to,
      days: options.days ?? 30,
    });
    return syncDailyAdSpend(range);
  });
}
