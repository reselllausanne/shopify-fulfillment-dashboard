// Klaviyo : détails campagnes/flows + rapports de performance (POST *-reports = requêtes de LECTURE ; aucune écriture).
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module"; import { kget } from "./cx_klaviyo_get.mjs";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
require("dotenv").config({ path: path.join(root, ".env") });
const D = "audit-shopify/donnees_brutes/klaviyo/";
async function kpostReport(p, body) {
  if (!/^\/api\/(campaign|flow|segment|form)-(values|series)-reports\/$/.test(p)) throw new Error("REFUS: seul *-reports autorisé");
  for (let i=0;i<6;i++){
  const r = await fetch("https://a.klaviyo.com" + p, { method: "POST", headers: { Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_API_KEY}`, revision: "2025-07-15", accept: "application/vnd.api+json", "content-type": "application/vnd.api+json" }, body: JSON.stringify(body) });
  if (r.status===429){await new Promise(s=>setTimeout(s,15000*(i+1)));continue;}
  const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t.slice(0, 300) }; } }
}
const metrics = (await (await import("node:fs")).promises.readFile(D + "metrics.json", "utf8").then(JSON.parse)).body.data;
const placed = metrics.find(m => m.attributes.name === "Placed Order").id;
const stats = ["recipients","delivered","delivery_rate","opens_unique","open_rate","clicks_unique","click_rate","unsubscribes","unsubscribe_rate","spam_complaints","spam_complaint_rate","bounced","bounce_rate","conversion_uniques","conversion_value","conversion_rate"];
const camp = await kpostReport("/api/campaign-values-reports/", { data: { type: "campaign-values-report", attributes: { timeframe: { key: "last_365_days" }, conversion_metric_id: placed, statistics: stats } } });
fs.writeFileSync(D + "report_campaigns.json", JSON.stringify(camp, null, 1)); console.log("CAMP", camp.status, JSON.stringify(camp.body).slice(0, 300));
await new Promise(s=>setTimeout(s,20000));
const flow = await kpostReport("/api/flow-values-reports/", { data: { type: "flow-values-report", attributes: { timeframe: { key: "last_365_days" }, conversion_metric_id: placed, statistics: stats } } });
fs.writeFileSync(D + "report_flows.json", JSON.stringify(flow, null, 1)); console.log("FLOW", flow.status, JSON.stringify(flow.body).slice(0, 300));
