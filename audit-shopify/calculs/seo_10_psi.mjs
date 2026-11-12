// PageSpeed Insights (lecture seule). Clé dans ~/secrets/psi.key (hors repo, jamais affichée). Usage: node seo_10_psi.mjs
// Sorties : tableaux/seo_10_psi.csv (labo Lighthouse + terrain CrUX si dispo)
import fs from "node:fs";
const key = fs.readFileSync(`${process.env.HOME}/secrets/psi.key`, "utf8").trim();
const base = "https://www.resell-lausanne.ch";
const urls = ["/", "/collections/alo-yoga", "/collections/nike-air-max-plus-tn", "/products/adidas-xlg-runner-deluxe-white-black", "/products/converse-chuck-taylor-all-star-throwback-low-waxed-denim-black", "/cart"];
const rows = ["url,strategie,perf,lcp_s,tbt_ms,cls,ttfb_ms,poids_ko,terrain_lcp_ms,terrain_lcp_cat,terrain_inp_ms,terrain_inp_cat,terrain_cls,terrain_cls_cat,origine_lcp_cat,origine_inp_cat,origine_cls_cat"];
for (const u of urls) for (const s of ["mobile", "desktop"]) {
  const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(base + u)}&strategy=${s}&category=performance&key=${key}`);
  const j = await r.json(); if (j.error) { console.log(u, s, r.status, (j.error.message || "").replace(key, "***").slice(0, 160)); continue; }
  const a = j.lighthouseResult.audits, m = j.loadingExperience?.metrics || {}, o = j.originLoadingExperience?.metrics || {};
  const g = (x, k) => [x[k]?.percentile ?? "", x[k]?.category ?? ""];
  rows.push([u, s, j.lighthouseResult.categories.performance.score, (a["largest-contentful-paint"].numericValue / 1000).toFixed(2), Math.round(a["total-blocking-time"].numericValue), a["cumulative-layout-shift"].numericValue.toFixed(3), Math.round(a["server-response-time"]?.numericValue ?? 0), Math.round((a["total-byte-weight"]?.numericValue ?? 0) / 1024), ...g(m, "LARGEST_CONTENTFUL_PAINT_MS"), ...g(m, "INTERACTION_TO_NEXT_PAINT"), ...g(m, "CUMULATIVE_LAYOUT_SHIFT_SCORE"), o.LARGEST_CONTENTFUL_PAINT_MS?.category ?? "", o.INTERACTION_TO_NEXT_PAINT?.category ?? "", o.CUMULATIVE_LAYOUT_SHIFT_SCORE?.category ?? ""].join(","));
  console.log(u, s, "ok");
}
fs.writeFileSync("tableaux/seo_10_psi.csv", rows.join("\n"));
