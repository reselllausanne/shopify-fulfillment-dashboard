// Lecture seule : compare, entre deux thèmes, la présence des boutons de paiement accéléré (payment_button / additional_checkout_buttons).
import fs from "node:fs"; import { shopifyRead } from "./shopify_readonly.mjs";
const T = { main: "gid://shopify/OnlineStoreTheme/189546496386", prev: "gid://shopify/OnlineStoreTheme/188549300610" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function q(query, v) { let j; for (let t = 0; t < 10; t++) { j = await shopifyRead(query, v); if (j.errors?.[0]?.extensions?.code === "THROTTLED") { await sleep(3000); continue; } break; } return j; }
const res = {};
for (const [k, id] of Object.entries(T)) {
  const names = []; let c = null;
  for (;;) { const j = await q(`query($id:ID!,$c:String){ theme(id:$id){ files(first:250, after:$c){ pageInfo{hasNextPage endCursor} nodes{ filename size } } } }`, { id, c }); if (j.errors) { console.error(k, JSON.stringify(j.errors).slice(0, 200)); break; }
    const f = j.data.theme.files; names.push(...f.nodes.map(n => n.filename)); if (!f.pageInfo.hasNextPage) break; c = f.pageInfo.endCursor; }
  const cand = names.filter(n => /^(sections|snippets|blocks|templates)\//.test(n) && /(cart|buy|payment|checkout|product-form|main-product|product-info|dynamic)/i.test(n));
  const hits = {}; let fetched = 0;
  for (let i = 0; i < cand.length; i += 10) {
    const part = cand.slice(i, i + 10);
    const j = await q(`query($id:ID!,$f:[String!]!){ theme(id:$id){ files(filenames:$f, first:10){ nodes{ filename body{ ... on OnlineStoreThemeFileBodyText{ content } } } } } }`, { id, f: part });
    if (j.errors) { console.error(k, JSON.stringify(j.errors).slice(0, 150)); continue; }
    for (const n of j.data.theme.files.nodes) { fetched++; const t = n.body?.content || ""; const m = t.match(/payment_button|additional_checkout_buttons|dynamic_checkout|shopify-payment-button|accelerated/gi); if (m) hits[n.filename] = [...new Set(m.map(x => x.toLowerCase()))]; }
    await sleep(500);
  }
  res[k] = { files: names.length, candidates: cand.length, fetched, hits }; console.log(k, names.length, "fichiers,", cand.length, "candidats,", Object.keys(hits).length, "avec boutons paiement:", JSON.stringify(hits).slice(0, 700));
}
fs.writeFileSync("/tmp/theme_wallet.json", JSON.stringify(res));
