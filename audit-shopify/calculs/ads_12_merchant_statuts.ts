/** Lecture seule Merchant Center : problèmes de compte + statuts agrégés des produits (GET uniquement). Aucun secret journalisé. */
import "dotenv/config";
import fs from "node:fs";
import { getAccessTokenForOAuth } from "../../adsanalytics/google/oauth";
import { resolveMerchantOauthConfig } from "../../adsanalytics/config";
const MID = "669442699";
async function get(url: string, token: string) {
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
  return { status: r.status, j };
}
(async () => {
  const token = await getAccessTokenForOAuth(resolveMerchantOauthConfig());
  const out: Record<string, unknown> = {};
  const C: Record<string,string> = {
    issues_v1: `https://merchantapi.googleapis.com/accounts/v1/accounts/${MID}/issues?pageSize=100`,
    agg_v1: `https://merchantapi.googleapis.com/accounts/v1/accounts/${MID}/aggregateProductStatuses?pageSize=250`,
    agg_ir_v1: `https://merchantapi.googleapis.com/issueresolution/v1/accounts/${MID}/aggregateProductStatuses?pageSize=250`,
    agg_ir_beta: `https://merchantapi.googleapis.com/issueresolution/v1beta/accounts/${MID}/aggregateProductStatuses?pageSize=250`,
    acct_issues_beta2: `https://merchantapi.googleapis.com/accounts/v1beta/accounts/${MID}/issues?pageSize=100`,
    acct: `https://merchantapi.googleapis.com/accounts/v1beta/accounts/${MID}`,
  };
  for (const [k, u] of Object.entries(C)) { const r = await get(u, token); out[k] = r; console.log(k, r.status, JSON.stringify(r.j).slice(0, 160)); }
  fs.writeFileSync("/tmp/merchant_status.json", JSON.stringify(out));
})();
