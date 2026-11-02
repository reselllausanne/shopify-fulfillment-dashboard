#!/usr/bin/env npx tsx
/**
 * Lecture seule Google Ads (GAQL). Refuse tout ce qui ne commence pas par SELECT.
 * Usage : npx tsx audit-shopify/calculs/ads_gaql_readonly.ts <fichier.gaql> <sortie.json> [--flat]
 * Utilise adsanalytics/google/adsClient.searchAll (POST googleAds:search, aucune mutation).
 * Ne journalise jamais de secret.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { resolveAdsConfig } from "../../adsanalytics/config";
import { searchAll } from "../../adsanalytics/google/adsClient";

function flatten(o: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = o;
  return out;
}

async function main() {
  const [qFile, outFile, ...flags] = process.argv.slice(2);
  if (!qFile || !outFile) { console.error("usage: ads_gaql_readonly.ts q.gaql out.json [--flat]"); process.exit(2); }
  const query = fs.readFileSync(qFile, "utf8").trim();
  if (!/^select\b/i.test(query.replace(/--.*$/gm, "").trim())) { console.error("REFUS : SELECT uniquement"); process.exit(3); }
  const config = resolveAdsConfig();
  const t0 = Date.now();
  const { rows, stats } = await searchAll(config, query);
  const data = flags.includes("--flat") ? rows.map((r) => flatten(r)) : rows;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(data));
  console.log(`OK ${rows.length} lignes, ${stats.requests} req, ${stats.retries} retries, ${Date.now() - t0}ms -> ${outFile}`);
}
main().catch((e) => { console.error("ERREUR", String(e?.message ?? e).slice(0, 800)); process.exit(1); });
