// Auth GSC lecture seule (compte de service). Clé hors repo : GSC_KEY.
import fs from "node:fs"; import crypto from "node:crypto";
export const SITE = "sc-domain:resell-lausanne.ch";
export async function token() {
  const k = JSON.parse(fs.readFileSync((process.env.GSC_KEY || "").replace(/^~/, process.env.HOME), "utf8"));
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url"); const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: "RS256", typ: "JWT" }), c = b64({ iss: k.client_email, scope: process.env.GSC_SCOPE || "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const sig = crypto.createSign("RSA-SHA256").update(`${h}.${c}`).sign(k.private_key, "base64url");
  return (await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${h}.${c}.${sig}` }) })).json()).access_token;
}
