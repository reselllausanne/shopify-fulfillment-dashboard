#!/usr/bin/env node
// Klaviyo API en LECTURE SEULE (GET uniquement). Usage: node cx_klaviyo_get.mjs "/api/lists?page[size]=50" [sortie.json]
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
require("dotenv").config({ path: path.join(root, ".env") });
export async function kget(p, rev = "2025-07-15") {
  const key = process.env.KLAVIYO_PRIVATE_API_KEY;
  if (!key) throw new Error("KLAVIYO_PRIVATE_API_KEY absent");
  const url = p.startsWith("http") ? p : "https://a.klaviyo.com" + p;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { method: "GET", headers: { Authorization: `Klaviyo-API-Key ${key}`, revision: rev, accept: "application/vnd.api+json" } });
    if (r.status === 429) { await new Promise(s => setTimeout(s, 2000 * (i + 1))); continue; }
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 500) }; }
    return { status: r.status, body: j };
  }
}
export async function kall(p, rev) { // pagination GET
  let out = [], next = p;
  while (next) { const r = await kget(next, rev); if (r.status !== 200) return { error: r }; out = out.concat(r.body.data || []); next = r.body.links?.next || null; }
  return { data: out };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [p, o] = process.argv.slice(2);
  const r = await kget(p);
  const s = JSON.stringify(r, null, 1);
  if (o) fs.writeFileSync(o, s); else console.log(s.slice(0, 4000));
}
