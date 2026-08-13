import { resolveAdsConfig } from "@/adsanalytics/config";
import { registerMerchantDeveloperGcp } from "@/adsanalytics/explorer/merchantClient";
import { log, withSyncRun } from "@/adsanalytics/run";

type MerchantRegisterGcpOptions = {
  merchantId?: string;
  email?: string;
};

export async function merchantRegisterGcpCommand(options: MerchantRegisterGcpOptions = {}): Promise<number> {
  return withSyncRun("merchant:register-gcp", options, async () => {
    resolveAdsConfig();
    const merchantId = (options.merchantId ?? process.env.GOOGLE_ADS_MERCHANT_ID ?? "").trim();
    const email = (options.email ?? "").trim();
    if (!merchantId) throw new Error("Missing --merchant-id or GOOGLE_ADS_MERCHANT_ID");
    if (!email) throw new Error("Missing --email=<developerEmail>");

    const result = await registerMerchantDeveloperGcp(merchantId, email);
    const responseName = typeof result.name === "string" ? result.name : null;
    const gcpIds = Array.isArray(result.gcpIds) ? result.gcpIds : [];

    log("merchant_register_gcp.summary", {
      merchantId,
      developerEmail: email,
      responseName,
      gcpIds,
    });

    return {
      merchantId,
      developerEmail: email,
      responseName,
      gcpIds,
      response: result,
    };
  });
}

