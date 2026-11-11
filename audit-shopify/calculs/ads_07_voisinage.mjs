// Lecture seule (BEGIN READ ONLY). Deux analyses sur les produits Google Ads / Shopify :
//  (1) quasi-expérience Explorer stratifiée par semaine de création Shopify (âge réel, fichiers produits par ads_07_shopify_created.mjs) ;
//  (2) méthode de voisinage : score d'un produit sans historique depuis ses voisins (marque | type | sous-type | modèle),
//      rétrécissement hiérarchique, backtest sur 07.08-10.11.
// Usage (depuis le worktree, .env présent) :
//   node audit-shopify/calculs/ads_07_shopify_created.mjs
//   node audit-shopify/calculs/ads_07_shopify_created.mjs "created_at:>=2026-07-08" audit-shopify/donnees_brutes/ads/shopify_product_created_recent.json
//   node audit-shopify/calculs/ads_07_voisinage.mjs
import fs from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split("\n").filter(l => /^[A-Z_]+=/.test(l)).map(l => {
    const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
  })
);
const client = new pg.Client({
  connectionString: (env.DIRECT_URL || env.DATABASE_URL).replace(/[?&]sslmode=[^&]*/, "").replace(/[?&]pgbouncer=[^&]*/, ""),
  ssl: { rejectUnauthorized: false },
});
await client.connect();
await client.query("BEGIN READ ONLY");
await client.query("SET LOCAL statement_timeout = '600000'");

const CUT = "2026-08-07", END = "2026-11-10";
const MAIN = "(campaign_name not ilike 'explorer%' and campaign_name not ilike 'long tail%')";

console.error("1/3 produits (catalogue courant)...");
const prods = (await client.query(`
  select shopify_product_id::text id,
         lower(max(brand)) brand, lower(max(custom_attr0)) ty, lower(max(custom_attr2)) sub, lower(max(title)) title,
         bool_or(upper(availability)='IN_STOCK' and upper(status)='ELIGIBLE') ok,
         max(custom_attr3) label
  from ads_shopping_product_current
  where is_current and shopify_product_id is not null
  group by 1`)).rows;

console.error("2/3 performance par produit...");
const perf = (await client.query(`
  select shopify_product_id::text id,
    sum(impressions) filter (where date < '${CUT}' and date >= '2026-01-01') pre_imp,
    sum(impressions) filter (where date >= '2026-07-01' and date < '${CUT}') jul_imp,
    sum(clicks) filter (where date < '${CUT}' and date >= '2026-01-01') pre_clk,
    sum(conversions) filter (where date < '${CUT}' and date >= '2026-01-01') pre_conv,
    sum(conversion_value) filter (where date < '${CUT}' and date >= '2026-01-01') pre_val,
    sum(impressions) filter (where date >= '${CUT}' and date <= '${END}' and ${MAIN}) post_imp,
    sum(clicks) filter (where date >= '${CUT}' and date <= '${END}' and ${MAIN}) post_clk,
    sum(cost_micros) filter (where date >= '${CUT}' and date <= '${END}' and ${MAIN})/1e6 post_cost,
    sum(conversions) filter (where date >= '${CUT}' and date <= '${END}' and ${MAIN}) post_conv,
    sum(conversion_value) filter (where date >= '${CUT}' and date <= '${END}' and ${MAIN}) post_val,
    sum(cost_micros) filter (where date >= '${CUT}' and date <= '${END}' and not ${MAIN})/1e6 ex_cost,
    sum(conversions) filter (where date >= '${CUT}' and date <= '${END}' and not ${MAIN}) ex_conv,
    sum(conversion_value) filter (where date >= '${CUT}' and date <= '${END}' and not ${MAIN}) ex_val,
    sum(impressions) filter (where date > '2026-10-10' and date <= '${END}') imp30,
    sum(conversions) filter (where date >= '2026-01-01' and date <= '${END}') all_conv,
    sum(clicks) filter (where date >= '2026-01-01' and date <= '${END}') all_clk,
    sum(conversion_value) filter (where date >= '2026-01-01' and date <= '${END}') all_val
  from ads_product_daily
  where shopify_product_id is not null and date >= '2026-01-01' and date <= '${END}'
  group by 1`)).rows;
const touched = new Set((await client.query(`select distinct shopify_product_id::text id from ads_explorer_batch_models`)).rows.map(r => r.id));
await client.query("ROLLBACK");
await client.end();

const rd = f => JSON.parse(fs.readFileSync(f, "utf8"));
const ages = new Map([
  ...rd("audit-shopify/donnees_brutes/ads/shopify_product_created.json"),
  ...rd("audit-shopify/donnees_brutes/ads/shopify_product_created_recent.json"),
].map(([id, c]) => [id, new Date(c).getTime()]));

const num = x => (x == null ? 0 : Number(x));
const P = new Map(prods.map(p => [p.id, { ...p }]));
for (const r of perf) { const p = P.get(r.id); if (p) for (const k of Object.keys(r)) if (k !== "id") p[k] = num(r[k]); }
const A = [...P.values()];
const NUMF = ["pre_imp", "jul_imp", "pre_clk", "pre_conv", "pre_val", "post_imp", "post_clk", "post_cost", "post_conv", "post_val", "ex_cost", "ex_conv", "ex_val", "imp30", "all_conv", "all_clk", "all_val"];
for (const p of A) {
  for (const k of NUMF) p[k] = num(p[k]);
  p.model = (p.title || "").split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  p.touched = touched.has(p.id);
  p.created = ages.get(p.id) ?? null;
  p.cweek = p.created ? new Date(p.created - ((new Date(p.created).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10) : "?";
  p.k3 = `${p.brand}|${p.ty}`; p.k2 = `${p.k3}|${p.sub}`; p.k1 = `${p.k2}|${p.model}`;
  p.one = 1;
}

const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const fmt = (x, d = 1) => Number(x).toFixed(d);
const ROUTED = /long_tail|explorer|ads_excluded/;

// Score hiérarchique : (somme num + K * prior) / (somme den + K), niveaux marque|type -> +sous-type -> +modèle.
function buildScores(denField, numField, K) {
  const agg = key => { const m = new Map(); for (const p of A) { const g = m.get(p[key]) || { d: 0, n: 0 }; g.d += p[denField]; g.n += p[numField]; m.set(p[key], g); } return m; };
  const g3 = agg("k3"), g2 = agg("k2"), g1 = agg("k1");
  const s0 = sum(A, p => p[numField]) / sum(A, p => p[denField]);
  const sh = (g, prior) => g ? (g.n + K * prior) / (g.d + K) : prior;
  for (const p of A) { const s3 = sh(g3.get(p.k3), s0), s2 = sh(g2.get(p.k2), s3); p.score = sh(g1.get(p.k1), s2); p.nd1 = (g1.get(p.k1) || { d: 0 }).d; }
  return s0;
}
const bins = (arr, n) => {
  const s = [...arr].sort((a, b) => (a.score - b.score) || (a.id < b.id ? -1 : 1));
  return Array.from({ length: n }, (_, i) => s.slice(Math.floor(i * s.length / n), Math.floor((i + 1) * s.length / n)));
};
const tot = x => ({ n: x.length, imp: x.filter(p => p.post_imp > 0).length, cost: sum(x, p => p.post_cost + p.ex_cost), conv: sum(x, p => p.post_conv + p.ex_conv), val: sum(x, p => p.post_val + p.ex_val) });

const lines = [`# ads_07 : âge réel du produit, quasi-expérience stratifiée, méthode de voisinage (F, lecture seule)\n`];

// ========== A. Âge des produits ==========
const poolEvery = A.filter(p => p.ok && p.jul_imp === 0 && p.pre_conv === 0);
lines.push(`## A. Pool zéro historique (en stock, ELIGIBLE, 0 impression du 01.07 au 06.08, 0 conversion en 2026 avant le 07.08)\n`);
lines.push(`Produits : ${poolEvery.length}. Créés avant le 08.07 : ${poolEvery.filter(p => p.created != null && p.created < Date.parse("2026-07-08")).length}. Créés du 08.07 au 06.08 : ${poolEvery.filter(p => p.created != null && p.created >= Date.parse("2026-07-08") && p.created < Date.parse("2026-08-07")).length}. Créés depuis le 07.08 : ${poolEvery.filter(p => p.created != null && p.created >= Date.parse("2026-08-07")).length}. Date inconnue : ${poolEvery.filter(p => p.created == null).length}.\n`);

// ========== B. SUPPRIMÉE ==========
// La quasi-expérience « touchés contre non touchés à semaine de création égale » est biaisée : Explorer exige 0 impression sur 30 jours et 0 conversion
// avant la date du lot ; les non touchés incluent des produits qui ont reçu des impressions et converti avant cette date. Voir ads_08 (étude par lot).
lines.push(`## B. Comparaison touchés / non touchés : voir ads_08 (étude par lot corrigée du biais de sélection)\n`);

// ========== C. Voisinage : backtest ==========
const s0 = buildScores("pre_clk", "pre_val", 200);
const trainPool = poolEvery.filter(p => p.created != null && p.created < Date.parse(CUT)); // existait avant le test
const un = trainPool.filter(p => !p.touched);
lines.push(`## C. Méthode de voisinage : backtest\n`);
lines.push(`Entraînement : 01.01-06.08 (tous les produits du catalogue courant). Test : ${CUT} → ${END}, campagnes main, produits non touchés par Explorer qui existaient déjà le 07.08 (n=${un.length}). Prior global valeur/clic ${fmt(s0, 2)} CHF.\n`);
lines.push(`| score | Q1 (bas) | Q2 | Q3 | Q4 | Q5 (haut) | Q5 / Q1 |\n|---|---|---|---|---|---|---|`);
const variants = [
  ["valeur par clic des voisins (K=200 clics)", () => buildScores("pre_clk", "pre_val", 200)],
  ["conversions par produit des voisins (K=50)", () => buildScores("one", "pre_conv", 50)],
  ["clics par produit des voisins (K=50)", () => buildScores("one", "pre_clk", 50)],
  ["valeur par produit des voisins (K=50)", () => buildScores("one", "pre_val", 50)],
];
for (const [name, fn] of variants) {
  fn();
  const b = bins(un, 5).map(x => 1000 * sum(x, p => p.post_conv) / x.length);
  lines.push(`| ${name} | ${b.map(v => fmt(v, 1)).join(" | ")} | ${fmt(b[4] / (b[0] || NaN), 2)} |`);
}
lines.push(`\n(valeurs : conversions en main pour 1 000 produits sur la période de test)\n`);

// Détail du meilleur schéma : conversions par produit
buildScores("one", "pre_conv", 50);
lines.push(`### Détail, score = conversions par produit des voisins\n`);
lines.push(`| quintile | produits | score moyen | % avec impressions | clics | coût | conv. | valeur | conv./1 000 produits |\n|---|---|---|---|---|---|---|---|---|`);
bins(un, 5).forEach((b, i) => {
  lines.push(`| Q${i + 1} | ${b.length} | ${fmt(1000 * sum(b, p => p.score) / b.length, 1)} ‰ | ${fmt(100 * b.filter(p => p.post_imp > 0).length / b.length, 0)} % | ${fmt(sum(b, p => p.post_clk), 0)} | ${fmt(sum(b, p => p.post_cost), 0)} | ${fmt(sum(b, p => p.post_conv), 1)} | ${fmt(sum(b, p => p.post_val), 0)} | ${fmt(1000 * sum(b, p => p.post_conv) / b.length, 1)} |`);
});
// Les touchés par Explorer avaient-ils un score plus bas ?
const to = trainPool.filter(p => p.touched);
const med = a => { const s = a.map(p => p.score).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
lines.push(`\nScore médian (conv. par produit des voisins, en ‰) : non touchés ${fmt(1000 * med(un), 2)}, touchés ${fmt(1000 * med(to), 2)} (n=${to.length}).\n`);

// ========== D. Classement actuel ==========
buildScores("one", "all_conv", 50);
const cand = A.filter(p => p.ok && p.all_conv === 0);
const ranked = [...cand].sort((a, b) => b.score - a.score);
const topN = ranked.slice(0, 5000);
lines.push(`## D. Classement actuel (entraînement 01.01-10.11, score = conversions par produit des voisins)\n`);
lines.push(`Produits en stock, ELIGIBLE, sans conversion Ads en 2026 : ${cand.length}. Avec label routé (long_tail / explorer / ads_excluded) : ${cand.filter(p => ROUTED.test(p.label || "")).length}.`);
lines.push(`Parmi les 5 000 mieux notés : ${topN.filter(p => ROUTED.test(p.label || "")).length} avec label routé (hors main), ${topN.filter(p => p.imp30 === 0).length} sans aucune impression sur 30 jours.\n`);
fs.writeFileSync("audit-shopify/analyses/ads_07_voisinage.md", lines.join("\n"));
fs.writeFileSync("audit-shopify/tableaux/ads_07_voisinage_top5000.csv",
  "rang,shopify_product_id,marque,type,sous_type,modele,score_conv_par_produit_voisins,label,impressions_30j,touche_explorer,cree_le\n" +
  topN.map((p, i) => [i + 1, p.id, p.brand, p.ty, p.sub, `"${p.model.replace(/"/g, "")}"`, fmt(p.score, 5), p.label || "", p.imp30, p.touched ? 1 : 0, p.created ? new Date(p.created).toISOString().slice(0, 10) : ""].join(",")).join("\n"));
console.log(lines.join("\n"));
