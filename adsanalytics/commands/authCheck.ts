import { describeAdsConfig, resolveAdsConfig } from "@/adsanalytics/config";
import { searchAll } from "@/adsanalytics/google/adsClient";
import { accountProbeQuery } from "@/adsanalytics/google/queries";
import { getAccessToken } from "@/adsanalytics/google/oauth";
import { log, withSyncRun } from "@/adsanalytics/run";

/** Read-only credential check: OAuth exchange plus one trivial GAQL SELECT. */
export async function authCheckCommand(): Promise<number> {
  return withSyncRun(
    "auth:check",
    {},
    async () => {
      const config = resolveAdsConfig();
      log("auth.config", describeAdsConfig(config));

      const token = await getAccessToken(config);
      log("auth.token_ok", { tokenLength: token.length });

      const { rows, stats } = await searchAll(config, accountProbeQuery());
      const customer = (rows[0]?.customer ?? {}) as Record<string, unknown>;

      log("auth.account", {
        id: customer.id ?? null,
        name: customer.descriptiveName ?? null,
        currency: customer.currencyCode ?? null,
        timeZone: customer.timeZone ?? null,
        manager: customer.manager ?? null,
        testAccount: customer.testAccount ?? null,
      });

      return { apiRequests: stats.requests, retries: stats.retries, rows: rows.length };
    },
    { persist: false }
  );
}
