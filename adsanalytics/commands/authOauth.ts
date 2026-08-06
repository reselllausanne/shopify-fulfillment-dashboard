/**
 * One-shot OAuth bootstrap for Google Ads.
 *
 * Google will not accept the developer token alone. They force an OAuth
 * "Desktop" client (client_id + client_secret) and a one-time browser login
 * that produces a refresh_token. This command does that login and writes the
 * refresh token into .env — after that, `auth:check` / `probe` work headless.
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { URL } from "node:url";

import { EXIT_CONFIG_MISSING, EXIT_FAILED, EXIT_OK, log, logError } from "@/adsanalytics/run";

const SCOPE = "https://www.googleapis.com/auth/adwords";
/** Desktop OAuth clients allow loopback; downloaded JSON lists http://localhost. */
const REDIRECT_URI = "http://localhost:8765";
const PORT = 8765;

function readEnvFile(envPath: string): Map<string, string> {
  const map = new Map<string, string>();
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    map.set(line.slice(0, i).trim(), line.slice(i + 1));
  }
  return map;
}

function upsertEnv(envPath: string, patch: Record<string, string>): void {
  const text = readFileSync(envPath, "utf8");
  const lines = text.split("\n");
  const seen = new Set<string>();
  const out = lines.map((line) => {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) return line;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    if (key in patch) {
      seen.add(key);
      return `${key}=${patch[key]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(patch)) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }
  writeFileSync(envPath, out.join("\n").replace(/\n+$/, "\n"), "utf8");
}

function printCloudConsoleSteps(): void {
  console.info(`
Google Ads API needs ONE extra thing the Ads UI does not give you:
a Google Cloud OAuth Desktop client. Two minutes, then this command finishes alone.

Do this once, logged in as reselllausanne@gmail.com:

1. Open https://console.cloud.google.com/apis/credentials
2. Create / pick any project (e.g. "resell-ads")
3. Enable "Google Ads API" on that project:
   https://console.cloud.google.com/apis/library/googleads.googleapis.com
4. Credentials → Create credentials → OAuth client ID
   - Application type: Desktop app
   - Name: resell-ads-cli
5. Copy Client ID + Client secret into your local .env:

   GOOGLE_ADS_CLIENT_ID=.....apps.googleusercontent.com
   GOOGLE_ADS_CLIENT_SECRET=.....

6. OAuth consent screen: External (or Internal if Workspace), add yourself
   as test user: reselllausanne@gmail.com
   Scope needed later is only: ${SCOPE}

Then re-run:

   npm run ads -- auth:oauth
`);
}

async function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
        const err = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        if (err) {
          res.writeHead(400, { "content-type": "text/html" });
          res.end(`<h1>OAuth error: ${err}</h1>`);
          server.close();
          reject(new Error(`OAuth error: ${err}`));
          return;
        }
        if (!code) {
          res.writeHead(400, { "content-type": "text/html" });
          res.end("<h1>Missing code — open the auth URL from the terminal.</h1>");
          return;
        }
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<h1>OK — close this tab, go back to the terminal.</h1>");
        server.close();
        resolve(code);
      } catch (e) {
        reject(e);
      }
    });
    server.listen(PORT, "127.0.0.1");
    // Also accept connections via localhost hostname resolution.
    server.on("error", reject);
  });
}

export async function authOauthCommand(): Promise<number> {
  const envPath = path.join(process.cwd(), ".env");
  const env = readEnvFile(envPath);
  const clientId = (env.get("GOOGLE_ADS_CLIENT_ID") ?? process.env.GOOGLE_ADS_CLIENT_ID ?? "").trim();
  const clientSecret = (
    env.get("GOOGLE_ADS_CLIENT_SECRET") ??
    process.env.GOOGLE_ADS_CLIENT_SECRET ??
    ""
  ).trim();

  if (!clientId || !clientSecret) {
    printCloudConsoleSteps();
    logError("auth.oauth.missing_client", {
      note: "Developer token + account IDs are already in .env. Only the Cloud OAuth client is missing.",
    });
    return EXIT_CONFIG_MISSING;
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  log("auth.oauth.open_browser", {
    redirectUri: REDIRECT_URI,
    loginHint: "reselllausanne@gmail.com",
  });
  console.info("\nOpen this URL, login as reselllausanne@gmail.com, click Allow:\n");
  console.info(authUrl.toString());
  console.info("\nWaiting on http://127.0.0.1:8765/oauth2callback …\n");

  // Best-effort open; user can paste the URL if it fails.
  try {
    const { execFile } = await import("node:child_process");
    execFile("open", [authUrl.toString()]);
  } catch {
    /* ignore */
  }

  let code: string;
  try {
    code = await waitForCode();
  } catch (err) {
    logError("auth.oauth.callback_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return EXIT_FAILED;
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    logError("auth.oauth.token_exchange_failed", { status: res.status, body: text.slice(0, 500) });
    return EXIT_FAILED;
  }

  const parsed = JSON.parse(text) as { refresh_token?: string; access_token?: string };
  if (!parsed.refresh_token) {
    logError("auth.oauth.no_refresh_token", {
      note: "Google returned no refresh_token. Re-run with prompt=consent (this command already sets it), or revoke prior access at https://myaccount.google.com/permissions and try again.",
    });
    return EXIT_FAILED;
  }

  upsertEnv(envPath, { GOOGLE_ADS_REFRESH_TOKEN: parsed.refresh_token });
  log("auth.oauth.refresh_token_saved", {
    envPath,
    refreshTokenLength: parsed.refresh_token.length,
  });
  console.info("\nRefresh token written to .env. Next:\n  npm run ads -- auth:check\n  npm run ads -- probe --days=30\n");
  return EXIT_OK;
}
