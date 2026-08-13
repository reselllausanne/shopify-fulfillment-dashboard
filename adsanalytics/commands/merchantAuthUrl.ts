import { createHash } from "node:crypto";

import { resolveMerchantOauthConfig } from "@/adsanalytics/config";
import { log, withSyncRun } from "@/adsanalytics/run";

const MERCHANT_SCOPE = "https://www.googleapis.com/auth/content";
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

export async function merchantAuthUrlCommand(): Promise<number> {
  return withSyncRun("merchant:auth:url", {}, async () => {
    const oauth = resolveMerchantOauthConfig();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", oauth.clientId);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", MERCHANT_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");

    const state = createHash("sha256")
      .update(`${Date.now()}|merchant-auth`)
      .digest("hex")
      .slice(0, 12);
    url.searchParams.set("state", state);

    log("merchant_auth_url.generated", {
      scope: MERCHANT_SCOPE,
      accessType: "offline",
      prompt: "consent",
      redirectUri: REDIRECT_URI,
      state,
      authUrl: url.toString(),
    });
    return {
      scope: MERCHANT_SCOPE,
      accessType: "offline",
      prompt: "consent",
      redirectUri: REDIRECT_URI,
      state,
      authUrl: url.toString(),
    };
  });
}

