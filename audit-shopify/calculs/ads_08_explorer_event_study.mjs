// Lecture seule. Étude par lot : produits choisis par Explorer (traités) contre produits éligibles au même moment et non choisis (contrôle).
// Règle d'éligibilité reproduite à la date T du lot (semaines complètes avant T) :
//   créé sur Shopify ≥ 30 jours avant T ; 0 impression pendant les 4 semaines complètes avant T ; 0 conversion Ads avant T ; en stock et ELIGIBLE (état courant).
// Résultat : toutes campagnes confondues (main + Explorer + Long Tail), 4 semaines complètes après la semaine de T.
// Contrôle : jamais choisi avant T ; si choisi plus tard à T2, ses semaines ≥ T2 sont retirées (pas de biais de survie).
// Usage : node audit-shopify/calculs/ads_08_explorer_event_study.mjs (depuis le worktree, .env + fichiers de dates de création présents)
import fs from "node:fs";
import pg from "pg";

const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const client = new pg.Client({ connectionString: (env.DIRECT_URL || env.DATABASE_URL).replace(/[?&]sslmode=[^&]*/, "").replace(/[?&]pgbouncer=[^&]*/, ""), ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query("BEGIN READ ONLY");
await client.query("SET LOCAL statement_timeout = '900000'");

const W0 = Date.parse("2026-01-05"); // lundi
const WK = 7 * 86400000;
const widx = d => Math.floor((Date.parse(d) - W0) / WK);
const NW = widx("2026-11-09") + 1;

console.error("catalogue...");
const cur = (await client.query(`select shopify_product_id::text id, lower(max(brand)) brand, bool_or(upper(availability)='IN_STOCK' and upper(status)='ELIGIBLE') ok from ads_shopping_product_current where is_current and shopify_product_id is not null group by 1`)).rows;
console.error("lots...");
const batches = (await client.query(`select id, (planned_at at time zone 'Europe/Zurich')::date::text planned, status from ads_explorer_batches where status in ('completed','active') order by planned_at`)).rows;
const models = (await client.query(`select batch_id, shopify_product_id::text id from ads_explorer_batch_models`)).rows;
console.error("hebdo...");
const weekly = (await client.query(`select shopify_product_id::text id, (date_trunc('week', date))::date::text w, sum(impressions) imp, sum(clicks) clk, sum(conversions) conv, sum(conversion_value) val, sum(cost_micros)/1e6 cost from ads_product_daily where shopify_product_id is not null and date >= '2026-01-05' and date < '2026-11-10' group by 1,2`)).rows;
await client.query("ROLLBACK");
await client.end();

const rd = f => JSON.parse(fs.readFileSync(f, "utf8"));
const created = new Map([...rd("audit-shopify/donnees_brutes/ads/shopify_product_created.json"), ...rd("audit-shopify/donnees_brutes/ads/shopify_product_created_recent.json")].map(([id, c]) => [id, Date.parse(c)]));

const S = new Map(); // id -> {imp,conv,val,cost}: Float64Array(NW)
for (const r of weekly) {
  const k = widx(r.w); if (k < 0 || k >= NW) continue;
  let o = S.get(r.id); if (!o) { o = { imp: new Float64Array(NW), conv: new Float64Array(NW), val: new Float64Array(NW), cost: new Float64Array(NW) }; S.set(r.id, o); }
  o.imp[k] += +r.imp; o.conv[k] += +r.conv; o.val[k] += +r.val; o.cost[k] += +r.cost;
}
const Z = { imp: new Float64Array(NW), conv: new Float64Array(NW), val: new Float64Array(NW), cost: new Float64Array(NW) };
const get = id => S.get(id) || Z;
const catalog = new Map(cur.filter(c => c.ok).map(c => [c.id, c]));

// première date de sélection par produit
const bPlanned = new Map(batches.map(b => [b.id, b.planned]));
const firstTouch = new Map(); // id -> week index
for (const m of models) { const p = bPlanned.get(m.batch_id); if (!p) continue; const k = Math.floor((Date.parse(p) - W0) / WK); const v = firstTouch.get(m.id); if (v == null || k < v) firstTouch.set(m.id, k); }
const treatedByBatch = new Map();
for (const m of models) { if (!bPlanned.has(m.batch_id)) continue; (treatedByBatch.get(m.batch_id) || treatedByBatch.set(m.batch_id, []).get(m.batch_id)).push(m.id); }

const sumRange = (a, i, j) => { let t = 0; for (let k = i; k <= j; k++) t += a[k] || 0; return t; };
const eligible = (id, T, kT) => {
  const c = created.get(id); if (c == null || c > T - 30 * 86400000) return false;
  const o = get(id);
  if (sumRange(o.imp, kT - 4, kT - 1) > 0) return false;      // 0 impression, 4 semaines complètes avant T
  if (sumRange(o.conv, 0, kT - 1) > 0) return false;           // 0 conversion avant T
  return true;
};
const bg = b => ["nike", "adidas", "jordan"].includes(b) ? b : "autres";

const agg = () => ({ n: 0, pw: 0, imp: 0, conv: 0, val: 0, cost: 0, served: 0 });
const add = (g, id, k0, k1) => { // fenêtre [k0,k1]
  const o = get(id); g.n++; g.pw += k1 - k0 + 1; const im = sumRange(o.imp, k0, k1); if (im > 0) g.served++;
  g.imp += im; g.conv += sumRange(o.conv, k0, k1); g.val += sumRange(o.val, k0, k1); g.cost += sumRange(o.cost, k0, k1);
};
const R = { T: {}, C: {} }; const groups = ["tous", "nike", "adidas", "jordan", "autres"];
for (const t of ["T", "C"]) for (const g of groups) R[t][g] = agg();
const perBatch = [];
const LASTK = NW - 1;
for (const b of batches) {
  const T = Date.parse(b.planned), kT = Math.floor((T - W0) / WK);
  const k0 = kT + 1, k1 = Math.min(kT + 4, LASTK);          // 4 semaines complètes après la semaine de T
  if (k1 < k0 + 1) continue;                                  // fenêtre trop courte
  const tr = (treatedByBatch.get(b.id) || []).filter(id => catalog.has(id) && eligible(id, T, kT));
  const trSet = new Set(tr);
  const ctrl = [];
  for (const [id, c] of catalog) {
    if (trSet.has(id)) continue;
    const ft = firstTouch.get(id);
    if (ft != null && ft <= kT) continue;                     // déjà choisi à ou avant T
    if (!eligible(id, T, kT)) continue;
    ctrl.push(id);
  }
  const gb = { T: agg(), C: agg() };
  for (const id of tr) { const g = bg(catalog.get(id).brand); add(R.T.tous, id, k0, k1); add(R.T[g], id, k0, k1); add(gb.T, id, k0, k1); }
  for (const id of ctrl) {
    const ft = firstTouch.get(id); const kk1 = ft != null ? Math.min(k1, ft - 1) : k1; if (kk1 < k0) continue;
    const g = bg(catalog.get(id).brand); add(R.C.tous, id, k0, kk1); add(R.C[g], id, k0, kk1); add(gb.C, id, k0, kk1);
  }
  perBatch.push([b.planned, b.id.slice(0, 8), tr.length, ctrl.length, gb.T, gb.C]);
}
const f = (x, d = 1) => Number(x).toFixed(d);
const row = (name, t, c) => `| ${name} | ${t.n} | ${c.n} | ${f(100 * t.served / (t.n || 1), 0)} % / ${f(100 * c.served / (c.n || 1), 0)} % | ${f(1000 * 4 * t.conv / (t.pw || 1), 1)} | ${f(1000 * 4 * c.conv / (c.pw || 1), 1)} | ${f(t.cost, 0)} / ${f(t.val, 0)} | ${f(c.cost, 0)} / ${f(c.val, 0)} |`;
const L = [];
L.push(`# ads_08 : Explorer, étude par lot (F, lecture seule)\n`);
L.push(`Traités : produits des lots completed/active qui respectent l'éligibilité reproduite à la date T du lot. Contrôle : produits non choisis, éligibles au même T, jamais choisis avant T (semaines à partir de leur choix retirées). Résultat : toutes campagnes, 4 semaines complètes après la semaine de T (fenêtre réduite pour les lots récents). Produits : en stock et ELIGIBLE, état courant.\n`);
L.push(`Taux ramenés à 1 000 produits sur 4 semaines.\n`);
L.push(`| groupe | traités (produit-lot) | contrôles (produit-lot) | % avec impressions (traités / contrôles) | conv./1 000 (traités) | conv./1 000 (contrôles) | coût / valeur traités | coût / valeur contrôles |`);
L.push(`|---|---|---|---|---|---|---|---|`);
for (const g of groups) L.push(row(g, R.T[g], R.C[g]));
L.push(`\n## Par lot\n`);
L.push(`| date | lot | traités | contrôles | conv./1 000 traités | conv./1 000 contrôles | % impr. traités | % impr. contrôles |\n|---|---|---|---|---|---|---|---|`);
for (const [d, id, nt, nc, t, c] of perBatch) if (nt >= 20) L.push(`| ${d} | ${id} | ${nt} | ${nc} | ${f(1000 * 4 * t.conv / (t.pw || 1), 1)} | ${f(1000 * 4 * c.conv / (c.pw || 1), 1)} | ${f(100 * t.served / (t.n || 1), 0)} % | ${f(100 * c.served / (c.n || 1), 0)} % |`);
fs.writeFileSync("audit-shopify/analyses/ads_08_explorer_event_study.md", L.join("\n") + "\n");
console.log(L.join("\n"));
