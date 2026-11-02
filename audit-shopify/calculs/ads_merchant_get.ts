#!/usr/bin/env npx tsx
/**
 * Lecture seule Merchant API : GET uniquement, hôte merchantapi.googleapis.com uniquement.
 * Usage : npx tsx audit-shopify/calculs/ads_merchant_get.ts "<chemin après https://merchantapi.googleapis.com/>" sortie.json [--all]
 *   --all : suit nextPageToken et concatène la première clé tableau trouvée.
 * Exception unique : POST sur .../reports:search (requête de lecture type SQL, aucune écriture) avec --query "<MQL>".
 * Jamais de PATCH/DELETE/insert ; ne journalise aucun secret.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { resolveMerchantOauthConfig } from "../../adsanalytics/config";
import { getAccessTokenForOAuth } from "../../adsanalytics/google/oauth";

async function main() {
  const [rel, outFile, ...flags] = process.argv.slice(2);
  if (!rel || !outFile) { console.error("usage: ads_merchant_get.ts <path> out.json [--all]"); process.exit(2); }
  const token = await getAccessTokenForOAuth(resolveMerchantOauthConfig());
  const all = flags.includes("--all");
  const qi = flags.indexOf("--query");
  const mql = qi >= 0 ? flags[qi + 1] : null;
  if (mql && !/\/reports:search$/.test(rel.split("?")[0])) { console.error("REFUS : POST autorisé seulement sur reports:search"); process.exit(3); }
  let pageToken = "";
  let acc: unknown[] = [];
  let key: string | null = null;
  let single: unknown = null;
  let pages = 0;
  do {
    const sep = rel.includes("?") ? "&" : "?";
    const url = `https://merchantapi.googleapis.com/${rel}${!mql && pageToken ? `${sep}pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = mql
      ? await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ query: mql, pageSize: 1000, ...(pageToken ? { pageToken } : {}) }) })
      : await fetch(url, { method: "GET", headers: { authorization: `Bearer ${token}` } });
    const text = await res.text();
    if (!res.ok) { console.error(`HTTP ${res.status}`, text.slice(0, 500)); process.exit(1); }
    const j = JSON.parse(text);
    pages++;
    if (!all) { single = j; break; }
    key = key ?? Object.keys(j).find((k) => Array.isArray(j[k])) ?? null;
    if (key) acc = acc.concat(j[key]);
    pageToken = j.nextPageToken ?? "";
    if (process.env.MAXPAGES && pages >= Number(process.env.MAXPAGES)) break;
  } while (pageToken);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(all ? acc : single));
  console.log(`OK pages=${pages} ${all ? `rows=${acc.length}` : ""} -> ${outFile}`);
}
main().catch((e) => { console.error("ERREUR", String(e?.message ?? e).slice(0, 500)); process.exit(1); });
