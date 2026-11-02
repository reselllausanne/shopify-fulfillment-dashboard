// Agrégats profils Klaviyo (GET lecture). N'écrit AUCUNE PII : comptages seulement.
import fs from "node:fs"; import { kget } from "./cx_klaviyo_get.mjs";
let next = "/api/profiles/?page%5Bsize%5D=100&additional-fields%5Bprofile%5D=subscriptions", n = 0;
const agg = { total: 0, hasEmail: 0, emailConsent: {}, emailCanReceive: 0, suppressionReasons: {}, smsAny: 0, createdByYear: {}, propKeys: {}, hasPhone: 0, hasOrders: 0, sizeProps: 0, subscribedByCreatedYear:{}, historicalImport: 0, sourceCounts: {} };
while (next) {
  const r = await kget(next); if (r.status !== 200) { console.log("ERR", r.status, JSON.stringify(r.body).slice(0, 300)); break; }
  for (const p of r.body.data) {
    const a = p.attributes; agg.total++;
    if (a.email) agg.hasEmail++; if (a.phone_number) agg.hasPhone++;
    const y = (a.created || "").slice(0, 4); agg.createdByYear[y] = (agg.createdByYear[y] || 0) + 1;
    const em = a.subscriptions?.email?.marketing; const st = em?.consent || "NONE"; agg.emailConsent[st] = (agg.emailConsent[st] || 0) + 1;
    if (em?.can_receive_email_marketing) { agg.emailCanReceive++; agg.subscribedByCreatedYear[y] = (agg.subscribedByCreatedYear[y]||0)+1; }
    for (const s of em?.suppression || []) agg.suppressionReasons[s.reason] = (agg.suppressionReasons[s.reason] || 0) + 1;
    if (a.subscriptions?.sms?.marketing?.consent === "SUBSCRIBED") agg.smsAny++;
    for (const k of Object.keys(a.properties || {})) { agg.propKeys[k] = (agg.propKeys[k] || 0) + 1; if (/size|taille|pointure/i.test(k)) agg.sizeProps++; }
    const src = a.properties?.["$source"] || a.properties?.source; if (src) agg.sourceCounts[src] = (agg.sourceCounts[src] || 0) + 1;
  }
  next = r.body.links?.next || null; n++;
  if (n % 20 === 0) console.error("pages", n, agg.total);
}
fs.writeFileSync("audit-shopify/donnees_brutes/klaviyo/profiles_agg.json", JSON.stringify(agg, null, 1));
console.log(JSON.stringify(agg, null, 1).slice(0, 5000));
