#!/usr/bin/env node
/**
 * Build a representative, ISOLATED test database for the Warehouse module:
 *   1. baseline = current Prisma schema WITHOUT the warehouse section (what production has today),
 *      pushed with `prisma db push` (the historical migrations are not replayable from zero);
 *   2. every pre-existing migration is recorded as applied;
 *   3. `prisma migrate deploy` then applies ONLY the warehouse migration(s) — the exact path
 *      production will take.
 *
 * Usage: node scripts/warehouse/setup-test-db.mjs [--url <postgres url>]
 * Refuses to run against anything that is not localhost.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const require = createRequire(path.join(root, "package.json"));
const { Client } = require("pg");

const argUrl = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : null;
const url =
  argUrl ||
  process.env.WAREHOUSE_TEST_DATABASE_URL ||
  execFileSync(path.join(root, "scripts/warehouse/dev-db.sh"), ["url"], { encoding: "utf8" }).trim();

const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(`Refusing to set up a test DB on non-local host "${host}".`);
  process.exit(1);
}

const WAREHOUSE_MARKER = "// Warehouse module (Entrepôt) — lot 1.";
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const markerIdx = schema.indexOf(WAREHOUSE_MARKER);
if (markerIdx < 0) throw new Error("warehouse marker not found in prisma/schema.prisma");
const sectionStart = schema.lastIndexOf("// ────", markerIdx);
const baseline = schema
  .slice(0, sectionStart)
  .split("\n")
  .filter((line) => !/^\s*(warehouse\w+\s+Warehouse\w+\[\]|\/\/\/ Warehouse module \(lot 1\))/.test(line))
  .join("\n");

const tmp = mkdtempSync(path.join(tmpdir(), "wh-baseline-"));
const baselinePath = path.join(tmp, "schema.prisma");
writeFileSync(baselinePath, baseline);

const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
const run = (args) => execFileSync("npx", ["prisma", ...args], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });

const client = new Client({ connectionString: url.replace(/\?schema=public$/, "") });
await client.connect();
const existing = await client.query(
  `select count(*)::int as n from information_schema.tables where table_schema='public' and table_name='WarehouseUnit'`
);
if (existing.rows[0].n > 0) {
  console.log("Warehouse tables already present — nothing to do (use dev-db.sh reset to start over).");
  await client.end();
  process.exit(0);
}

console.log("1/3 baseline schema (prisma db push, warehouse section stripped)…");
run(["db", "push", "--schema", baselinePath, "--skip-generate", "--accept-data-loss"]);

console.log("2/3 recording pre-existing migrations as applied…");
await client.query(`
  create table if not exists _prisma_migrations (
    id varchar(36) primary key, checksum varchar(64) not null, finished_at timestamptz,
    migration_name varchar(255) not null, logs text, rolled_back_at timestamptz,
    started_at timestamptz not null default now(), applied_steps_count integer not null default 0)`);
const migrationsDir = path.join(root, "prisma/migrations");
const names = readdirSync(migrationsDir).filter((n) => existsSync(path.join(migrationsDir, n, "migration.sql"))).sort();
const pending = [];
for (const name of names) {
  if (/_warehouse_lot\d/.test(name)) {
    pending.push(name);
    continue;
  }
  const checksum = createHash("sha256").update(readFileSync(path.join(migrationsDir, name, "migration.sql"))).digest("hex");
  await client.query(
    `insert into _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count)
     select gen_random_uuid()::text, $1::varchar, now(), $2::varchar, 1
     where not exists (select 1 from _prisma_migrations where migration_name = $2::varchar)`,
    [checksum, name]
  );
}
await client.end();

console.log(`3/3 prisma migrate deploy (expected pending: ${pending.join(", ")})…`);
const started = Date.now();
const out = run(["migrate", "deploy"]);
console.log(out.split("\n").filter((l) => /Applying|applied|pending|No pending/i.test(l)).join("\n"));
console.log(`migrate deploy took ${Date.now() - started} ms`);
console.log(`\nTest database ready:\n  export WAREHOUSE_TEST_DATABASE_URL="${url}"`);
