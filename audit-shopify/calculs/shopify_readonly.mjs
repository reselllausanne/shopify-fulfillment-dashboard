#!/usr/bin/env node
// Requête GraphQL Admin Shopify en LECTURE SEULE (refuse toute "mutation").
// Usage : node shopify_readonly.mjs <fichier.graphql> [variables.json] > sortie.json
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
require("dotenv").config({ path: path.join(root, ".env") });

export async function shopifyRead(query, variables = {}) {
  if (/\bmutation\b/i.test(query)) throw new Error("REFUS : mutation interdite pendant l'audit");
  const shop = process.env.SHOP_NAME_SHOPIFY, ver = process.env.API_VERSION_SHOPIFY;
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.ACCESS_TOKEN_SHOPIFY;
  const r = await fetch(`https://${shop}/admin/api/${ver}/graphql.json`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.extensions?.cost?.throttleStatus?.currentlyAvailable < 200) await new Promise(res => setTimeout(res, 2000));
  return j;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [qf, vf] = process.argv.slice(2);
  const out = await shopifyRead(fs.readFileSync(qf, "utf8"), vf ? JSON.parse(fs.readFileSync(vf, "utf8")) : {});
  console.log(JSON.stringify(out, null, 1));
}
