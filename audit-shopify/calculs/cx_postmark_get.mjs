#!/usr/bin/env node
// Postmark API en LECTURE SEULE (GET uniquement). Usage: node cx_postmark_get.mjs "/server" [sortie.json]
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
require("dotenv").config({ path: path.join(root, ".env") });
export async function pget(p) {
  const tok = process.env.POSTMARK_SERVER_TOKEN;
  if (!tok) throw new Error("POSTMARK_SERVER_TOKEN absent");
  const r = await fetch("https://api.postmarkapp.com" + p, { method: "GET", headers: { "X-Postmark-Server-Token": tok, Accept: "application/json" } });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 500) }; }
  return { status: r.status, body: j };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [p, o] = process.argv.slice(2);
  const r = await pget(p); const s = JSON.stringify(r, null, 1);
  if (o) fs.writeFileSync(o, s); else console.log(s.slice(0, 4000));
}
