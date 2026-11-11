// Lecture seule : 100 commandes récentes, la landing page (avec ou sans query string) contient-elle un gclid ?
// Sortie : compteurs seulement, aucun identifiant publié.
import { shopifyRead } from "./shopify_readonly.mjs";
const Q = `query{ orders(first:100, sortKey:CREATED_AT, reverse:true, query:"created_at:>=2026-10-15"){ nodes{ name customerJourneySummary{ ready firstVisit{ landingPage referrerUrl utmParameters{source medium campaign} } lastVisit{ landingPage referrerUrl utmParameters{source medium campaign} } } } } }`;
const j = await shopifyRead(Q, {});
if (j.errors) { console.error(JSON.stringify(j.errors).slice(0, 500)); process.exit(1); }
const n = j.data.orders.nodes; let hasQ = 0, gcl = 0, ready = 0, lv = 0, utmCpc = 0;
for (const o of n) {
  const s = o.customerJourneySummary; if (!s) continue; if (s.ready) ready++;
  for (const v of [s.firstVisit, s.lastVisit]) { if (!v) continue; lv++; if ((v.landingPage || "").includes("?")) hasQ++; if (/gclid=|gbraid=|wbraid=/.test(v.landingPage || "")) gcl++; if ((v.utmParameters?.medium || "") === "cpc") utmCpc++; }
}
console.log({ commandes: n.length, journey_ready: ready, visites: lv, landing_avec_query: hasQ, landing_avec_clickid: gcl, visites_utm_cpc: utmCpc });
