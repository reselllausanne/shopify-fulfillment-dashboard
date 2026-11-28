import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import * as batches from "../batches";
import * as items from "../items";
import * as locations from "../locations";
import * as pricing from "../pricing";
import * as printing from "../printing";
import type { ActorContext, ItemSummary, LocationSummary } from "../types";

/**
 * Integration harness. Tests run against an ISOLATED local Postgres only:
 *
 *   WAREHOUSE_PG_DB=warehouse_vitest scripts/warehouse/dev-db.sh start
 *   node scripts/warehouse/setup-test-db.mjs --url "$(WAREHOUSE_PG_DB=warehouse_vitest scripts/warehouse/dev-db.sh url)"
 *   WAREHOUSE_TEST_DATABASE_URL="$(WAREHOUSE_PG_DB=warehouse_vitest scripts/warehouse/dev-db.sh url)" npx vitest run lib/warehouse
 *
 * Without WAREHOUSE_TEST_DATABASE_URL the database suites are skipped (pure tests still run).
 * A non-local URL is refused: these tests must never touch a shared or production database.
 */

export const TEST_URL = process.env.WAREHOUSE_TEST_DATABASE_URL ?? "";
const isLocal = /@(127\.0\.0\.1|localhost)[:/]/.test(TEST_URL);
if (TEST_URL && !isLocal) {
  throw new Error("WAREHOUSE_TEST_DATABASE_URL must point at a local database (127.0.0.1).");
}
export const HAS_DB = Boolean(TEST_URL) && isLocal;

process.env.WAREHOUSE_MODULE_ENABLED = "true";
process.env.WAREHOUSE_WRITES_ENABLED = "true";
process.env.WAREHOUSE_PARTNER_ALLOWLIST = "*";
delete process.env.WAREHOUSE_LABEL_JOURNAL_ENFORCE;
delete process.env.WAREHOUSE_LABEL_JOURNAL_DIR;

let client: PrismaClient | null = null;
export function testDb(): PrismaClient {
  if (!client) client = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  return client;
}
export async function closeTestDb(): Promise<void> {
  await client?.$disconnect();
  client = null;
}

export const admin: ActorContext = { role: "admin", operatorId: null, stationId: null };
export const op = (prefix = "t") => `${prefix}-${randomUUID()}`;

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
async function freeSiteCode(db: PrismaClient): Promise<string> {
  for (let i = 0; i < 50; i += 1) {
    const code = `${LETTERS[Math.floor(Math.random() * LETTERS.length)]}${LETTERS[Math.floor(Math.random() * LETTERS.length)]}${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
    const rows = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "WarehouseSite" WHERE "code" = ${code}`;
    if (rows[0].n === 0) return code;
  }
  throw new Error("no free site code");
}

function gtin13(prefix12: string): string {
  const digits = prefix12.split("").map(Number);
  const sum = digits.reduce((s, d, i) => s + d * (i % 2 === 0 ? 1 : 3), 0);
  return prefix12 + String((10 - (sum % 10)) % 10);
}
export function randomGtin(): string {
  let p = "";
  for (let i = 0; i < 12; i += 1) p += String(Math.floor(Math.random() * 10));
  return gtin13(p);
}

export async function makePartner(db: PrismaClient, name = "Partenaire test"): Promise<{ id: string; key: string }> {
  const key = `T${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const rows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO "Partner" ("id", "key", "name", "active", "updatedAt") VALUES (${randomUUID()}, ${key}, ${name}, true, now()) RETURNING "id"`;
  return { id: rows[0].id, key };
}

export async function makeItem(db: PrismaClient, patch: Partial<items.CreateItemInput> = {}): Promise<ItemSummary> {
  const { item } = await items.createItem(db, { gtin: randomGtin(), brand: "Test", name: `Modèle ${randomUUID().slice(0, 6)}`, sizeLabel: "42", catalogSource: "MANUAL", ...patch });
  return item;
}

export type World = {
  db: PrismaClient;
  site: locations.SiteRow;
  levels: LocationSummary[];
  receiving: LocationSummary;
  cart: LocationSummary;
  quarantine: LocationSummary;
  partner: { id: string; key: string };
  station: printing.StationRow;
  station2: printing.StationRow;
  printer: printing.PrinterRow;
  ctx: ActorContext;
  ctx2: ActorContext;
};

/** A fresh site with its own racks, zones, partner, two stations and one QZ printer routed for PAIR labels. */
export async function makeWorld(opts: { rows?: number; racksPerRow?: number; levelsPerRack?: number; capacity?: number; routePrinter?: boolean } = {}): Promise<World> {
  const db = testDb();
  const site = await locations.createSite(db, { code: await freeSiteCode(db), name: "Site de test", countryCode: "CH" });
  await locations.generateRacks(db, {
    siteId: site.id,
    sector: "A",
    rowFrom: 1,
    rowTo: opts.rows ?? 1,
    racksPerRow: opts.racksPerRow ?? 1,
    levelsPerRack: opts.levelsPerRack ?? 3,
    capacityPerLevel: opts.capacity ?? 5,
  });
  const levels = (await locations.listLocations(db, { siteId: site.id, kinds: ["LEVEL"], limit: 200 })).items;
  const receiving = await locations.createSpecialLocation(db, { siteId: site.id, kind: "RECEIVING" });
  const cart = await locations.createSpecialLocation(db, { siteId: site.id, kind: "CART" });
  const quarantine = await locations.createSpecialLocation(db, { siteId: site.id, kind: "QUARANTINE" });
  const partner = await makePartner(db);
  await pricing.saveAgreement(db, { partnerId: partner.id, saleAllowed: true, pricingMode: "MANUAL", commissionRate: "0.10", fixedFee: "5", currency: "CHF" }, admin);
  const station = await printing.createStation(db, { siteId: site.id, name: "Poste 1" });
  const station2 = await printing.createStation(db, { siteId: site.id, name: "Poste 2" });
  const printer = await printing.createPrinter(db, { siteId: site.id, name: "Zebra test", adapter: "QZ_TRAY", systemName: "ZD421-test", mediaWidthMm: 50, mediaHeightMm: 30, supportedKinds: ["PAIR"] });
  if (opts.routePrinter !== false) {
    await printing.setStationRoute(db, { stationId: station.id, labelKind: "PAIR", printerId: printer.id });
    await printing.setStationRoute(db, { stationId: station2.id, labelKind: "PAIR", printerId: printer.id });
  }
  return {
    db,
    site,
    levels,
    receiving,
    cart,
    quarantine,
    partner,
    station,
    station2,
    printer,
    ctx: { role: "logistics", operatorId: null, stationId: station.id },
    ctx2: { role: "logistics", operatorId: null, stationId: station2.id },
  };
}

/** Open a receiving batch for the world's partner on the cart. */
export async function makeReceivingBatch(w: World, patch: Partial<batches.CreateBatchInput> = {}): Promise<batches.BatchRow> {
  return batches.createBatch(
    w.db,
    { siteId: w.site.id, kind: "RECEIVING", flow: "CONSIGNMENT", ownerKind: "PARTNER", ownerPartnerId: w.partner.id, receivingLocationId: w.cart.id, ...patch },
    w.ctx
  );
}

export async function receiveOne(w: World, batchId: string, itemId: string, ctx: ActorContext = w.ctx) {
  return batches.receiveUnit(w.db, { opKey: op("rcv"), batchId, itemId, condition: "NEW" }, ctx);
}

export async function expectCode(promise: Promise<unknown>, code: string): Promise<any> {
  try {
    await promise;
  } catch (err: any) {
    if (err?.code !== code) throw new Error(`expected WarehouseError ${code}, got ${err?.code ?? err?.name}: ${err?.message}`);
    return err;
  }
  throw new Error(`expected WarehouseError ${code}, but the call succeeded`);
}

export const count = async (db: PrismaClient, sql: string, ...params: unknown[]): Promise<number> => {
  const rows = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${sql}`, ...params);
  return rows[0].n;
};
