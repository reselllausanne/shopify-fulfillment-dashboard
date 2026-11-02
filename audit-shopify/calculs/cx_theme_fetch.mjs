// Lecture seule : liste complète des fichiers du thème MAIN + téléchargement local des fichiers utiles à l'audit parcours (§8).
import fs from "node:fs"; import { shopifyRead } from "./shopify_readonly.mjs";
const T = "gid://shopify/OnlineStoreTheme/188549300610"; const D = "audit-shopify/donnees_brutes/site/theme/"; fs.mkdirSync(D, { recursive: true });
let after = null, all = [];
for (;;) {
  const j = await shopifyRead(`query($id:ID!,$after:String){ theme(id:$id){ files(first:250, after:$after){ nodes{ filename size updatedAt } pageInfo{hasNextPage endCursor} } } }`, { id: T, after });
  if (j.errors) { console.log(JSON.stringify(j.errors).slice(0, 300)); break; }
  const f = j.data.theme.files; all = all.concat(f.nodes); if (!f.pageInfo.hasNextPage) break; after = f.pageInfo.endCursor;
}
fs.writeFileSync(D + "_filelist.json", JSON.stringify(all)); console.log("files", all.length);
const pick = all.filter(f => /^(sections|snippets|templates|layout|assets|config|locales)/.test(f.filename) && /(main-product|product|deliver|shipping|size|express|cart|announcement|trust|return|reviews|filters|search|header|theme\.liquid|settings_data|fr\.json|en\.default|pixel|track|funnel|checkout|wishlist|stock|availability)/i.test(f.filename) && !/collection-plp-(seo|faq)/.test(f.filename) && f.size < 150000 && !/ 2\./.test(f.filename));
console.log("pick", pick.length);
for (let i = 0; i < pick.length; i += 10) {
  const names = pick.slice(i, i + 10).map(f => f.filename);
  const j = await shopifyRead(`query($id:ID!,$n:[String!]!){ theme(id:$id){ files(filenames:$n, first:10){ nodes{ filename body{ ... on OnlineStoreThemeFileBodyText{ content } } } } } }`, { id: T, n: names });
  if (j.errors) { console.log("ERR", JSON.stringify(j.errors).slice(0, 200)); continue; }
  for (const n of j.data.theme.files.nodes) if (n.body?.content != null) fs.writeFileSync(D + n.filename.replace(/\//g, "__"), n.body.content);
}
console.log("done", fs.readdirSync(D).length);
