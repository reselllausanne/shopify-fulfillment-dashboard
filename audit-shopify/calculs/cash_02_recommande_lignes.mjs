// Lecture seule : commandes Shopify (client, date) pour taux de recommande + lignes depuis le 1er août (marque, prix, variante).
import fs from "node:fs"; import { shopifyRead } from "./shopify_readonly.mjs";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function q(query, v) { for (let t = 0; t < 12; t++) { const j = await shopifyRead(query, v); if (j.errors?.some(e => e.extensions?.code === "THROTTLED")) { await sleep(2500); continue; } return j; } throw new Error("throttle"); }
const out = []; let c = null, page = 0;
for (;;) {
  const j = await q(`query($c:String){ orders(first:100, after:$c, sortKey:CREATED_AT, query:"created_at:>=2025-01-01 -status:cancelled"){ pageInfo{hasNextPage endCursor} nodes{ id createdAt customer{ id } totalPriceSet{shopMoney{amount}} lineItems(first:8){ nodes{ quantity vendor variant{ id } product{ id productType } discountedUnitPriceSet{ shopMoney{ amount } } } } } } }`, { c });
  if (j.errors) { console.error(JSON.stringify(j.errors).slice(0, 300)); break; }
  const o = j.data.orders; out.push(...o.nodes); page++; if (page % 5 === 0) console.log(page, out.length);
  if (!o.pageInfo.hasNextPage) break; c = o.pageInfo.endCursor; await sleep(400);
}
fs.writeFileSync("/tmp/orders_all.json", JSON.stringify(out)); console.log("orders", out.length, out[0]?.createdAt, out.at(-1)?.createdAt);
