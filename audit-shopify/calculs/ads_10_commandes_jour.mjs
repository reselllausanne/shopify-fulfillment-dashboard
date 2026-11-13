// Lecture seule : commandes Shopify par jour et par canal (utm medium cpc / SEO / autre) depuis le 2026-10-25. Aucun identifiant publié.
import { shopifyRead } from "./shopify_readonly.mjs";
const Q = `query($c:String){ orders(first:25, after:$c, sortKey:CREATED_AT, reverse:true, query:"created_at:>=2026-10-25 test:false"){ pageInfo{hasNextPage endCursor} nodes{ createdAt cancelledAt currentTotalPriceSet{shopMoney{amount}} customerJourneySummary{ ready firstVisit{ source sourceType utmParameters{medium} } lastVisit{ source sourceType utmParameters{medium} } } } } }`;
let c = null; const d = {};
for (;;) { let j = await shopifyRead(Q, { c }); for (let t = 0; j.errors?.[0]?.extensions?.code === "THROTTLED" && t < 8; t++) { await new Promise(r => setTimeout(r, 4000)); j = await shopifyRead(Q, { c }); } if (j.errors) { console.error(JSON.stringify(j.errors).slice(0, 300)); process.exit(1); }
  for (const o of j.data.orders.nodes) { if (o.cancelledAt) continue; const day = o.createdAt.slice(0, 10); const s = o.customerJourneySummary; const med = s?.lastVisit?.utmParameters?.medium || s?.firstVisit?.utmParameters?.medium;
    const ch = med === "cpc" ? "cpc" : (s?.lastVisit?.sourceType === "SEO" || s?.firstVisit?.sourceType === "SEO") ? "seo" : !s?.ready && !s?.firstVisit ? "inconnu" : "autre";
    const e = d[day] ||= { cmd: 0, ca: 0, cpc: 0, seo: 0, inconnu: 0, autre: 0, cpc_ca: 0 }; e.cmd++; const a = +o.currentTotalPriceSet.shopMoney.amount; e.ca += a; e[ch]++; if (ch === "cpc") e.cpc_ca += a; }
  const p = j.data.orders.pageInfo; if (!p.hasNextPage) break; c = p.endCursor; }
console.log("jour,cmd,ca,cpc,cpc_ca,seo,autre,inconnu"); for (const k of Object.keys(d).sort()) { const e = d[k]; console.log([k, e.cmd, Math.round(e.ca), e.cpc, Math.round(e.cpc_ca), e.seo, e.autre, e.inconnu].join(",")); }
