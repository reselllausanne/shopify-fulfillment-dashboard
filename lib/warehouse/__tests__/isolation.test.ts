import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import * as batches from "../batches";
import * as pricing from "../pricing";
import * as printing from "../printing";
import * as putaway from "../putaway";
import * as units from "../units";
import { randomUUID } from "node:crypto";
import * as items from "../items";
import { HAS_DB, admin, closeTestDb, makeItem, makeReceivingBatch, makeWorld, op, randomGtin, receiveOne, testDb } from "./harness";

/**
 * Non-regression guard of roadmap §9: "no Shopify / Galaxus / EDI / tracking / invoicing side
 * effect". Two independent proofs:
 *   1. static — the module imports nothing but itself, Prisma, Next server types, jose, bwip-js
 *      and the two auth helpers; no connector, no fetch, no mailer, no queue;
 *   2. dynamic — a full pilot flow changes rows in `Warehouse*` tables only.
 */

const ROOT = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "__tests__") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const ALLOWED_IMPORTS = [
  /^\.{1,2}\//, // the module itself
  /^node:(crypto|fs|path)$/,
  /^@prisma\/client$/,
  /^bwip-js$/,
  /^jose$/,
  /^next\/server$/,
  /^@\/app\/lib\/(staffAuth|partnerAuth|prisma)$/,
];

describe("module isolation — static", () => {
  const files = sourceFiles(ROOT);

  it("has source files to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("imports only itself, the database client, auth helpers and label rendering", () => {
    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const specs = [...text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of specs) {
        if (!ALLOWED_IMPORTS.some((re) => re.test(spec))) violations.push(`${path.relative(ROOT, file)} → ${spec}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("relative imports never leave lib/warehouse", () => {
    const escapes: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
        const target = path.resolve(path.dirname(file), m[1]);
        if (!target.startsWith(ROOT)) escapes.push(`${path.relative(ROOT, file)} → ${m[1]}`);
      }
    }
    expect(escapes).toEqual([]);
  });

  it("makes no network call and touches no channel, order, invoice or tracking table", () => {
    const forbidden = [
      /\bfetch\s*\(/,
      /axios|nodemailer|resend|klaviyo|twilio/i,
      /shopify/i,
      /galaxus/i,
      /decathlon|mirakl/i,
      /swiss[-_ ]?post/i,
      /\bedi\b/i,
      /"ChannelListingState"|"ShopifyOrder"|"GalaxusOrder"|"OrderMatch"|"PartnerOrder"|"PartnerVariant"|"InventorySyncRun"|"GalaxusFeedRun"/,
      /process\.env\.(?!WAREHOUSE_|JWT_SECRET|NODE_ENV)[A-Z_]+/,
    ];
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // Comments may name what the module does NOT do.
        const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "").replace(/\/\*.*?\*\//g, "");
        // French UI strings may mention StockX as a price source name; connectors are what matters.
        for (const re of forbidden) if (re.test(code)) hits.push(`${path.relative(ROOT, file)}:${i + 1} ${re}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("only writes to Warehouse* tables (every INSERT / UPDATE / DELETE target)", () => {
    const targets = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"([A-Za-z_]+)"/g)) targets.add(m[1]);
    }
    expect(targets.size).toBeGreaterThan(15);
    expect([...targets].filter((t) => !t.startsWith("Warehouse"))).toEqual([]);
  });
});

const d = describe.skipIf(!HAS_DB);
afterAll(closeTestDb);

d("module isolation — dynamic", () => {
  it("a complete pilot flow changes rows in Warehouse* tables only", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const snapshot = async () => {
      const rows = await w.db.$queryRawUnsafe<{ relname: string; writes: bigint }[]>(
        `SELECT relname, (n_tup_ins + n_tup_upd + n_tup_del) AS writes FROM pg_stat_xact_user_tables WHERE schemaname = 'public'
         UNION ALL
         SELECT relname, (n_tup_ins + n_tup_upd + n_tup_del) AS writes FROM pg_stat_user_tables WHERE schemaname = 'public'`
      );
      const map = new Map<string, bigint>();
      for (const r of rows) map.set(r.relname, (map.get(r.relname) ?? BigInt(0)) + BigInt(r.writes));
      return map;
    };
    // Statistics are flushed asynchronously: force a flush before each snapshot.
    const flush = () => w.db.$executeRawUnsafe(`SELECT pg_stat_force_next_flush()`);
    await flush();
    await new Promise((r) => setTimeout(r, 50));
    const before = await snapshot();

    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    await putaway.proposeDestinations(w.db, { siteId: w.site.id, batchId: batch.id }, w.ctx);
    await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: r.unit.id, locationId: w.levels[0].id, acceptMismatch: true }, w.ctx);
    const job = await printing.claimNextPrintJob(w.db, { stationId: w.station.id });
    await printing.reportPrintJob(w.db, { jobId: job!.id, claimToken: job!.claimToken, outcome: "SENT" }, w.ctx);
    await units.setUnitQcState(w.db, { opKey: op("qc"), unitId: r.unit.id, qcState: "PASSED" }, w.ctx);
    await units.setUnitSaleState(w.db, { opKey: op("sale"), unitId: r.unit.id, saleState: "SALE_AUTHORIZED" }, admin);
    await pricing.setUnitPrice(w.db, { opKey: op("pr"), unitId: r.unit.id, publicPrice: "150" }, admin);
    await pricing.createPartnerRequest(w.db, { partnerId: w.partner.id, unitId: r.unit.id, type: "OTHER", message: "Test" });
    await batches.closeBatch(w.db, { batchId: batch.id }, w.ctx);

    await flush();
    await new Promise((r2) => setTimeout(r2, 50));
    const after = await snapshot();
    const changed = [...after.entries()].filter(([name, writes]) => writes !== (before.get(name) ?? BigInt(0))).map(([name]) => name);
    expect(changed.length).toBeGreaterThan(5);
    // "Partner" rows are inserted by the test harness itself (other suites run in parallel on the
    // same database); the static test above proves the module never writes to it.
    expect(changed.filter((name) => !name.startsWith("Warehouse") && name !== "Partner")).toEqual([]);
  });

  // Declared after the flow above on purpose: this test writes a catalog row itself (the module
  // never does), and that write must not land inside the flow's before/after window.
  it("A13: the catalog is read, never rewritten — the size comes back exactly as the source gives it, without conversion", async () => {
    const db = testDb();
    const gtin = randomGtin();
    const id = `whtest-${randomUUID()}`;
    await db.$executeRaw`
      INSERT INTO "SupplierVariant" ("id", "supplierVariantId", "supplierSku", "price", "stock", "updatedAt", "gtin", "supplierBrand", "supplierProductName", "sizeRaw", "sizeNormalized")
      VALUES (${id}, ${id}, ${"WHTEST-SKU"}, 100, 0, now(), ${gtin}, ${"Test"}, ${"Modèle anglais"}, ${"UK 8.5"}, ${"42.5"})`;
    const rowState = () =>
      db.$queryRaw<{ xmin: string; sizeRaw: string | null; stock: number }[]>`SELECT xmin::text AS xmin, "sizeRaw", "stock" FROM "SupplierVariant" WHERE "id" = ${id}`;
    try {
      const before = await rowState();
      const found = await items.resolveGtin(db, gtin);
      expect(found.status).toBe("CANDIDATES");
      if (found.status !== "CANDIDATES") return;
      expect(found.candidates).toHaveLength(1);
      // "UK 8.5" stays "UK 8.5": no system guessed, no EU or US size derived from it.
      expect(found.candidates[0]).toMatchObject({ source: "SUPPLIER_VARIANT", sizeLabel: "UK 8.5", sizeSystem: null, sizeEu: null, sizeUs: null, supplierVariantId: id });
      const { item } = await items.createItemFromCandidate(db, found.candidates[0]);
      expect(item).toMatchObject({ gtin, sizeLabel: "UK 8.5", sizeSystem: null, sizeEu: null, sizeUs: null, catalogSource: "SUPPLIER_VARIANT" });
      // Same row version: the catalog line was read, never touched.
      expect(await rowState()).toEqual(before);
    } finally {
      await db.$executeRaw`DELETE FROM "SupplierVariant" WHERE "id" = ${id}`;
    }
  });
});
