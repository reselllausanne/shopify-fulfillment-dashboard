// Lecture seule : par semaine, nombre de pages distinctes avec impressions/clics (par type) -> tableaux/seo_07_pages_hebdo.csv
import fs from "node:fs"; import { token, SITE } from "./gsc_lib.mjs";
const t = await token(); const out = ["sem,type,pages,pages_clic,imp,clk"];
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
for (let w = "2026-08-03"; w <= "2026-11-02"; w = addDays(w, 7)) {
  const rows = []; for (let s = 0; s < 400000; s += 25000) {
    const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ startDate: w, endDate: addDays(w, 6), dimensions: ["page"], rowLimit: 25000, startRow: s, dataState: "final" }) });
    const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error)); const rs = j.rows || []; rows.push(...rs); if (rs.length < 25000) break;
  }
  const g = {}; for (const r of rows) { const p = r.keys[0].replace(/^https?:\/\/[^/]+/, "").replace(/^\/(en|de|fr-fr|it)(\/|$)/, "/"); const ty = (p.match(/^\/(products|collections|pages|blogs)/) || [, "home"])[1]; const e = g[ty] ||= { p: 0, pc: 0, i: 0, c: 0 }; e.p++; if (r.clicks > 0) e.pc++; e.i += r.impressions; e.c += r.clicks; }
  for (const [ty, e] of Object.entries(g)) out.push(`${w},${ty},${e.p},${e.pc},${e.i},${e.c}`); console.log(w, rows.length);
}
fs.writeFileSync("audit-shopify/tableaux/seo_07_pages_hebdo.csv", out.join("\n"));
