// URL Inspection API (lecture seule). Usage: GSC_KEY=... node seo_05_inspection.mjs liste.csv sortie.jsonl
import fs from "node:fs"; import { token, SITE } from "./gsc_lib.mjs";
const [inp, out] = process.argv.slice(2); const t = await token();
const lines = fs.readFileSync(inp, "utf8").trim().split("\n").slice(1).slice(+(process.env.START||0), process.env.END?+process.env.END:undefined).map(l => { const [g, u] = l.split(","); return { g, u }; });
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l).u) : []);
for (const { g, u } of lines) {
  if (done.has(u)) continue;
  const r = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify({ inspectionUrl: u, siteUrl: SITE, languageCode: "fr" }) });
  const j = await r.json(); fs.appendFileSync(out, JSON.stringify({ g, u, status: r.status, r: j.inspectionResult ?? j.error }) + "\n");
  if (r.status === 429) { console.log("429 stop"); break; } await new Promise(s => setTimeout(s, 700));
}
console.log("ok");
