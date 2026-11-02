#!/usr/bin/env node
// Extraction SQL en LECTURE SEULE (transaction READ ONLY, SELECT/WITH uniquement).
// Usage : node audit-shopify/calculs/db_readonly.mjs <fichier.sql> <sortie.csv|sortie.json>
// Lit DIRECT_URL (ou DATABASE_URL) dans .env. Ne journalise jamais l'URL.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
require("dotenv").config({ path: path.join(root, ".env") });
const { Client } = require("pg");

const [sqlFile, outFile] = process.argv.slice(2);
if (!sqlFile || !outFile) { console.error("usage: db_readonly.mjs file.sql out.(csv|json)"); process.exit(2); }
const sql = fs.readFileSync(sqlFile, "utf8").trim().replace(/;\s*$/, "");
const stripped = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
if (!/^(select|with)\b/i.test(stripped)) { console.error("REFUS : seules les requêtes SELECT/WITH sont autorisées"); process.exit(3); }
if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do)\b\s/i.test(stripped.replace(/'[^']*'/g, "''")) ) {
  // heuristique prudente ; la transaction READ ONLY reste la vraie protection
  console.error("AVERTISSEMENT : mot-clé d'écriture détecté dans la requête ; exécution quand même en READ ONLY");
}
const url = (process.env.DIRECT_URL || process.env.DATABASE_URL || "").replace(/[?&]pgbouncer=true/, "").replace(/&connection_limit=\d+/, "").replace(/&pool_timeout=\d+/, "").replace(/[?&]sslmode=[a-z-]+/, "");
const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
await c.connect();
try {
  await c.query("BEGIN READ ONLY");
  const r = await c.query(sql);
  await c.query("ROLLBACK");
  const rows = r.rows;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (outFile.endsWith(".json")) fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
  else {
    const cols = r.fields.map(f => f.name);
    const esc = v => v == null ? "" : (v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v));
    const q = s => /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    fs.writeFileSync(outFile, [cols.join(","), ...rows.map(row => cols.map(k => q(esc(row[k]))).join(","))].join("\n") + "\n");
  }
  if (process.env.SHOW) { const n=+process.env.SHOW; const cols=r.fields.map(f=>f.name); console.log(cols.join(" | ")); for (const row of rows.slice(0,n)) console.log(cols.map(k=>{const v=row[k]; return v==null?"":(v instanceof Date?v.toISOString().slice(0,19):typeof v==="object"?JSON.stringify(v):String(v))}).join(" | ")); }
  console.log(`OK ${rows.length} lignes -> ${outFile} (${new Date().toISOString()})`);
} finally { await c.end(); }
