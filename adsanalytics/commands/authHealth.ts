import { resolveAdsConfig } from "@/adsanalytics/config";
import { EXPLORER_DEFAULT_MERCHANT_ID, writeExplorerReport } from "@/adsanalytics/explorer/core";
import { merchantAuthCheck } from "@/adsanalytics/explorer/merchantClient";
import { searchAll } from "@/adsanalytics/google/adsClient";
import { getAccessToken } from "@/adsanalytics/google/oauth";
import { accountProbeQuery } from "@/adsanalytics/google/queries";
import { notifyAdsAuthBroken } from "@/adsanalytics/ops/authAlert";
import { log, withSyncRun } from "@/adsanalytics/run";

async function checkAds(): Promise<{ ok: boolean; error: string | null; accountId: string | null }> {
  try {
    const config = resolveAdsConfig();
    await getAccessToken(config);
    const { rows } = await searchAll(config, accountProbeQuery());
    const customer = (rows[0]?.customer ?? {}) as Record<string, unknown>;
    return { ok: true, error: null, accountId: (customer.id as string | undefined) ?? null };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 300), accountId: null };
  }
}

/**
 * Exercises both grants daily so a revoked refresh token surfaces within 24h instead of
 * after a week of silently skipped Explorer routing. Exits non-zero so systemd marks the
 * unit failed even when no Slack webhook is configured.
 */
export async function authHealthCommand(): Promise<number> {
  return withSyncRun("auth:health", {}, async () => {
    const ads = await checkAds();
    const merchant = await merchantAuthCheck(EXPLORER_DEFAULT_MERCHANT_ID);
    const merchantOk = merchant.accessTokenObtained && merchant.contentScopePresent && merchant.merchantAccountAccessible;

    const failures: string[] = [];
    if (!ads.ok) failures.push(`ads: ${ads.error}`);
    if (!merchant.accessTokenObtained) failures.push("merchant: refresh token rejected (revoked or expired)");
    else if (!merchant.contentScopePresent) failures.push(`merchant: missing content scope (got ${merchant.tokenScopes.join(", ") || "none"})`);
    else if (!merchant.merchantAccountAccessible) failures.push(`merchant: account not accessible (${merchant.errorCode ?? "unknown"})`);

    const sharedToken =
      (process.env.GOOGLE_ADS_REFRESH_TOKEN ?? "").trim() ===
      (process.env.GOOGLE_MERCHANT_REFRESH_TOKEN ?? "").trim();

    const alert = failures.length > 0 ? await notifyAdsAuthBroken({ adsOk: ads.ok, merchantOk, failures }) : { sent: false, reason: "healthy" };

    const report = {
      checkedAt: new Date().toISOString(),
      adsOk: ads.ok,
      adsAccountId: ads.accountId,
      adsError: ads.error,
      merchantOk,
      merchantTokenFingerprint8: merchant.merchantRefreshTokenFingerprint8,
      merchantScopes: merchant.tokenScopes,
      merchantErrorCode: merchant.errorCode,
      sharedToken,
      failures,
      alert,
    };
    const reportPath = await writeExplorerReport("auth-health.json", report);
    log("auth_health.summary", { ...report, reportPath });

    if (failures.length > 0) {
      throw new Error(`Google auth broken: ${failures.join("; ")}. Re-consent with: npm run ads -- auth:oauth`);
    }
    return { ...report, reportPath };
  });
}
