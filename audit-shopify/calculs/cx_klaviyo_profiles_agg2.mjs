// Agrégats complémentaires (croisement Accepts Marketing x consentement x canReceive). Comptages seulement, aucune PII.
import fs from "node:fs"; import { kget } from "./cx_klaviyo_get.mjs";
let next = "/api/profiles/?page%5Bsize%5D=100&additional-fields%5Bprofile%5D=subscriptions";
const x = {}; const bump = (k) => x[k] = (x[k] || 0) + 1;
while (next) {
  const r = await kget(next); if (r.status !== 200) break;
  for (const p of r.body.data) {
    const a = p.attributes; const em = a.subscriptions?.email?.marketing;
    const am = String(a.properties?.["Accepts Marketing"]);
    const tags = a.properties?.["Shopify Tags"]; const hasT = Array.isArray(tags) ? tags.length : (tags ? 1 : 0);
    bump(`AM=${am}|consent=${em?.consent || "NONE"}|can=${em?.can_receive_email_marketing}`);
    if (em?.consent_timestamp) bump("has_consent_ts"); if (em?.method) bump("method=" + em.method);
    bump("created_" + (a.created || "").slice(0, 7));
    if (hasT) bump("has_shopify_tags");
  }
  next = r.body.links?.next || null;
}
fs.writeFileSync("audit-shopify/donnees_brutes/klaviyo/profiles_agg2.json", JSON.stringify(x, Object.keys(x).sort(), 1));
console.log("done", Object.keys(x).length);
