import { afterAll, describe, expect, it } from "vitest";
import * as batches from "../batches";
import { classifyStorageError, fail } from "../api/http";
import { classifyScan, containedUnitGtin, isPackagingGtin, swapYZ } from "../codes";
import * as exceptions from "../exceptions";
import * as items from "../items";
import * as locations from "../locations";
import { getOverview } from "../overview";
import * as printing from "../printing";
import * as putaway from "../putaway";
import * as units from "../units";
import { HAS_DB, admin, closeTestDb, count, expectCode, makeItem, makeReceivingBatch, makeWorld, op, randomGtin, receiveOne, testDb, type World } from "./harness";

/**
 * Proofs for the cases the M2 adverse review (docs/warehouse/M2-CASES.md) found missing or
 * untested. Each test names the case it closes.
 */

const d = describe.skipIf(!HAS_DB);
afterAll(closeTestDb);

const stockTake = (w: World) =>
  batches.createBatch(w.db, { siteId: w.site.id, kind: "STOCK_TAKE", flow: "CONSIGNMENT", ownerKind: "PARTNER", ownerPartnerId: w.partner.id, title: "Reprise" }, w.ctx);

/** GTIN-14 with a packaging indicator, built from a GTIN-13 (the check digit is recomputed). */
function cartonGtin(gtin13: string, indicator = 1): string {
  const body = `${indicator}${gtin13.slice(0, 12)}`;
  const sum = body.split("").map(Number).reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return body + String((10 - (sum % 10)) % 10);
}

describe("scanner text — no database", () => {
  it("A15: a carton GTIN-14 is recognised as packaging and names the box GTIN it contains", () => {
    const unitGtin = randomGtin();
    const carton = cartonGtin(unitGtin, 1);
    expect(isPackagingGtin(carton)).toBe(true);
    expect(isPackagingGtin(unitGtin)).toBe(false);
    expect(isPackagingGtin(`0${unitGtin}`)).toBe(false);
    expect(containedUnitGtin(carton)).toBe(unitGtin);
    expect(classifyScan(carton)).toMatchObject({ kind: "GTIN", packaging: true });
    expect(classifyScan(unitGtin)).toMatchObject({ kind: "GTIN", packaging: false });
  });

  it("A31: a keyboard-wedge scanner on another layout still designates the same pair and the same level", () => {
    const code = "3f2a9c1e-7b4d-4e8a-9c21-5d6f7a8b9c0d-CH01";
    for (const sep of ["'", "ß", "/", "_", "?"]) {
      const typed = code.split("-").join(sep);
      expect(classifyScan(typed)).toMatchObject({ kind: "UNIT_LABEL", code, unitId: code.slice(0, 36), issuingSiteCode: "CH01" });
    }
    expect(classifyScan("CH01'A'R01'T03'N02")).toMatchObject({ kind: "LOCATION", code: "CH01-A-R01-T03-N02" });
    // Mixed separators are not a layout: never guessed.
    expect(classifyScan("3f2a9c1e'7b4d/4e8a'9c21/5d6f7a8b9c0d'CH01").kind).not.toBe("UNIT_LABEL");
    expect(swapYZ("ZY01-A-R01")).toBe("YZ01-A-R01");
    expect(swapYZ(swapYZ("Zy01"))).toBe("Zy01");
  });

  it("C29: storage failures are told apart from an ordinary error and answered 503 'nothing was recorded'", async () => {
    expect(classifyStorageError(new Error("ERROR: cannot execute INSERT in a read-only transaction"))).toBe("READ_ONLY");
    expect(classifyStorageError({ code: "P2010", meta: { code: "25006", message: "x" } })).toBe("READ_ONLY");
    expect(classifyStorageError(new Error('could not extend file "base/1/2": No space left on device'))).toBe("DISK_FULL");
    expect(classifyStorageError({ meta: { code: "53100" } })).toBe("DISK_FULL");
    expect(classifyStorageError(new Error("FATAL: sorry, too many clients already — remaining connection slots are reserved"))).toBe("OVERLOADED");
    expect(classifyStorageError({ code: "P1001", message: "Can't reach database server at db:5432" })).toBe("UNREACHABLE");
    expect(classifyStorageError(new Error("null value in column violates not-null constraint"))).toBeNull();
    expect(classifyStorageError(null)).toBeNull();

    const res = fail(new Error("cannot execute UPDATE in a read-only transaction"), "POST /batches/x/receive", "rcv-1234567890");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("STORAGE_UNAVAILABLE");
    expect(body.error.details).toMatchObject({ reason: "READ_ONLY", nothingWritten: true });
    expect(body.error.message).toMatch(/rien n'a été enregistré/i);
    const plain = fail(new Error("boom"), "GET /x");
    expect(plain.status).toBe(500);
    expect((await plain.json()).error.code).toBe("INTERNAL");
  });
});

d("M2 — identification (A10, A12, A15)", () => {
  it("C29: a real read-only refusal from Postgres is classified READ_ONLY", async () => {
    const db = testDb();
    let caught: unknown = null;
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);
        await tx.$executeRawUnsafe(`UPDATE "WarehouseSite" SET "updatedAt" = now() WHERE "id" = 'none'`);
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(classifyStorageError(caught)).toBe("READ_ONLY");
  });

  it("A15: a carton code is never an article; the box GTIN it contains is proposed, nothing is created", async () => {
    const db = testDb();
    const item = await makeItem(db);
    const carton = cartonGtin(item.gtin!, 3);
    const res = await items.resolveGtin(db, carton);
    expect(res.status).toBe("PACKAGING");
    if (res.status === "PACKAGING") expect(res.containedGtin).toBe(item.gtin);
    await expectCode(items.createItem(db, { gtin: carton, name: "Carton pris pour une boîte" }), "INVALID_INPUT");
    expect(await count(db, `"WarehouseItemAlias" WHERE "value" = $1`, carton)).toBe(0);
    // The box GTIN itself still resolves to the article.
    expect((await items.resolveGtin(db, item.gtin!)).status).toBe("ITEM");
  });

  it("A10: a box without GTIN enters under a provisional article that blocks its sale until an admin confirms the identification", async () => {
    const w = await makeWorld();
    const { item: provisional } = await items.createItem(w.db, { name: "Boîte sans code — à identifier", provisional: true, catalogSource: "MANUAL" });
    expect(provisional.status).toBe("PROVISIONAL");
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, provisional.id);
    await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: r.unit.id, locationId: w.levels[0].id, acceptMismatch: true }, w.ctx);
    await units.setUnitQcState(w.db, { opKey: op("qc"), unitId: r.unit.id, qcState: "PASSED" }, admin);
    const refused = await expectCode(units.setUnitSaleState(w.db, { opKey: op("sale"), unitId: r.unit.id, saleState: "SALE_AUTHORIZED" }, admin), "UNIT_STATE_CONFLICT");
    expect(refused.details.blockers).toEqual(["variante provisoire à confirmer"]);

    // The GTIN of another article cannot be used to confirm this one.
    const other = await makeItem(w.db);
    await expectCode(items.confirmItem(w.db, { opKey: op("cf"), itemId: provisional.id, gtin: other.gtin, note: "erreur de saisie" }, admin), "AMBIGUOUS_GTIN");
    expect((await items.getItem(w.db, provisional.id)).status).toBe("PROVISIONAL");

    const gtin = randomGtin();
    const key = op("cf");
    const confirmed = await items.confirmItem(w.db, { opKey: key, itemId: provisional.id, gtin, name: "Air Max 1 '86", sizeLabel: "43", note: "Étiquette intérieure lue, photo jointe au lot" }, admin);
    expect(confirmed.item.status).toBe("ACTIVE");
    expect(confirmed.item.gtin).toBe(gtin);
    expect(confirmed.pairs).toBe(1);
    const replay = await items.confirmItem(w.db, { opKey: key, itemId: provisional.id, gtin, name: "Air Max 1 '86", sizeLabel: "43", note: "Étiquette intérieure lue, photo jointe au lot" }, admin);
    expect(replay.replayed).toBe(true);
    // Same pair, same QR; the sale right is a separate, explicit decision that is now possible.
    const after = await units.getUnitSummary(w.db, r.unit.id);
    expect(after.id).toBe(r.unit.id);
    expect(after.labelCode).toBe(r.unit.labelCode);
    expect(after.saleState).not.toBe("SALE_AUTHORIZED");
    const allowed = await units.setUnitSaleState(w.db, { opKey: op("sale"), unitId: r.unit.id, saleState: "SALE_AUTHORIZED" }, admin);
    expect(allowed.unit.saleState).toBe("SALE_AUTHORIZED");
    expect((await items.resolveGtin(w.db, gtin)).status).toBe("ITEM");
  });

  it("A12: a GTIN already owned by an article cannot be attached to a second one", async () => {
    const db = testDb();
    const a = await makeItem(db);
    const b = await makeItem(db);
    await expectCode(items.addItemAlias(db, { itemId: b.id, namespace: "GTIN", value: a.gtin! }), "AMBIGUOUS_GTIN");
    const res = await items.resolveGtin(db, a.gtin!);
    expect(res.status).toBe("ITEM");
    if (res.status === "ITEM") expect(res.item.id).toBe(a.id);
  });
});

d("M2 — stock-take (A03, A08, A09, A28, A32, C49)", () => {
  it("A08: a declared list is consumed box by box; a box outside the list is recorded and flagged, never refused", async () => {
    const w = await makeWorld();
    const declared = await makeItem(w.db);
    const stranger = await makeItem(w.db);
    const batch = await stockTake(w);
    await batches.addBatchLines(w.db, batch.id, [{ itemId: declared.id, expectedQty: 2 }]);
    const { session } = await batches.openCountSession(w.db, { batchId: batch.id, locationId: w.levels[0].id }, w.ctx);

    const one = await batches.stockTakeCreateUnit(w.db, { opKey: op("st"), sessionId: session.id, itemId: declared.id }, w.ctx);
    expect(one.line).toMatchObject({ expectedQty: 2, receivedQty: 1 });
    expect(one.exceptions.map((e) => e.type)).not.toContain("SURPLUS");
    const two = await batches.stockTakeCreateUnit(w.db, { opKey: op("st"), sessionId: session.id, itemId: declared.id }, w.ctx);
    expect(two.line).toMatchObject({ receivedQty: 2 });

    const extra = await batches.stockTakeCreateUnit(w.db, { opKey: op("st"), sessionId: session.id, itemId: stranger.id }, w.ctx);
    expect(extra.line).toBeNull();
    expect(extra.exceptions.map((e) => e.type)).toContain("SURPLUS");
    // Reality is recorded under the batch's depositor; the difference is explained, not hidden.
    expect(extra.unit.ownerPartnerId).toBe(w.partner.id);

    await batches.closeCountSession(w.db, { sessionId: session.id }, w.ctx);
    const detail = await batches.getBatchDetail(w.db, batch.id);
    expect(detail.lines[0]).toMatchObject({ expectedQty: 2, receivedQty: 2 });
    expect(detail.totals.identified).toBe(3);
    const closed = await batches.closeBatch(w.db, { batchId: batch.id }, w.ctx);
    expect(closed.summary).toMatchObject({ identified: 3, surplusBoxes: 1, shortLines: [] });
  });

  it("A32: a count left idle is refused with SESSION_STALE and writes nothing; rescanning the level resumes it", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await stockTake(w);
    const { session } = await batches.openCountSession(w.db, { batchId: batch.id, locationId: w.levels[0].id }, w.ctx);
    await batches.stockTakeCreateUnit(w.db, { opKey: op("st"), sessionId: session.id, itemId: item.id }, w.ctx);
    await w.db.$executeRawUnsafe(`UPDATE "WarehouseCountSession" SET "lastActivityAt" = now() - interval '3 hours' WHERE "id" = $1`, session.id);

    const key = op("st");
    const stale = await expectCode(batches.stockTakeCreateUnit(w.db, { opKey: key, sessionId: session.id, itemId: item.id }, w.ctx), "SESSION_STALE");
    expect(stale.details).toMatchObject({ sessionId: session.id, locationId: w.levels[0].id });
    expect(await count(w.db, `"WarehouseUnit" WHERE "originBatchId" = $1`, batch.id)).toBe(1);
    expect(await count(w.db, `"WarehousePrintJob" WHERE "siteId" = $1`, w.site.id)).toBe(1);

    const again = await batches.openCountSession(w.db, { batchId: batch.id, locationId: w.levels[0].id }, w.ctx);
    expect(again.resumed).toBe(true);
    expect(again.session.id).toBe(session.id);
    // The refused gesture left its key free: the same box is now recorded once.
    const made = await batches.stockTakeCreateUnit(w.db, { opKey: key, sessionId: session.id, itemId: item.id }, w.ctx);
    expect(made.countedInSession).toBe(2);
    expect(await count(w.db, `"WarehouseUnit" WHERE "originBatchId" = $1`, batch.id)).toBe(2);
  });

  it("A28: the same pair label seen on two boxes blocks the sale, opens a discrepancy and keeps the identity", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await stockTake(w);
    const { session } = await batches.openCountSession(w.db, { batchId: batch.id, locationId: w.levels[0].id }, w.ctx);
    const made = await batches.stockTakeCreateUnit(w.db, { opKey: op("st"), sessionId: session.id, itemId: item.id }, w.ctx);
    // Scanning the same label a second time in the same count never adds a pair, and says what to do.
    const again = await batches.stockTakeScanUnit(w.db, { opKey: op("sc"), sessionId: session.id, unitId: made.unit.id }, w.ctx);
    expect(again.result).toBe("ALREADY_COUNTED");
    expect(again.countedInSession).toBe(1);
    expect(again.message).toMatch(/double/i);

    const key = op("dup");
    const reported = await units.reportDuplicateLabel(w.db, { opKey: key, unitId: made.unit.id, note: "Deux boîtes portent ce QR", seenAtLocationId: w.levels[0].id }, w.ctx);
    expect(reported.unit.id).toBe(made.unit.id);
    expect(reported.unit.labelCode).toBe(made.unit.labelCode);
    expect(reported.unit.saleState).toBe("BLOCKED");
    const replay = await units.reportDuplicateLabel(w.db, { opKey: key, unitId: made.unit.id, note: "Deux boîtes portent ce QR", seenAtLocationId: w.levels[0].id }, w.ctx);
    expect(replay.exceptionId).toBe(reported.exceptionId);
    const open = await exceptions.listExceptions(w.db, { siteId: w.site.id, status: "OPEN" });
    expect(open.openByType.DUPLICATE_LABEL).toBe(1);
    expect(await count(w.db, `"WarehouseUnit" WHERE "originBatchId" = $1`, batch.id)).toBe(1);
  });

  it("A28: a pair already counted on another level of the same batch needs a confirmation and leaves a discrepancy", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await stockTake(w);
    const s1 = (await batches.openCountSession(w.db, { batchId: batch.id, locationId: w.levels[0].id }, w.ctx)).session;
    const made = await batches.stockTakeCreateUnit(w.db, { opKey: op("st"), sessionId: s1.id, itemId: item.id }, w.ctx);
    await batches.closeCountSession(w.db, { sessionId: s1.id }, w.ctx);
    const s2 = (await batches.openCountSession(w.db, { batchId: batch.id, locationId: w.levels[1].id }, w.ctx)).session;
    const ask = await expectCode(batches.stockTakeScanUnit(w.db, { opKey: op("sc"), sessionId: s2.id, unitId: made.unit.id }, w.ctx), "CONFIRMATION_REQUIRED");
    expect(ask.details.countedElsewhereCode).toBe(w.levels[0].code);
    expect((await units.getUnitSummary(w.db, made.unit.id)).currentLocationId).toBe(w.levels[0].id);
    const moved = await batches.stockTakeScanUnit(w.db, { opKey: op("sc"), sessionId: s2.id, unitId: made.unit.id, confirmMove: true }, w.ctx);
    expect(moved.result).toBe("MOVED_HERE");
    expect(moved.exceptions.map((e) => e.type)).toContain("DUPLICATE_SCAN");
    expect(await count(w.db, `"WarehouseUnit" WHERE "originBatchId" = $1`, batch.id)).toBe(1);
  });

  it("A09: a pair that already left the stock does not come back by being scanned during a count", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const rb = await makeReceivingBatch(w);
    const r = await receiveOne(w, rb.id, item.id);
    await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: r.unit.id, locationId: w.levels[0].id, acceptMismatch: true }, w.ctx);
    await units.markUnitOut(w.db, { opKey: op("out"), unitId: r.unit.id, outReason: "WITHDRAWN", reason: "Retrait par le déposant" }, admin);
    const batch = await stockTake(w);
    const { session } = await batches.openCountSession(w.db, { batchId: batch.id, locationId: w.levels[0].id }, w.ctx);
    const scan = await batches.stockTakeScanUnit(w.db, { opKey: op("sc"), sessionId: session.id, unitId: r.unit.id, confirmMove: true, acknowledgeOwner: true }, w.ctx);
    expect(scan.result).toBe("NOT_COUNTED_EXCEPTION");
    expect(scan.exceptions.length).toBeGreaterThan(0);
    const after = await units.getUnitSummary(w.db, r.unit.id);
    expect(after.presence).toBe("OUT");
    expect(after.currentLocationId).toBeNull();
    expect((await locations.getLocation(w.db, w.levels[0].id)).occupiedCount).toBe(0);
  });

  it("A03: a movement made on the level while it is being counted is reported when the count closes", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const rb = await makeReceivingBatch(w);
    const r = await receiveOne(w, rb.id, item.id);
    const batch = await stockTake(w);
    const { session } = await batches.openCountSession(w.db, { batchId: batch.id, locationId: w.levels[0].id }, w.ctx);
    await batches.stockTakeCreateUnit(w.db, { opKey: op("st"), sessionId: session.id, itemId: item.id }, w.ctx);
    // Station 2 shelves another pair on the very level being counted.
    await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: r.unit.id, locationId: w.levels[0].id, acceptMismatch: true }, w.ctx2);
    const closed = await batches.closeCountSession(w.db, { sessionId: session.id }, w.ctx);
    expect(closed.movementsDuringCount).toBeGreaterThanOrEqual(1);
    expect(closed.notScanned.map((n) => n.unitId)).toContain(r.unit.id);
    expect(closed.exceptionId).not.toBeNull();
    // Nothing was removed: the unscanned pair is still recorded on the level.
    expect((await units.getUnitSummary(w.db, r.unit.id)).currentLocationId).toBe(w.levels[0].id);
  });

  it("C49: the batch reports its real pace — pairs, active time, reprints, levels, discrepancies", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await stockTake(w);
    const { session } = await batches.openCountSession(w.db, { batchId: batch.id, locationId: w.levels[0].id }, w.ctx);
    const made = [];
    for (let i = 0; i < 6; i += 1) made.push(await batches.stockTakeCreateUnit(w.db, { opKey: op("st"), sessionId: session.id, itemId: item.id }, w.ctx));
    // Three boxes over 2 minutes, a 40-minute pause that must not count as work, three more over 2 minutes.
    const at = [50, 49, 48, 8, 7, 6];
    for (let i = 0; i < 6; i += 1) {
      await w.db.$executeRawUnsafe(`UPDATE "WarehouseUnit" SET "receivedAt" = now() - make_interval(mins => $2::int) WHERE "id" = $1`, made[i].unit.id, at[i]);
    }
    await printing.reprintUnitLabel(w.db, { opKey: op("rp"), unitId: made[0].unit.id, stationId: w.station.id, reason: "Étiquette froissée" }, w.ctx);
    await batches.closeCountSession(w.db, { sessionId: session.id }, w.ctx);
    const pace = (await batches.getBatchDetail(w.db, batch.id)).pace;
    expect(pace.pairs).toBe(6);
    expect(pace.elapsedMinutes).toBeGreaterThanOrEqual(43.5);
    expect(pace.activeMinutes).toBeGreaterThanOrEqual(3.9);
    expect(pace.activeMinutes).toBeLessThanOrEqual(4.2);
    // 5 intervals in 4 active minutes = 75 pairs/hour; the pause is left out.
    expect(pace.pairsPerActiveHour).toBe(75);
    expect(pace.reprints).toBe(1);
    expect(pace.levelsCounted).toBe(1);
    const closed = await batches.closeBatch(w.db, { batchId: batch.id }, w.ctx);
    expect((closed.summary as any).pace.pairs).toBe(6);
  });
});

d("M2 — putaway (A35, A36, A37)", () => {
  it("A37: a box that does not fit the level's format needs an explicit confirmation, which is kept in the movement", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const large = await batches.receiveUnit(w.db, { opKey: op("rcv"), batchId: batch.id, itemId: item.id, boxProfile: "large" }, w.ctx);
    expect(large.unit.boxProfile).toBe("LARGE");
    const standard = await receiveOne(w, batch.id, item.id);
    expect(standard.unit.boxProfile).toBe("STANDARD");
    await expectCode(batches.receiveUnit(w.db, { opKey: op("rcv"), batchId: batch.id, itemId: item.id, boxProfile: "très grande !" }, w.ctx), "INVALID_INPUT");

    const small = await locations.updateLocation(w.db, w.levels[0].id, { sizeProfile: "STANDARD" });
    expect(small.sizeProfile).toBe("STANDARD");
    const refused = await expectCode(
      putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: large.unit.id, locationId: small.id, acceptMismatch: true }, w.ctx),
      "SIZE_PROFILE_MISMATCH"
    );
    expect(refused.details).toMatchObject({ confirm: "acceptProfileMismatch", levelProfile: "STANDARD", boxProfile: "LARGE" });
    expect((await units.getUnitSummary(w.db, large.unit.id)).currentLocationId).toBe(w.cart.id);

    const forced = await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: large.unit.id, locationId: small.id, acceptMismatch: true, acceptProfileMismatch: true }, w.ctx);
    expect(forced.result).toBe("MOVED");
    const mv = await w.db.$queryRawUnsafe<{ changes: any }[]>(`SELECT "changes" FROM "WarehouseMovement" WHERE "unitId" = $1 ORDER BY "seq" DESC LIMIT 1`, large.unit.id);
    expect(JSON.stringify(mv[0].changes)).toContain("profileMismatch");
    // A matching box goes in without any question; relocation applies the same rule.
    const ok = await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: standard.unit.id, locationId: small.id, acceptMismatch: true }, w.ctx);
    expect(ok.result).toBe("MOVED");
    await locations.updateLocation(w.db, w.levels[1].id, { sizeProfile: "LARGE" });
    await expectCode(putaway.relocateUnit(w.db, { opKey: op("rel"), unitId: standard.unit.id, toLocationId: w.levels[1].id, reason: "Réorganisation" }, w.ctx), "SIZE_PROFILE_MISMATCH");
  });

  it("A36: a level reported full on the spot gives its reservations back and is no longer proposed", async () => {
    const w = await makeWorld({ levelsPerRack: 2, capacity: 5 });
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const a = await receiveOne(w, batch.id, item.id);
    const b = await receiveOne(w, batch.id, item.id);
    const first = await putaway.proposeDestinations(w.db, { siteId: w.site.id, batchId: batch.id }, w.ctx);
    expect(first.reserved).toBe(2);
    const queue = await putaway.listPutawayQueue(w.db, { siteId: w.site.id, batchId: batch.id });
    const proposed = new Set(queue.tasks.map((t) => t.proposedLocationId));
    expect(proposed.size).toBe(1);
    const fullId = [...proposed][0] as string;

    const key = op("full");
    const reported = await putaway.reportLevelFull(w.db, { opKey: key, locationId: fullId, note: "Rayon déjà plein de cartons" }, w.ctx);
    expect(reported.releasedReservations).toBe(2);
    const replay = await putaway.reportLevelFull(w.db, { opKey: key, locationId: fullId, note: "Rayon déjà plein de cartons" }, w.ctx);
    expect(replay.exceptionId).toBe(reported.exceptionId);
    const level = await locations.getLocation(w.db, fullId);
    expect(level.status).toBe("BLOCKED");
    expect(level.reservedCount).toBe(0);
    expect((await exceptions.listExceptions(w.db, { siteId: w.site.id, status: "OPEN" })).openByType.LEVEL_FULL).toBe(1);

    const second = await putaway.proposeDestinations(w.db, { siteId: w.site.id, batchId: batch.id }, w.ctx);
    expect(second.reserved).toBe(2);
    const after = await putaway.listPutawayQueue(w.db, { siteId: w.site.id, batchId: batch.id });
    for (const t of after.tasks) expect(t.proposedLocationId).not.toBe(fullId);
    expect([a.unit.id, b.unit.id].sort()).toEqual(after.tasks.map((t) => t.unit.id).sort());
  });

  it("A35: closing a receiving batch with pairs still on the cart keeps them to put away and says so", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const a = await receiveOne(w, batch.id, item.id);
    const b = await receiveOne(w, batch.id, item.id);
    await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: a.unit.id, locationId: w.levels[0].id, acceptMismatch: true }, w.ctx);
    const closed = await batches.closeBatch(w.db, { batchId: batch.id }, w.ctx);
    expect(closed.batch.status).toBe("CLOSED");
    expect(closed.summary).toMatchObject({ identified: 2, confirmedOnShelf: 1, stillToPutAway: 1 });
    // The pair on the cart is not lost with the batch: its task is still in the queue and it can be shelved.
    const queue = await putaway.listPutawayQueue(w.db, { siteId: w.site.id });
    expect(queue.tasks.map((t) => t.unit.id)).toContain(b.unit.id);
    const put = await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: b.unit.id, locationId: w.levels[0].id, acceptMismatch: true }, w.ctx);
    expect(put.result).toBe("MOVED");
  });
});

d("M2 — printing and supervision (C13, C34, C44)", () => {
  it("C13: a job is never rerouted to a printer that is not declared for that label type", async () => {
    const w = await makeWorld();
    const shipping = await printing.createPrinter(w.db, { siteId: w.site.id, name: "Zebra colis 100x150", adapter: "QZ_TRAY", systemName: "ZD-ship", mediaWidthMm: 100, mediaHeightMm: 150, supportedKinds: ["LOCATION"] });
    const spare = await printing.createPrinter(w.db, { siteId: w.site.id, name: "Zebra secours", adapter: "QZ_TRAY", systemName: "ZD-spare", mediaWidthMm: 50, mediaHeightMm: 30, supportedKinds: ["PAIR"] });
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    const job = (await printing.claimNextPrintJob(w.db, { stationId: w.station.id }))!;
    await printing.reportPrintJob(w.db, { jobId: job.id, claimToken: job.claimToken, outcome: "FAILED", error: "Plus de papier" }, w.ctx);

    const refused = await expectCode(printing.actOnPrintJob(w.db, { jobId: job.id, action: "REROUTE", printerId: shipping.id }, w.ctx), "PRINT_ROUTE_MISSING");
    expect(refused.details).toMatchObject({ labelKind: "PAIR", supportedKinds: ["LOCATION"] });
    expect((await printing.getPrintJob(w.db, job.id)).printerId).toBe(w.printer.id);

    const rerouted = await printing.actOnPrintJob(w.db, { jobId: job.id, action: "REROUTE", printerId: spare.id }, w.ctx);
    expect(rerouted.printerId).toBe(spare.id);
    expect(rerouted.status).toBe("QUEUED");
    // Same job, same code: a reroute is not a new label, and never a new pair.
    expect(rerouted.labelCode).toBe(r.unit.labelCode);
    expect(await count(w.db, `"WarehousePrintJob" WHERE "objectId" = $1`, r.unit.id)).toBe(1);
  });

  it("C34: the batch reference and the day's figures follow the site's own calendar day, not the server's", async () => {
    const db = testDb();
    const w = await makeWorld();
    // UTC+14 and UTC-11 never share a calendar day: one of them differs from the server's UTC day at any time.
    const localDay = (tz: string, sep = "") => {
      const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      const get = (t: string) => p.find((x) => x.type === t)!.value;
      return [get("year"), get("month"), get("day")].join(sep);
    };
    for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      let site: locations.SiteRow | null = null;
      for (let i = 0; i < 40 && !site; i += 1) {
        const code = `${"KLMNPQRSTUVWX"[Math.floor(Math.random() * 13)]}${"KLMNPQRSTUVWX"[Math.floor(Math.random() * 13)]}${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
        site = await locations.createSite(db, { code, name: `Site ${tz}`, countryCode: "CH", timezone: tz }).catch(() => null);
      }
      expect(site).not.toBeNull();
      const cart = await locations.createSpecialLocation(db, { siteId: site!.id, kind: "CART" });
      const batch = await batches.createBatch(
        db,
        { siteId: site!.id, kind: "RECEIVING", flow: "CONSIGNMENT", ownerKind: "PARTNER", ownerPartnerId: w.partner.id, receivingLocationId: cart.id },
        { role: "logistics", operatorId: null, stationId: null }
      );
      expect(batch.reference).toContain(localDay(tz));
      const item = await makeItem(db);
      await batches.receiveUnit(db, { opKey: op("rcv"), batchId: batch.id, itemId: item.id, print: false }, { role: "logistics", operatorId: null, stationId: null });
      const overview = await getOverview(db, site!.id);
      expect(overview.today).toMatchObject({ day: localDay(tz, "-"), timezone: tz, pairsEntered: 1, pairsShelved: 0 });
    }
    expect(localDay("Pacific/Kiritimati")).not.toBe(localDay("Pacific/Pago_Pago"));
  });

  it("C44 + C29: the overview flags counters that disagree with the tasks, and reports storage health", async () => {
    const w = await makeWorld();
    const clean = await getOverview(w.db, w.site.id);
    expect(clean.alerts.map((a) => a.code)).not.toContain("COUNTERS_INCONSISTENT");
    expect(clean.health.databaseReadOnly).toBe(false);
    expect(clean.alerts.map((a) => a.code)).not.toContain("DATABASE_READ_ONLY");

    // A drift that only a bug or a manual edit could create.
    await w.db.$executeRawUnsafe(`UPDATE "WarehouseLocation" SET "reservedCount" = 2 WHERE "id" = $1`, w.levels[0].id);
    const drifted = await getOverview(w.db, w.site.id);
    const alert = drifted.alerts.find((a) => a.code === "COUNTERS_INCONSISTENT");
    expect(alert).toBeTruthy();
    expect(alert!.count).toBe(2);
    const fixed = await locations.reconcileLocationCounters(w.db, { siteId: w.site.id, fix: true });
    expect(fixed.fixed).toBeGreaterThanOrEqual(1);
    expect((await getOverview(w.db, w.site.id)).alerts.map((a) => a.code)).not.toContain("COUNTERS_INCONSISTENT");
  });
});
