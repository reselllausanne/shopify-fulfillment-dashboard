#!/usr/bin/env npx tsx
/**
 * Lecture seule Merchant API (reports:search = requêtes de lecture) pour une liste d'offer_id.
 * Usage : npx tsx audit-shopify/calculs/ads_merchant_batch.ts <offers.csv> <colonne_offer_id> <langue fr|de|en> <sortie.json>
 * Interroge product_view et price_competitiveness_product_view par lots (id IN (...)). Aucune écriture.
 */
import "dotenv/config";
import fs from "node:fs";
import { resolveMerchantOauthConfig } from "../../adsanalytics/config";
import { getAccessTokenForOAuth } from "../../adsanalytics/google/oauth";

const URL = "https://merchantapi.googleapis.com/reports/v1/accounts/669442699/reports:search";
async function q(token: string, query: string) {
  const out: any[] = []; let pageToken = "";
  do {
    const res = await fetch(URL, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query, pageSize: 1000, ...(pageToken ? { pageToken } : {}) }) });
    const t = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${t.slice(0, 300)}`);
    const j = JSON.parse(t); out.push(...(j.results ?? [])); pageToken = j.nextPageToken ?? "";
  } while (pageToken);
  return out;
}
async function main() {
  const [csv, col, lang, outFile] = process.argv.slice(2);
  const lines = fs.readFileSync(csv, "utf8").trim().split("\n"); const head = lines[0].split(",");
  const ci = head.indexOf(col);
  const ids = lines.slice(1).map((l) => l.split(",")[ci]).filter(Boolean).map((o) => o.replace(/^shopify_ch_/, "shopify_CH_"));
  const token = await getAccessTokenForOAuth(resolveMerchantOauthConfig());
  const pv: any[] = [], pc: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const list = ids.slice(i, i + 100).map((o) => `'${lang}~CH~${o}'`).join(",");
    pv.push(...await q(token, `SELECT id, offer_id, title, brand, gtin, availability, price, aggregated_reporting_context_status, click_potential, click_potential_rank, creation_time, expiration_date, item_group_id, item_issues, product_type_l1, category_l1 FROM product_view WHERE id IN (${list})`));
    pc.push(...await q(token, `SELECT id, offer_id, price, benchmark_price, report_country_code FROM price_competitiveness_product_view WHERE id IN (${list})`));
    if ((i / 100) % 5 === 0) console.error(`batch ${i}/${ids.length} pv=${pv.length} pc=${pc.length}`);
  }
  fs.writeFileSync(outFile, JSON.stringify({ requested: ids.length, product_view: pv, price_competitiveness: pc }));
  console.log(`OK requested=${ids.length} product_view=${pv.length} price_comp=${pc.length} -> ${outFile}`);
}
main().catch((e) => { console.error("ERREUR", String(e?.message ?? e).slice(0, 500)); process.exit(1); });
