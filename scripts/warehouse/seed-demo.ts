/**
 * Demo / recette seed for the warehouse module — LOCAL TEST DATABASE ONLY.
 *
 *   WAREHOUSE_TEST_DATABASE_URL=postgresql://warehouse:warehouse@127.0.0.1:54329/warehouse_test?schema=public \
 *     npx tsx scripts/warehouse/seed-demo.ts
 *
 * Refuses to run against anything that is not 127.0.0.1/localhost. Goes through the real services
 * (same code as the API), so it doubles as an end-to-end smoke test of the pilot flow:
 * sites → racks → partner agreement → stock-take of the partner's pairs → receiving on a cart →
 * putaway proposal + confirmation → prices → one discrepancy.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import * as batches from "../../lib/warehouse/batches";
import * as items from "../../lib/warehouse/items";
import * as locations from "../../lib/warehouse/locations";
import * as operators from "../../lib/warehouse/operators";
import { getOverview } from "../../lib/warehouse/overview";
import * as pricing from "../../lib/warehouse/pricing";
import * as printing from "../../lib/warehouse/printing";
import * as putaway from "../../lib/warehouse/putaway";
import type { ActorContext } from "../../lib/warehouse/types";

const url = process.env.WAREHOUSE_TEST_DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refus : WAREHOUSE_TEST_DATABASE_URL doit pointer sur une base locale (127.0.0.1).");
  process.exit(1);
}
process.env.WAREHOUSE_MODULE_ENABLED = "true";
process.env.WAREHOUSE_WRITES_ENABLED = "true";

const db = new PrismaClient({ datasources: { db: { url } } });
const admin: ActorContext = { role: "admin", operatorId: null, stationId: null };
const op = () => `seed-${randomUUID()}`;

const MODELS = [
  { brand: "Nike", name: "Air Force 1 '07 White", styleCode: "CW2288-111", base: "19550086", sizes: ["40", "41", "42", "42.5", "43", "44"] },
  { brand: "Nike", name: "Dunk Low Panda", styleCode: "DD1391-100", base: "19424491", sizes: ["38", "39", "40", "41", "42", "43"] },
  { brand: "adidas", name: "Samba OG Cloud White", styleCode: "B75806", base: "40594331", sizes: ["40", "41 1/3", "42", "42 2/3", "43 1/3"] },
  { brand: "New Balance", name: "550 White Green", styleCode: "BB550WT1", base: "19537595", sizes: ["41.5", "42", "42.5", "43", "44"] },
  { brand: "Jordan", name: "Air Jordan 1 Low Wolf Grey", styleCode: "DC0774-105", base: "19586958", sizes: ["38.5", "39", "40", "40.5", "41"] },
];

function gtin13(prefix12: string): string {
  const digits = prefix12.split("").map(Number);
  const sum = digits.reduce((s, d, i) => s + d * (i % 2 === 0 ? 1 : 3), 0);
  return prefix12 + String((10 - (sum % 10)) % 10);
}

async function main() {
  const existing = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "WarehouseSite"`;
  if (existing[0].n > 0 && !process.argv.includes("--force")) {
    console.log("Base déjà initialisée (sites présents). Relancer avec --force pour ajouter un jeu de plus.");
    return;
  }
  const suffix = existing[0].n > 0 ? String(existing[0].n + 1).padStart(2, "0") : "01";
  const site = await locations.createSite(db, { code: `CH${suffix}`, name: "Etoy", countryCode: "CH" });
  const foreign = await locations.createSite(db, { code: `DE${suffix}`, name: "Site test étranger", countryCode: "DE", timezone: "Europe/Berlin", isTest: true });
  await locations.generateRacks(db, { siteId: site.id, sector: "A", rowFrom: 1, rowTo: 3, racksPerRow: 4, levelsPerRack: 5, capacityPerLevel: 12 });
  await locations.generateRacks(db, { siteId: foreign.id, sector: "A", rowFrom: 1, rowTo: 1, racksPerRow: 2, levelsPerRack: 3, capacityPerLevel: 10 });
  const rec = await locations.createSpecialLocation(db, { siteId: site.id, kind: "RECEIVING" });
  const cart = await locations.createSpecialLocation(db, { siteId: site.id, kind: "CART" });
  await locations.createSpecialLocation(db, { siteId: site.id, kind: "QUARANTINE" });
  await locations.createSpecialLocation(db, { siteId: foreign.id, kind: "RECEIVING" });

  // Partners: the pilot partner and a second one to exercise isolation.
  const partnerIds: Record<string, string> = {};
  for (const [key, name] of [["TONY", "Tony (pilote)"], ["DEMO2", "Partenaire témoin"]] as const) {
    const rows = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO "Partner" ("id", "key", "name", "active", "updatedAt") VALUES (${randomUUID()}, ${key}, ${name}, true, now())
      ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name" RETURNING "id"`;
    partnerIds[key] = rows[0].id;
  }
  await pricing.saveAgreement(db, { partnerId: partnerIds.TONY, saleAllowed: true, pricingMode: "STOCKX_BUYNOW_FACTOR", pricingFactor: "0.70", pricingBasisIs: "UNCONFIRMED", commissionRate: "0.10", fixedFee: "0", currency: "CHF", notes: "Modalités à confirmer avec le partenaire (voir décisions)." }, admin);
  await pricing.saveAgreement(db, { partnerId: partnerIds.DEMO2, saleAllowed: false, pricingMode: "MANUAL", currency: "CHF" }, admin);

  const operator = await operators.createOperator(db, { name: "Démo Entrepôt", code: `DEMO${suffix}` });
  const station1 = await printing.createStation(db, { siteId: site.id, name: "Poste réception 1" });
  const station2 = await printing.createStation(db, { siteId: site.id, name: "Poste rangement 2" });
  const pdfPrinter = await printing.createPrinter(db, { siteId: site.id, name: "PDF manuel 50×30", adapter: "PDF_MANUAL", mediaWidthMm: 50, mediaHeightMm: 30, supportedKinds: ["PAIR", "LOCATION"] });
  await printing.setStationRoute(db, { stationId: station1.id, labelKind: "PAIR", printerId: pdfPrinter.id });
  await printing.setStationRoute(db, { stationId: station2.id, labelKind: "PAIR", printerId: pdfPrinter.id });
  const ctx: ActorContext = { role: "logistics", operatorId: operator.id, stationId: station1.id };

  // Variants (manual catalogue entries with valid GTIN-13).
  const itemIds: string[] = [];
  let n = 0;
  for (const m of MODELS) {
    for (const size of m.sizes) {
      n += 1;
      const { item } = await items.createItem(db, { gtin: gtin13(`${m.base}${String(1000 + n)}`), brand: m.brand, name: m.name, styleCode: m.styleCode, sizeSystem: "EU", sizeLabel: size, sizeEu: size, catalogSource: "MANUAL" });
      itemIds.push(item.id);
    }
  }

  // 1. Stock-take of the pilot partner's pairs already on the shelves.
  const take = await batches.createBatch(db, { siteId: site.id, kind: "STOCK_TAKE", flow: "CONSIGNMENT", ownerKind: "PARTNER", ownerPartnerId: partnerIds.TONY, title: "Reprise des paires de Tony" }, ctx);
  const levels = await locations.listLocations(db, { siteId: site.id, kinds: ["LEVEL"], limit: 6 });
  let created = 0;
  for (const [i, level] of levels.items.entries()) {
    const { session } = await batches.openCountSession(db, { batchId: take.id, locationId: level.id }, ctx);
    const count = 4 + (i % 3) * 2;
    for (let k = 0; k < count; k += 1) {
      await batches.stockTakeCreateUnit(db, { opKey: op(), sessionId: session.id, itemId: itemIds[(i * 5 + k) % itemIds.length], condition: "NEW", boxCondition: k % 7 === 6 ? "DAMAGED" : "GOOD" }, ctx);
      created += 1;
    }
    await batches.closeCountSession(db, { sessionId: session.id }, ctx);
  }

  // 2. A receiving batch for the second partner, parked on a cart, then put away.
  const recv = await batches.createBatch(db, { siteId: site.id, kind: "RECEIVING", flow: "CONSIGNMENT", ownerKind: "PARTNER", ownerPartnerId: partnerIds.DEMO2, receivingLocationId: cart.id, title: "Dépôt partenaire témoin" }, ctx);
  const received: string[] = [];
  for (let k = 0; k < 10; k += 1) {
    // Ten boxes, same GTIN for the first five: ten action keys, ten identities.
    const r = await batches.receiveUnit(db, { opKey: op(), batchId: recv.id, itemId: itemIds[k < 5 ? 0 : k], condition: "NEW" }, ctx);
    received.push(r.unit.id);
  }
  const proposal = await putaway.proposeDestinations(db, { siteId: site.id, batchId: recv.id }, ctx);
  const queue = await putaway.listPutawayQueue(db, { siteId: site.id, batchId: recv.id });
  let shelved = 0;
  for (const task of queue.tasks.slice(0, 6)) {
    if (!task.proposedLocationId) continue;
    await putaway.confirmPutaway(db, { opKey: op(), unitId: task.unit.id, locationId: task.proposedLocationId }, { ...ctx, stationId: station2.id });
    shelved += 1;
  }

  // 3. Own stock received at the dock, left to put away.
  const own = await batches.createBatch(db, { siteId: site.id, kind: "RECEIVING", flow: "OWN_STOCK", ownerKind: "OWN", receivingLocationId: rec.id, title: "Réassort Resell" }, ctx);
  for (let k = 0; k < 4; k += 1) await batches.receiveUnit(db, { opKey: op(), batchId: own.id, itemId: itemIds[12 + k] }, ctx);

  // 4. Prices on the pilot partner's stock: a few validated, one StockX-based proposal.
  const tonyUnits = await db.$queryRaw<{ id: string; itemId: string }[]>`
    SELECT "id", "itemId" FROM "WarehouseUnit" WHERE "ownerPartnerId" = ${partnerIds.TONY} ORDER BY "receivedAt", "id" LIMIT 12`;
  for (const [i, u] of tonyUnits.slice(0, 8).entries()) {
    await pricing.setUnitPrice(db, { opKey: op(), unitId: u.id, publicPrice: String(129 + i * 10), currency: "CHF" }, admin);
  }
  if (tonyUnits[9]) {
    await pricing.proposeStockxPrices(db, { opKey: op(), partnerId: partnerIds.TONY, itemId: tonyUnits[9].itemId, basisAmount: "200", basisCurrency: "CHF", basisRef: "stockx:demo-listing", basisIncludesFees: null, basisObservedAt: new Date().toISOString() }, admin);
  }

  const overview = await getOverview(db, site.id);
  console.log(JSON.stringify({
    site: site.code,
    foreignSite: foreign.code,
    partners: partnerIds,
    operator: { id: operator.id, code: operator.code },
    stations: [station1.code, station2.code],
    stockTakeUnits: created,
    received: received.length,
    proposal,
    shelved,
    overview: { stock: overview.stock, capacity: overview.capacity, putaway: overview.putaway, exceptions: overview.exceptions, alerts: overview.alerts.map((a) => `${a.code}:${a.count}`) },
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
