/**
 * Synthetic volume for the scale recipe (roadmap §7.2) — LOCAL TEST DATABASE ONLY.
 *
 *   WAREHOUSE_TEST_DATABASE_URL=postgresql://warehouse:warehouse@127.0.0.1:54330/warehouse_scale?schema=public \
 *     npx tsx scripts/warehouse/scale-seed.ts --active 10000
 *     npx tsx scripts/warehouse/scale-seed.ts --active 100000
 *     npx tsx scripts/warehouse/scale-seed.ts --active 200000 --movements 1000000
 *     npx tsx scripts/warehouse/scale-seed.ts --active 200000 --codes 1000000
 *
 * The script is ADDITIVE: each run grows the same database to the requested tier. Nothing is
 * re-issued or re-imported between tiers — the pairs created at 10 000 keep their UUID, their QR
 * text and their history at 200 000 and beyond the millionth code.
 *
 * Sites, racks and special positions go through the real services. Pairs are inserted in bulk
 * SQL (same columns, constraints and triggers as `createUnitTx`): going through the HTTP gesture
 * a million times would measure the generator, not the module.
 *
 * Distribution (C35): Zipf-like concentration on popular variants, owners of very different
 * sizes, three sites of different sizes in two countries, three years of receiving dates, 4 % of
 * variants without GTIN, a mix of QC / sale states, pairs on carts, in quarantine and missing.
 */
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Client } from "pg";
import * as locations from "../../lib/warehouse/locations";

const url = process.env.WAREHOUSE_TEST_DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refus : WAREHOUSE_TEST_DATABASE_URL doit pointer sur une base locale (127.0.0.1).");
  process.exit(1);
}
process.env.WAREHOUSE_MODULE_ENABLED = "true";
process.env.WAREHOUSE_WRITES_ENABLED = "true";

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const ACTIVE = arg("active", 10_000);
const CODES = arg("codes", 0);
const MOVEMENTS = arg("movements", 0);
const PARTNERS = arg("partners", 60);
const ITEMS = arg("items", 6_000);
const FILL = 10; // pairs placed per level of capacity 12
const CHUNK = 50_000;

const db = new PrismaClient({ datasources: { db: { url } } });
const pg = new Client({ connectionString: url.replace(/\?schema=public$/, "") });

type SitePlan = { code: string; name: string; country: string; tz: string; isTest: boolean; share: number };
const sitePlans = (active: number): SitePlan[] =>
  active <= 20_000
    ? [
        { code: "SC01", name: "Charge — Etoy", country: "CH", tz: "Europe/Zurich", isTest: true, share: 0.7 },
        { code: "SD01", name: "Charge — site étranger", country: "DE", tz: "Europe/Berlin", isTest: true, share: 0.3 },
      ]
    : [
        { code: "SC01", name: "Charge — Etoy", country: "CH", tz: "Europe/Zurich", isTest: true, share: 0.55 },
        { code: "SC02", name: "Charge — second site CH", country: "CH", tz: "Europe/Zurich", isTest: true, share: 0.25 },
        { code: "SD01", name: "Charge — site étranger", country: "DE", tz: "Europe/Berlin", isTest: true, share: 0.2 },
      ];

const timings: Record<string, number> = {};
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const out = await fn();
  timings[label] = (timings[label] ?? 0) + (performance.now() - t0);
  return out;
}
const q = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> => (await pg.query(sql, params)).rows as T[];
const one = async (sql: string, params: unknown[] = []): Promise<number> => Number((await q<{ n: string }>(sql, params))[0].n);

function gtin13(n: number): string {
  const prefix12 = `76${String(n).padStart(10, "0")}`;
  const sum = prefix12.split("").reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return prefix12 + String((10 - (sum % 10)) % 10);
}

async function ensureSite(plan: SitePlan, targetUnits: number) {
  const existing = (await locations.listSites(db)).find((s) => s.code === plan.code);
  const site = existing ?? (await locations.createSite(db, { code: plan.code, name: plan.name, countryCode: plan.country, timezone: plan.tz, isTest: plan.isTest }));
  // Racks: sectors of 30 rows × 20 racks × 5 levels (3 000 levels, 36 000 places).
  const levelsNeeded = Math.ceil((targetUnits * 1.08) / FILL) + 20;
  const perRow = 20 * 5;
  let remainingRows = Math.ceil(levelsNeeded / perRow);
  for (let s = 0; remainingRows > 0; s += 1) {
    const rows = Math.min(30, remainingRows);
    await locations.generateRacks(db, {
      siteId: site.id,
      sector: String.fromCharCode(65 + s),
      rowFrom: 1,
      rowTo: rows,
      racksPerRow: 20,
      levelsPerRack: 5,
      capacityPerLevel: 12,
      serpentine: true,
      sectorIndex: s,
    });
    remainingRows -= rows;
  }
  const special = await q<{ kind: string; n: string }>(
    `SELECT "kind", count(*) AS n FROM "WarehouseLocation" WHERE "siteId" = $1 AND "kind" IN ('RECEIVING','CART','QUARANTINE') GROUP BY 1`,
    [site.id]
  );
  const have = (k: string) => Number(special.find((r) => r.kind === k)?.n ?? 0);
  for (let i = have("RECEIVING"); i < 2; i += 1) await locations.createSpecialLocation(db, { siteId: site.id, kind: "RECEIVING" });
  for (let i = have("CART"); i < 6; i += 1) await locations.createSpecialLocation(db, { siteId: site.id, kind: "CART", capacity: 60 });
  for (let i = have("QUARANTINE"); i < 1; i += 1) await locations.createSpecialLocation(db, { siteId: site.id, kind: "QUARANTINE" });
  return site;
}

async function ensurePartners() {
  const have = await one(`SELECT count(*) AS n FROM "Partner" WHERE "key" LIKE 'SCALE%'`);
  for (let i = have + 1; i <= PARTNERS; i += 1) {
    const id = randomUUID();
    const key = `SCALE${String(i).padStart(3, "0")}`;
    await pg.query(`INSERT INTO "Partner" ("id", "key", "name", "active", "updatedAt") VALUES ($1, $2, $3, true, now())`, [id, key, `Déposant charge ${i}`]);
    await pg.query(
      `INSERT INTO "WarehouseDepositAgreement" ("id", "partnerId", "version", "status", "saleAllowed", "channels", "pricingMode", "pricingBasisIs", "commissionRate", "fixedFee", "validFrom")
       VALUES ($1, $2, 1, 'ACTIVE', true, ARRAY['SHOPIFY'], 'MANUAL', 'PUBLIC_PRICE', 0.10, 5, now())`,
      [randomUUID(), id]
    );
  }
}

async function ensureItems() {
  const have = await one(`SELECT count(*) AS n FROM "WarehouseItem" WHERE "catalogSource" = 'SCALE'`);
  if (have >= ITEMS) return;
  const brands = ["Nike", "adidas", "New Balance", "Jordan", "ASICS", "Puma", "Salomon", "On"];
  const sizes = ["36", "37.5", "38", "39", "40", "40.5", "41", "42", "42.5", "43", "44", "45", "46"];
  for (let start = have; start < ITEMS; start += 1000) {
    const rows: unknown[][] = [];
    for (let i = start; i < Math.min(ITEMS, start + 1000); i += 1) {
      const model = Math.floor(i / sizes.length);
      const brand = brands[model % brands.length];
      const size = sizes[i % sizes.length];
      const style = `SC${String(model).padStart(5, "0")}-${100 + (model % 900)}`;
      const name = `${brand} Modèle ${model}`;
      // 4 % of variants have no GTIN (old boxes, samples).
      const gtin = i % 25 === 7 ? null : gtin13(i + 1);
      rows.push([randomUUID(), gtin, brand, name, style, size, `${brand} ${name} ${style} ${size} ${gtin ?? ""}`.toLowerCase()]);
    }
    await pg.query(
      `INSERT INTO "WarehouseItem" ("id", "gtin", "brand", "name", "styleCode", "sizeSystem", "sizeLabel", "sizeEu", "catalogSource", "searchText")
       SELECT x->>0, x->>1, x->>2, x->>3, x->>4, 'EU', x->>5, x->>5, 'SCALE', x->>6 FROM jsonb_array_elements($1::jsonb) AS x`,
      [JSON.stringify(rows)]
    );
  }
}

async function prepareLookups() {
  await pg.query(`DROP TABLE IF EXISTS _items; CREATE TEMP TABLE _items AS SELECT row_number() OVER (ORDER BY "id") AS idx, "id" FROM "WarehouseItem" WHERE "catalogSource" = 'SCALE'`);
  await pg.query(`CREATE UNIQUE INDEX ON _items (idx)`);
  await pg.query(
    `DROP TABLE IF EXISTS _partners; CREATE TEMP TABLE _partners AS
     SELECT row_number() OVER (ORDER BY p."key") AS idx, p."id", a."id" AS agreement
     FROM "Partner" p JOIN "WarehouseDepositAgreement" a ON a."partnerId" = p."id" AND a."status" = 'ACTIVE' WHERE p."key" LIKE 'SCALE%'`
  );
  await pg.query(`CREATE UNIQUE INDEX ON _partners (idx)`);
}

/**
 * Insert `n` pairs issued at `site`. mode ACTIVE → placed on levels (a few on carts, in
 * quarantine, missing); mode OUT → sold / withdrawn pairs with a closed history; a share of the
 * oldest OUT pairs has its movement detail archived (identity and scan mapping stay).
 */
async function insertUnits(site: { id: string; code: string }, n: number, mode: "ACTIVE" | "OUT") {
  const nItems = await one(`SELECT count(*) AS n FROM _items`);
  const nPartners = await one(`SELECT count(*) AS n FROM _partners`);
  await pg.query("BEGIN");
  await pg.query(`DROP TABLE IF EXISTS _new`);
  await pg.query(
    `CREATE TEMP TABLE _new AS
     SELECT gen_random_uuid()::text AS id, row_number() OVER () AS rn,
            random() AS r_item, random() AS r_own, random() AS r_partner, random() AS r_age, random() AS r_qc, random() AS r_sale, random() AS r_place
     FROM generate_series(1, $1)`,
    [n]
  );
  if (mode === "ACTIVE") {
    // Free places on levels in walk order, FILL pairs per level; 1.5 % waiting at receiving, 0.3 % quarantine, 0.2 % missing.
    // Bulk SQL bypasses the capacity rule, so waiting pairs go to receiving zones (no capacity), not to carts.
    await pg.query(`DROP TABLE IF EXISTS _slots`);
    await pg.query(
      `CREATE TEMP TABLE _slots AS
       SELECT l."id" AS location_id, row_number() OVER (ORDER BY l."walkSequence", l."code", g) AS rn
       FROM "WarehouseLocation" l, generate_series(1, GREATEST($2 - l."occupiedCount", 0)) g
       WHERE l."siteId" = $1 AND l."kind" = 'LEVEL' AND l."status" = 'ACTIVE'`,
      [site.id, FILL]
    );
    await pg.query(`CREATE UNIQUE INDEX ON _slots (rn)`);
    await pg.query(`DROP TABLE IF EXISTS _temp_locs`);
    await pg.query(
      `CREATE TEMP TABLE _temp_locs AS SELECT "id", "kind", row_number() OVER (PARTITION BY ("kind" = 'QUARANTINE') ORDER BY "code") AS idx,
              count(*) OVER (PARTITION BY ("kind" = 'QUARANTINE')) AS total
       FROM "WarehouseLocation" WHERE "siteId" = $1 AND "kind" IN ('RECEIVING','QUARANTINE')`,
      [site.id]
    );
  }
  const placement =
    mode === "ACTIVE"
      ? `CASE WHEN n.r_place < 0.002 THEN NULL
              WHEN n.r_place < 0.005 THEN (SELECT t."id" FROM _temp_locs t WHERE t."kind" = 'QUARANTINE' LIMIT 1)
              WHEN n.r_place < 0.020 THEN (SELECT t."id" FROM _temp_locs t WHERE t."kind" <> 'QUARANTINE' AND t.idx = 1 + (n.rn % t.total))
              ELSE (SELECT s.location_id FROM _slots s WHERE s.rn = n.rn) END`
      : `NULL`;
  const inserted = await pg.query(
    `INSERT INTO "WarehouseUnit"
       ("id", "labelCode", "issuingSiteId", "issuingSiteCode", "itemId", "ownerKind", "ownerPartnerId", "agreementId", "originType",
        "presence", "currentSiteId", "currentLocationId", "qcState", "saleState", "condition", "boxCondition",
        "outReason", "outAt", "labelVerifiedAt", "labelPrintCount", "version", "observedAt", "receivedAt", "createdAt")
     SELECT x.id, x.id || '-' || $2, $1, $2, x.item_id, x.owner_kind, x.partner_id, x.agreement,
            CASE WHEN x.owner_kind = 'PARTNER' THEN (CASE WHEN x.r_age > 0.9 THEN 'STOCK_TAKE' ELSE 'CONSIGNMENT' END) ELSE 'OWN_STOCK' END,
            CASE WHEN $3 = 'OUT' THEN 'OUT' WHEN x.loc IS NULL THEN 'MISSING' ELSE 'PRESENT' END,
            CASE WHEN $3 = 'OUT' THEN NULL ELSE $1 END, x.loc,
            CASE WHEN x.is_quarantine THEN 'QUARANTINE' WHEN x.r_qc < 0.90 OR $3 = 'OUT' THEN 'PASSED' ELSE 'PENDING' END,
            CASE WHEN x.is_quarantine OR x.loc IS NULL AND $3 <> 'OUT' THEN 'BLOCKED'
                 WHEN $3 = 'OUT' THEN 'STORAGE_ONLY'
                 WHEN x.r_qc < 0.90 AND x.r_sale < 0.65 THEN 'SALE_AUTHORIZED'
                 WHEN x.r_sale > 0.97 THEN 'BLOCKED' ELSE 'STORAGE_ONLY' END,
            CASE WHEN x.r_sale < 0.9 THEN 'NEW' ELSE 'USED' END, CASE WHEN x.r_sale < 0.85 THEN 'GOOD' ELSE 'DAMAGED' END,
            CASE WHEN $3 = 'OUT' THEN (CASE WHEN x.r_sale < 0.8 THEN 'SOLD' WHEN x.r_sale < 0.95 THEN 'WITHDRAWN' ELSE 'RETURNED_TO_SUPPLIER' END) END,
            CASE WHEN $3 = 'OUT' THEN x.received + (x.out_delay * interval '1 day') END,
            x.received, 1, CASE WHEN $3 = 'OUT' THEN 3 ELSE 2 END,
            CASE WHEN $3 = 'OUT' THEN x.received + (x.out_delay * interval '1 day') ELSE x.received + interval '2 hours' END,
            x.received, x.received
     FROM (
       SELECT n.*, i."id" AS item_id,
              CASE WHEN n.r_own < 0.12 THEN 'OWN' ELSE 'PARTNER' END AS owner_kind,
              CASE WHEN n.r_own < 0.12 THEN NULL ELSE p."id" END AS partner_id,
              CASE WHEN n.r_own < 0.12 THEN NULL ELSE p.agreement END AS agreement,
              ${placement} AS loc,
              ${mode === "ACTIVE" ? "(n.r_place >= 0.002 AND n.r_place < 0.005)" : "false"} AS is_quarantine,
              -- OUT pairs are older (1 to 11 years); active stock is 0 to 3 years old, skewed to recent.
              CASE WHEN $3 = 'OUT' THEN now() - ((365 + n.r_age * 3650) * interval '1 day') ELSE now() - ((power(n.r_age, 1.6) * 1095 + 0.2) * interval '1 day') END AS received,
              1 + n.r_sale * 300 AS out_delay
       FROM _new n
       JOIN _items i ON i.idx = 1 + floor($4 * power(n.r_item, 3))::int
       JOIN _partners p ON p.idx = 1 + floor($5 * power(n.r_partner, 2.2))::int
     ) x`,
    [site.id, site.code, mode, nItems, nPartners]
  );
  if (inserted.rowCount !== n) throw new Error(`Inserted ${inserted.rowCount} of ${n} units`);

  // Registry (the lookup the scanner uses) + issuance journal, same payload as createUnitTx.
  await pg.query(
    `INSERT INTO "WarehouseLabelCode" ("code", "unitId", "format", "isOriginal", "issuingSiteCode", "issuedAt")
     SELECT u."labelCode", u."id", 'UUID_SITE_V1', true, u."issuingSiteCode", u."receivedAt" FROM "WarehouseUnit" u JOIN _new n ON n.id = u."id"`
  );
  await pg.query(
    `INSERT INTO "WarehouseLabelJournal" ("code", "unitId", "payload", "payloadHash", "issuedAt", "exportedAt", "exportSink", "exportRef")
     SELECT p.code, p.unit_id, p.payload, encode(sha256(convert_to(p.payload::text, 'UTF8')), 'hex'), p.issued, p.issued + interval '1 minute', 'FILE', 'scale-seed'
     FROM (
       SELECT u."labelCode" AS code, u."id" AS unit_id, u."receivedAt" AS issued,
              jsonb_build_object('v', 1, 'code', u."labelCode", 'unitId', u."id", 'format', 'UUID_SITE_V1', 'issuingSiteCode', u."issuingSiteCode",
                'itemId', u."itemId", 'ownerKind', u."ownerKind", 'ownerPartnerId', u."ownerPartnerId", 'originType', u."originType",
                'originBatchId', NULL, 'locationId', u."currentLocationId", 'issuedAt', to_char(u."receivedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS payload
       FROM "WarehouseUnit" u JOIN _new n ON n.id = u."id"
     ) p`
  );

  // History: issue + putaway (+ exit). Archived pairs (oldest 40 % of OUT) keep only the archive rows.
  const archived = mode === "OUT" ? `n.r_age > 0.6` : `false`;
  await pg.query(
    `INSERT INTO "WarehouseMovement" ("id", "unitId", "type", "toSiteId", "toLocationId", "actorRole", "unitVersion", "observedAt", "createdAt")
     SELECT gen_random_uuid()::text, u."id", CASE WHEN u."originType" = 'STOCK_TAKE' THEN 'STOCK_TAKE' ELSE 'RECEIVE' END, $1, NULL, 'logistics', 1, u."receivedAt", u."receivedAt"
     FROM "WarehouseUnit" u JOIN _new n ON n.id = u."id" WHERE NOT (${archived})`,
    [site.id]
  );
  await pg.query(
    `INSERT INTO "WarehouseMovement" ("id", "unitId", "type", "fromSiteId", "toSiteId", "toLocationId", "actorRole", "unitVersion", "observedAt", "createdAt")
     SELECT gen_random_uuid()::text, u."id", 'PUTAWAY', $1, $1, u."currentLocationId", 'logistics', 2, u."receivedAt" + interval '2 hours', u."receivedAt" + interval '2 hours'
     FROM "WarehouseUnit" u JOIN _new n ON n.id = u."id" WHERE NOT (${archived})`,
    [site.id]
  );
  if (mode === "OUT") {
    await pg.query(
      `INSERT INTO "WarehouseMovement" ("id", "unitId", "type", "fromSiteId", "reason", "actorRole", "unitVersion", "observedAt", "createdAt")
       SELECT gen_random_uuid()::text, u."id", 'OUT', $1, u."outReason", 'admin', 3, u."outAt", u."outAt"
       FROM "WarehouseUnit" u JOIN _new n ON n.id = u."id" WHERE NOT (${archived})`,
      [site.id]
    );
    const ref = `scale-archive-${Date.now()}`;
    await pg.query(
      `INSERT INTO "WarehouseMovementArchive" ("id", "seq", "unitId", "archiveRef", "row", "archivedAt")
       SELECT gen_random_uuid()::text, -(n.rn * 4 + k.k) - (SELECT COALESCE(max(abs("seq")), 0) FROM "WarehouseMovementArchive"), u."id", $1,
              jsonb_build_object('type', (ARRAY['RECEIVE','PUTAWAY','OUT'])[k.k], 'unitVersion', k.k, 'observedAt', u."receivedAt"), u."outAt" + interval '400 days'
       FROM "WarehouseUnit" u JOIN _new n ON n.id = u."id", generate_series(1, 3) AS k(k) WHERE ${archived}`,
      [ref]
    );
    await pg.query(
      `UPDATE "WarehouseUnit" u SET "historyArchivedAt" = u."outAt" + interval '400 days', "historyArchiveRef" = $1 FROM _new n WHERE n.id = u."id" AND ${archived}`,
      [ref]
    );
  } else {
    await pg.query(
      `UPDATE "WarehouseLocation" l SET "occupiedCount" = l."occupiedCount" + c.n, "updatedAt" = now()
       FROM (SELECT u."currentLocationId" AS id, count(*)::int AS n FROM "WarehouseUnit" u JOIN _new n ON n.id = u."id" WHERE u."currentLocationId" IS NOT NULL GROUP BY 1) c
       WHERE c.id = l."id"`
    );
    // Validated prices on about half of the sellable pairs, a few proposals.
    await pg.query(
      `INSERT INTO "WarehouseUnitPrice" ("id", "unitId", "itemId", "agreementId", "currency", "publicPrice", "sellerNet", "fees", "source", "status", "setByRole", "validatedAt")
       SELECT gen_random_uuid()::text, u."id", u."itemId", u."agreementId", 'CHF', x.price, round(x.price * 0.9 - 5, 2), round(x.price * 0.1 + 5, 2), 'MANUAL',
              CASE WHEN n.r_place < 0.9 THEN 'VALIDATED' ELSE 'PROPOSED' END, 'admin', CASE WHEN n.r_place < 0.9 THEN now() END
       FROM "WarehouseUnit" u JOIN _new n ON n.id = u."id", LATERAL (SELECT round((80 + n.r_item * 320)::numeric, 0) AS price) x
       WHERE u."saleState" = 'SALE_AUTHORIZED' AND u."ownerKind" = 'PARTNER' AND n.r_partner < 0.75`
    );
    // Pairs still on a cart / at receiving wait for putaway.
    await pg.query(
      `INSERT INTO "WarehousePutawayTask" ("id", "unitId", "siteId", "cartLocationId", "fromLocationId", "status")
       SELECT gen_random_uuid()::text, u."id", $1, CASE WHEN l."kind" = 'CART' THEN l."id" END, l."id", 'PENDING'
       FROM "WarehouseUnit" u JOIN _new n ON n.id = u."id" JOIN "WarehouseLocation" l ON l."id" = u."currentLocationId"
       WHERE l."kind" IN ('CART','RECEIVING')`,
      [site.id]
    );
  }
  await pg.query("COMMIT");
}

/** Extra history on active pairs (relocations, label reprints, QC, sale state) up to a total. */
async function padMovements(target: number) {
  let total = await one(`SELECT count(*) AS n FROM "WarehouseMovement"`);
  while (total < target) {
    const n = Math.min(CHUNK * 2, target - total);
    await pg.query(
      `INSERT INTO "WarehouseMovement" ("id", "unitId", "type", "fromSiteId", "fromLocationId", "toSiteId", "toLocationId", "actorRole", "unitVersion", "observedAt", "createdAt")
       SELECT gen_random_uuid()::text, u."id", (ARRAY['RELOCATE','LABEL_REPRINT','QC','SALE_STATE','CONDITION'])[1 + floor(random() * 5)::int],
              u."currentSiteId", u."currentLocationId", u."currentSiteId", u."currentLocationId", 'logistics', 2, u."observedAt", u."observedAt"
       FROM (SELECT * FROM "WarehouseUnit" TABLESAMPLE SYSTEM_ROWS($1) WHERE "presence" = 'PRESENT') u`,
      [n]
    ).catch(async () => {
      // tsm_system_rows not installed: fall back to a random() filter.
      await pg.query(
        `INSERT INTO "WarehouseMovement" ("id", "unitId", "type", "fromSiteId", "fromLocationId", "toSiteId", "toLocationId", "actorRole", "unitVersion", "observedAt", "createdAt")
         SELECT gen_random_uuid()::text, u."id", (ARRAY['RELOCATE','LABEL_REPRINT','QC','SALE_STATE','CONDITION'])[1 + floor(random() * 5)::int],
                u."currentSiteId", u."currentLocationId", u."currentSiteId", u."currentLocationId", 'logistics', 2, u."observedAt", u."observedAt"
         FROM "WarehouseUnit" u WHERE u."presence" = 'PRESENT' AND random() < 0.6 LIMIT $1`,
        [n]
      );
    });
    const after = await one(`SELECT count(*) AS n FROM "WarehouseMovement"`);
    if (after === total) break;
    total = after;
  }
}

async function main() {
  await pg.connect();
  const t0 = performance.now();
  const plans = sitePlans(ACTIVE);
  await timed("partners+items", async () => {
    await ensurePartners();
    await ensureItems();
    await prepareLookups();
  });

  const sites: { id: string; code: string; target: number }[] = [];
  for (const plan of plans) {
    const target = Math.round(ACTIVE * plan.share);
    const site = await timed("sites+racks (services)", () => ensureSite(plan, target));
    sites.push({ id: site.id, code: site.code, target });
  }

  for (const site of sites) {
    const have = await one(`SELECT count(*) AS n FROM "WarehouseUnit" WHERE "issuingSiteId" = $1 AND "presence" <> 'OUT'`, [site.id]);
    let missing = site.target - have;
    while (missing > 0) {
      const n = Math.min(CHUNK, missing);
      await timed("active units (bulk)", () => insertUnits(site, n, "ACTIVE"));
      missing -= n;
      process.stdout.write(`  ${site.code}: +${n} paires actives\n`);
    }
  }

  if (CODES > 0) {
    let codes = await one(`SELECT count(*) AS n FROM "WarehouseLabelCode"`);
    let i = 0;
    while (codes < CODES) {
      const n = Math.min(CHUNK, CODES - codes);
      const site = sites[i % sites.length];
      await timed("historical codes (bulk)", () => insertUnits(site, n, "OUT"));
      codes += n;
      i += 1;
      process.stdout.write(`  ${site.code}: +${n} codes historiques (total ${codes})\n`);
    }
  }
  if (MOVEMENTS > 0) await timed("movement history padding", () => padMovements(MOVEMENTS));

  await timed("analyze", () => pg.query(`ANALYZE`));
  const summary = {
    activeUnits: await one(`SELECT count(*) AS n FROM "WarehouseUnit" WHERE "presence" <> 'OUT'`),
    outUnits: await one(`SELECT count(*) AS n FROM "WarehouseUnit" WHERE "presence" = 'OUT'`),
    archivedUnits: await one(`SELECT count(*) AS n FROM "WarehouseUnit" WHERE "historyArchivedAt" IS NOT NULL`),
    labelCodes: await one(`SELECT count(*) AS n FROM "WarehouseLabelCode"`),
    distinctCodes: await one(`SELECT count(DISTINCT "code") AS n FROM "WarehouseLabelCode"`),
    journal: await one(`SELECT count(*) AS n FROM "WarehouseLabelJournal"`),
    movements: await one(`SELECT count(*) AS n FROM "WarehouseMovement"`),
    archivedMovements: await one(`SELECT count(*) AS n FROM "WarehouseMovementArchive"`),
    sites: await one(`SELECT count(*) AS n FROM "WarehouseSite"`),
    levels: await one(`SELECT count(*) AS n FROM "WarehouseLocation" WHERE "kind" = 'LEVEL'`),
    partners: await one(`SELECT count(DISTINCT "ownerPartnerId") AS n FROM "WarehouseUnit"`),
    items: await one(`SELECT count(DISTINCT "itemId") AS n FROM "WarehouseUnit"`),
    overCapacityLevels: await one(`SELECT count(*) AS n FROM "WarehouseLocation" WHERE "capacity" IS NOT NULL AND "occupiedCount" + "reservedCount" > "capacity"`),
    counterDrift: await one(
      `SELECT count(*) AS n FROM "WarehouseLocation" l WHERE l."holdsUnits" AND l."occupiedCount" <> (SELECT count(*) FROM "WarehouseUnit" u WHERE u."currentLocationId" = l."id")`
    ),
    topItemShare: Number((await q<{ s: string }>(`SELECT round(max(c)::numeric / sum(c), 4) AS s FROM (SELECT count(*) AS c FROM "WarehouseUnit" GROUP BY "itemId") x`))[0].s),
    topPartnerUnits: await one(`SELECT max(c) AS n FROM (SELECT count(*) AS c FROM "WarehouseUnit" WHERE "ownerPartnerId" IS NOT NULL AND "presence" <> 'OUT' GROUP BY "ownerPartnerId") x`),
    smallestPartnerUnits: await one(`SELECT min(c) AS n FROM (SELECT count(*) AS c FROM "WarehouseUnit" WHERE "ownerPartnerId" IS NOT NULL AND "presence" <> 'OUT' GROUP BY "ownerPartnerId") x`),
  };
  const out = {
    at: new Date().toISOString(),
    request: { active: ACTIVE, codes: CODES, movements: MOVEMENTS },
    seconds: Number(((performance.now() - t0) / 1000).toFixed(1)),
    timingsSeconds: Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, Number((v / 1000).toFixed(1))])),
    summary,
    checksum: createHash("sha256").update(JSON.stringify(summary)).digest("hex").slice(0, 12),
  };
  console.log(JSON.stringify(out, null, 2));
  await pg.end();
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pg.query("ROLLBACK");
  } catch {}
  process.exit(1);
});
