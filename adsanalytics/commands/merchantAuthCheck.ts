import { EXPLORER_DEFAULT_MERCHANT_ID, writeExplorerReport } from "@/adsanalytics/explorer/core";
import { merchantAuthCheck } from "@/adsanalytics/explorer/merchantClient";
import { log, withSyncRun } from "@/adsanalytics/run";

export async function merchantAuthCheckCommand(): Promise<number> {
  return withSyncRun("merchant:auth-check", {}, async () => {
    const result = await merchantAuthCheck(EXPLORER_DEFAULT_MERCHANT_ID);
    const outPath = await writeExplorerReport("merchant-auth-check.json", {
      merchantRefreshTokenPresent: result.merchantRefreshTokenPresent,
      merchantRefreshTokenLength: result.merchantRefreshTokenLength,
      merchantRefreshTokenFingerprint8: result.merchantRefreshTokenFingerprint8,
      accessTokenObtained: result.accessTokenObtained,
      tokenScopes: result.tokenScopes,
      contentScopePresent: result.contentScopePresent,
      merchantAccountAccessible: result.merchantAccountAccessible,
      merchantIdReturned: result.merchantIdReturned,
      googleIdentity: result.googleIdentity,
      checkedAt: new Date().toISOString(),
    });
    log("merchant_auth_check.summary", {
      merchantRefreshTokenPresent: result.merchantRefreshTokenPresent,
      merchantRefreshTokenLength: result.merchantRefreshTokenLength,
      merchantRefreshTokenFingerprint8: result.merchantRefreshTokenFingerprint8,
      accessTokenObtained: result.accessTokenObtained,
      tokenScopes: result.tokenScopes,
      contentScopePresent: result.contentScopePresent,
      merchantAccountAccessible: result.merchantAccountAccessible,
      merchantIdReturned: result.merchantIdReturned,
      googleIdentity: result.googleIdentity,
      errorCode: result.errorCode,
      reportPath: outPath,
    });
    return {
      merchantRefreshTokenPresent: result.merchantRefreshTokenPresent,
      merchantRefreshTokenLength: result.merchantRefreshTokenLength,
      merchantRefreshTokenFingerprint8: result.merchantRefreshTokenFingerprint8,
      accessTokenObtained: result.accessTokenObtained,
      tokenScopes: result.tokenScopes,
      contentScopePresent: result.contentScopePresent,
      merchantAccountAccessible: result.merchantAccountAccessible,
      merchantIdReturned: result.merchantIdReturned,
      googleIdentity: result.googleIdentity,
      reportPath: outPath,
    };
  });
}

