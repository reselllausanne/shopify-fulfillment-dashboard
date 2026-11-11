// Lecture seule : id + createdAt des produits Shopify. Usage : node ads_07_shopify_created.mjs "<filtre created_at>" <fichier sortie>
// Défaut : created_at:<2026-07-08 -> donnees_brutes/ads/shopify_product_created.json
import fs from "node:fs";
import { shopifyRead } from "./shopify_readonly.mjs";
const FILT = process.argv[2] || "created_at:<2026-07-08";
const OUT = process.argv[3] || "audit-shopify/donnees_brutes/ads/shopify_product_created.json";
const Q = `query($c:String){ products(first:250, after:$c, query:"${FILT}", sortKey:CREATED_AT){ pageInfo{hasNextPage endCursor} nodes{ id createdAt } } }`;
let cur = null, all = [], page = 0;
do {
  let j = await shopifyRead(Q, { c: cur }); let tries = 0;
  while (j.errors && /Throttled/.test(JSON.stringify(j.errors)) && tries++ < 20) { await new Promise(r => setTimeout(r, 5000)); j = await shopifyRead(Q, { c: cur }); }
  if (j.errors) { console.error(JSON.stringify(j.errors).slice(0, 400)); break; }
  const p = j.data.products; all.push(...p.nodes); cur = p.pageInfo.hasNextPage ? p.pageInfo.endCursor : null; page++;
  if (page % 10 === 0) console.error("pages", page, "produits", all.length);
} while (cur && page < 400);
fs.writeFileSync(OUT, JSON.stringify(all.map(n => [n.id.split("/").pop(), n.createdAt])));
console.log("OK", all.length, cur ? "(tronqué)" : "(complet)");
