// Lecture seule : parcourt les variantes en stock (inventory_quantity>0) des produits ACTIVE ; prix, compareAt, coût d'inventaire, flags 48h/price_locked.
import fs from "node:fs";
import { shopifyRead } from "./shopify_readonly.mjs";
const Q = `query($c:String){ productVariants(first:200, after:$c, query:"inventory_quantity:>0 AND product_status:active"){ pageInfo{hasNextPage endCursor} nodes{ id sku price compareAtPrice inventoryQuantity inventoryItem{ unitCost{amount} } d48:metafield(namespace:"custom",key:"delivery_48h"){value} lock:metafield(namespace:"custom",key:"price_locked"){value} product{ id tags vendor } } } }`;
let cur = null, all = [], page = 0;
do {
  let j = await shopifyRead(Q, { c: cur }); let tries = 0;
  while (j.errors && /Throttled/.test(JSON.stringify(j.errors)) && tries++ < 12) { await new Promise(r => setTimeout(r, 6000)); j = await shopifyRead(Q, { c: cur }); }
  if (j.errors) { console.error(JSON.stringify(j.errors).slice(0, 400)); break; }
  const pv = j.data.productVariants; all.push(...pv.nodes); cur = pv.pageInfo.hasNextPage ? pv.pageInfo.endCursor : null; page++;
  if (page % 5 === 0) console.error("pages", page, "variants", all.length);
} while (cur && page < 400);
fs.writeFileSync("audit-shopify/donnees_brutes/ads/shopify_variants_instock.json", JSON.stringify(all));
console.log("OK variantes", all.length, "pages", page, cur ? "(tronqué)" : "(complet)");
