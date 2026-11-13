/** Lecture seule : rapport Merchant "compétitivité prix" (POST reports:search = requête de lecture). */
import "dotenv/config";
import fs from "node:fs";
import { getAccessTokenForOAuth } from "../../adsanalytics/google/oauth";
import { resolveMerchantOauthConfig } from "../../adsanalytics/config";
const MID = "669442699";
(async () => {
  const token = await getAccessTokenForOAuth(resolveMerchantOauthConfig());
  const rows: any[] = []; let pageToken = ""; let status = 0; let err = "";
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`https://merchantapi.googleapis.com/reports/v1/accounts/${MID}/reports:search`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query: "SELECT id, offer_id, title, brand, report_country_code, price, benchmark_price FROM price_competitiveness_product_view", pageSize: 1000, ...(pageToken ? { pageToken } : {}) }) });
    status = r.status; const j: any = await r.json().catch(() => ({}));
    if (r.status !== 200) { err = JSON.stringify(j).slice(0, 400); break; }
    rows.push(...(j.results || [])); pageToken = j.nextPageToken || ""; if (!pageToken) break;
  }
  console.log("status", status, "rows", rows.length, err);
  fs.writeFileSync("/tmp/price_comp.json", JSON.stringify(rows));
})();
