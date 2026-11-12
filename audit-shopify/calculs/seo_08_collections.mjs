// Lecture seule : toutes les collections (handle, updatedAt, nb produits, publiée, smart) -> donnees_brutes/site/collections.ndjson
import fs from "node:fs"; import { shopifyRead } from "./shopify_readonly.mjs";
const Q = `query($c:String){ collections(first:250, after:$c){ pageInfo{hasNextPage endCursor} nodes{ handle title updatedAt productsCount{count} ruleSet{appliedDisjunctively} sortOrder } } }`;
let c = null, n = 0; const out = fs.createWriteStream("audit-shopify/donnees_brutes/site/collections.ndjson");
for (;;) { const j = await shopifyRead(Q, { c }); if (j.errors) { console.error(JSON.stringify(j.errors).slice(0, 400)); break; }
  for (const x of j.data.collections.nodes) { out.write(JSON.stringify({ h: x.handle, t: x.title, u: x.updatedAt, n: x.productsCount?.count, smart: !!x.ruleSet }) + "\n"); n++; }
  const p = j.data.collections.pageInfo; if (!p.hasNextPage) break; c = p.endCursor; }
out.end(); console.log("collections", n);
