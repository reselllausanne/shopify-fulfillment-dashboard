import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { resolveMerchantOauthConfig } from "@/adsanalytics/config";
import { log, withSyncRun } from "@/adsanalytics/run";

type Options = { code?: string; writeEnv?: boolean };

function upsertEnv(envPath: string, key: string, value: string): void {
  const text = readFileSync(envPath, "utf8");
  const lines = text.split("\n");
  let found = false;
  const out = lines.map((line) => {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) return line;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (k === key) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) out.push(`${key}=${value}`);
  writeFileSync(envPath, out.join("\n").replace(/\n+$/, "\n"), "utf8");
}

export async function merchantAuthExchangeCommand(options: Options = {}): Promise<number> {
  return withSyncRun("merchant:auth:exchange", options, async () => {
    const code = options.code?.trim();
    if (!code) throw new Error("Missing --code=<oauth_code>");
    const oauth = resolveMerchantOauthConfig();
    const redirectUri = "urn:ietf:wg:oauth:2.0:oob";
    const body = new URLSearchParams({
      code,
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`OAuth token exchange failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
    const parsed = JSON.parse(text) as { refresh_token?: string; access_token?: string; scope?: string };
    if (!parsed.refresh_token) {
      throw new Error(
        "No refresh_token returned. Re-authorize with prompt=consent and access_type=offline."
      );
    }

    if (options.writeEnv) {
      const envPath = path.join(process.cwd(), ".env");
      upsertEnv(envPath, "GOOGLE_MERCHANT_REFRESH_TOKEN", parsed.refresh_token);
      log("merchant_auth_exchange.saved_to_env", {
        envPath,
        refreshTokenLength: parsed.refresh_token.length,
      });
    }

    // One-time display so user can copy manually into .env if not using --write-env.
    console.info(`MERCHANT_REFRESH_TOKEN_ONE_TIME=${parsed.refresh_token}`);

    return {
      refreshTokenLength: parsed.refresh_token.length,
      savedToEnv: Boolean(options.writeEnv),
      scope: parsed.scope ?? "",
      note: "Refresh token printed once above. Do not commit.",
    };
  });
}

