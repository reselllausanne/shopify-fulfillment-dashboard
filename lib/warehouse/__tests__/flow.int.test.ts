import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import * as batches from "../batches";
import { withTx } from "../db";
import * as locations from "../locations";
import { getOperationResult } from "../operations";
import { getOverview, getStockReconciliation } from "../overview";
import * as putaway from "../putaway";
import * as transfers from "../transfers";
import * as units from "../units";
import { HAS_DB, admin, closeTestDb, count, expectCode, makeItem, makePartner, makeReceivingBatch, makeWorld, op, receiveOne, testDb } from "./harness";

const d = describe.skipIf(!HAS_DB);
afterAll(closeTestDb);

d("receiving — one confirmed box = one permanent identity", () => {
  it("ten boxes with the same GTIN give ten UUIDs, ten label codes, ten putaway tasks (roadmap §9)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const results = [];
    for (let i = 0; i < 10; i += 1) results.push(await receiveOne(w, batch.id, item.id));
    const ids = new Set(results.map((r) => r.unit.id));
    const codes = new Set(results.map((r) => r.unit.labelCode));
    expect(ids.size).toBe(10);
    expect(codes.size).toBe(10);
    for (const r of results) {
      expect(r.unit.labelCode).toBe(`${r.unit.id}-${w.site.code}`);
      expect(r.unit.currentLocationCode).toBe(w.cart.code);
      expect(r.unit.ownerPartnerId).toBe(w.partner.id);
      expect(r.unit.qcState).toBe("PENDING");
      expect(r.unit.saleState).toBe("STORAGE_ONLY");
      expect(r.print.status).toBe("QUEUED");
      expect(r.taskId).toBeTruthy();
    }
    expect(await count(w.db, `"WarehouseUnit" WHERE "originBatchId" = $1`, batch.id)).toBe(10);
    expect(await count(w.db, `"WarehousePrintJob" WHERE "siteId" = $1 AND "labelKind" = 'PAIR'`, w.site.id)).toBe(10);
    expect(await count(w.db, `"WarehouseLabelJournal" j JOIN "WarehouseUnit" u ON u."id" = j."unitId" WHERE u."originBatchId" = $1`, batch.id)).toBe(10);
    const cart = await locations.getLocation(w.db, w.cart.id);
    expect(cart.occupiedCount).toBe(10);
  });

  it("re-sending the same action key returns the same pair: no duplicate, no second movement, no second print (C06, C07)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const opKey = op("rcv");
    const input = { opKey, batchId: batch.id, itemId: item.id, condition: "NEW" as const };
    const first = await batches.receiveUnit(w.db, input, w.ctx);
    const again = await batches.receiveUnit(w.db, input, w.ctx);
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(again.unit.id).toBe(first.unit.id);
    expect(await count(w.db, `"WarehouseUnit" WHERE "originBatchId" = $1`, batch.id)).toBe(1);
    expect(await count(w.db, `"WarehouseMovement" WHERE "unitId" = $1`, first.unit.id)).toBe(1);
    expect(await count(w.db, `"WarehousePrintJob" WHERE "objectId" = $1`, first.unit.id)).toBe(1);
    // The lost HTTP answer can be fetched back by key.
    const stored = (await getOperationResult(w.db, opKey)) as any;
    expect(stored?.result?.unit?.id ?? stored?.unit?.id).toBe(first.unit.id);
  });

  it("a double click fired in parallel creates exactly one pair (C07)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const input = { opKey: op("rcv"), batchId: batch.id, itemId: item.id };
    const settled = await Promise.allSettled([1, 2, 3, 4].map(() => batches.receiveUnit(w.db, input, w.ctx)));
    const okIds = new Set(settled.filter((s) => s.status === "fulfilled").map((s: any) => s.value.unit.id));
    expect(okIds.size).toBe(1);
    // A loser may get a retryable CONFLICT (the winner had not committed yet) — never a second pair.
    for (const s of settled) if (s.status === "rejected") expect((s.reason as any).code).toBe("CONFLICT");
    expect(await count(w.db, `"WarehouseUnit" WHERE "originBatchId" = $1`, batch.id)).toBe(1);
  });

  it("the same key with another payload is refused (C08)", async () => {
    const w = await makeWorld();
    const [a, b] = [await makeItem(w.db), await makeItem(w.db)];
    const batch = await makeReceivingBatch(w);
    const opKey = op("rcv");
    await batches.receiveUnit(w.db, { opKey, batchId: batch.id, itemId: a.id }, w.ctx);
    await expectCode(batches.receiveUnit(w.db, { opKey, batchId: batch.id, itemId: b.id }, w.ctx), "OPKEY_REUSED");
    expect(await count(w.db, `"WarehouseUnit" WHERE "originBatchId" = $1`, batch.id)).toBe(1);
  });

  it("a failed gesture writes nothing and its key stays usable (C09)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    await batches.setBatchStatus(w.db, { batchId: batch.id, action: "PAUSE" });
    const opKey = op("rcv");
    await expectCode(batches.receiveUnit(w.db, { opKey, batchId: batch.id, itemId: item.id }, w.ctx), "BATCH_NOT_OPEN");
    expect(await count(w.db, `"WarehouseOperation" WHERE "opKey" = $1`, opKey)).toBe(0);
    await batches.setBatchStatus(w.db, { batchId: batch.id, action: "RESUME" });
    const ok = await batches.receiveUnit(w.db, { opKey, batchId: batch.id, itemId: item.id }, w.ctx);
    expect(ok.replayed).toBe(false);
  });

  it("an unexpected box in a batch with a known content is kept apart: owner unknown, sale blocked, discrepancy (A12)", async () => {
    const w = await makeWorld();
    const [expected, surprise] = [await makeItem(w.db), await makeItem(w.db)];
    const batch = await makeReceivingBatch(w);
    await batches.addBatchLines(w.db, batch.id, [{ itemId: expected.id, expectedQty: 1 }]);
    const ok = await receiveOne(w, batch.id, expected.id);
    expect(ok.line?.receivedQty).toBe(1);
    expect(ok.exception).toBeNull();
    const extra = await receiveOne(w, batch.id, surprise.id);
    expect(extra.exception?.type).toBe("SURPLUS");
    expect(extra.unit.ownerKind).toBe("UNKNOWN");
    expect(extra.unit.saleState).toBe("BLOCKED");
    // One more of the expected variant than announced is a surplus too.
    const over = await receiveOne(w, batch.id, expected.id);
    expect(over.exception?.type).toBe("SURPLUS");
  });

  it("order-transit and customer-return flows are refused explicitly in lot 1", async () => {
    const w = await makeWorld();
    await expectCode(makeReceivingBatch(w, { flow: "ORDER_TRANSIT" }), "INVALID_INPUT");
    await expectCode(makeReceivingBatch(w, { flow: "CUSTOMER_RETURN" }), "INVALID_INPUT");
  });

  it("UUID collision: the database refuses the duplicate and a new UUID is drawn before printing (C02)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const first = await receiveOne(w, batch.id, item.id);
    const fresh = randomUUID();
    const draws = [first.unit.id, first.unit.id, fresh];
    const created = await withTx(w.db, (tx) =>
      units.createUnitTx(
        tx,
        {
          siteId: w.site.id,
          siteCode: w.site.code,
          itemId: item.id,
          ownerKind: "OWN",
          originType: "OWN_STOCK",
          locationId: w.cart.id,
          movementType: "RECEIVE",
          generateId: () => draws.shift() as string,
        },
        w.ctx,
        null
      )
    );
    expect(created.collisions).toBe(2);
    expect(created.unit.id).toBe(fresh);
    expect(await count(w.db, `"WarehouseLabelCode" WHERE "unitId" = $1`, first.unit.id)).toBe(1);
  });
});

d("putaway — proposal, reservation and confirmation", () => {
  it("proposes places in walk order, never more than the capacity, and confirms by pair then level", async () => {
    const w = await makeWorld({ levelsPerRack: 2, capacity: 2 });
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const received = [];
    for (let i = 0; i < 5; i += 1) received.push(await receiveOne(w, batch.id, item.id));
    const proposal = await putaway.proposeDestinations(w.db, { siteId: w.site.id, batchId: batch.id }, w.ctx);
    expect(proposal).toEqual({ reserved: 4, noSlot: 1, remainingPending: 1 });
    const levels = (await locations.listLocations(w.db, { siteId: w.site.id, kinds: ["LEVEL"] })).items;
    for (const l of levels) expect(l.occupiedCount + l.reservedCount).toBeLessThanOrEqual(l.capacity as number);
    expect(levels.reduce((s, l) => s + l.reservedCount, 0)).toBe(4);

    const queue = await putaway.listPutawayQueue(w.db, { siteId: w.site.id, batchId: batch.id });
    expect(queue.counts).toMatchObject({ total: 5, reserved: 4, pending: 1 });
    const task = queue.tasks.find((t) => t.proposedLocationId)!;
    const done = await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: task.unit.id, locationId: task.proposedLocationId! }, w.ctx);
    expect(done.result).toBe("MOVED");
    expect(done.deviated).toBe(false);
    expect(done.unit.currentLocationId).toBe(task.proposedLocationId);
    expect(done.remainingInScope).toBe(4);
    const level = await locations.getLocation(w.db, task.proposedLocationId!);
    // The reservation became an occupation: the total held is unchanged.
    expect(level.occupiedCount + level.reservedCount).toBe(2);
    const cart = await locations.getLocation(w.db, w.cart.id);
    expect(cart.occupiedCount).toBe(4);
  });

  it("the same pair scanned twice on the same level counts once (roadmap §9)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    const level = w.levels[0];
    const first = await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: r.unit.id, locationId: level.id, acceptMismatch: true }, w.ctx);
    const second = await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: r.unit.id, locationId: level.id, acceptMismatch: true }, w.ctx2);
    expect(first.result).toBe("MOVED");
    expect(second.result).toBe("ALREADY_THERE");
    expect((await locations.getLocation(w.db, level.id)).occupiedCount).toBe(1);
    expect(await count(w.db, `"WarehouseMovement" WHERE "unitId" = $1 AND "type" = 'PUTAWAY'`, r.unit.id)).toBe(1);
  });

  it("two stations fighting for the last place: one wins, the other is told the level is full, no overbooking (roadmap §9)", async () => {
    const w = await makeWorld({ levelsPerRack: 1, capacity: 1 });
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const a = await receiveOne(w, batch.id, item.id);
    const b = await receiveOne(w, batch.id, item.id);
    const level = w.levels[0];
    const settled = await Promise.allSettled([
      putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: a.unit.id, locationId: level.id, acceptMismatch: true }, w.ctx),
      putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: b.unit.id, locationId: level.id, acceptMismatch: true }, w.ctx2),
    ]);
    const wins = settled.filter((s) => s.status === "fulfilled");
    const losses = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
    expect(wins.length).toBe(1);
    expect(losses.length).toBe(1);
    expect(losses[0].reason.code).toBe("LEVEL_FULL");
    const after = await locations.getLocation(w.db, level.id);
    expect(after.occupiedCount).toBe(1);
    expect(after.reservedCount).toBe(0);
    // The loser's pair is still on the cart, with its task.
    const loserId = (wins[0] as any).value.unit.id === a.unit.id ? b.unit.id : a.unit.id;
    expect((await units.getUnitSummary(w.db, loserId)).currentLocationId).toBe(w.cart.id);
  });

  it("many concurrent proposals never reserve more than the capacity", async () => {
    const w = await makeWorld({ levelsPerRack: 2, capacity: 3 });
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) ids.push((await receiveOne(w, batch.id, item.id)).unit.id);
    await Promise.all(ids.map((id) => putaway.proposeDestinations(w.db, { siteId: w.site.id, unitIds: [id] }, w.ctx)));
    const levels = (await locations.listLocations(w.db, { siteId: w.site.id, kinds: ["LEVEL"] })).items;
    for (const l of levels) expect(l.reservedCount).toBeLessThanOrEqual(l.capacity as number);
    expect(levels.reduce((s, l) => s + l.reservedCount, 0)).toBe(6);
    expect(await count(w.db, `"WarehousePutawayTask" WHERE "siteId" = $1 AND "status" = 'RESERVED'`, w.site.id)).toBe(6);
    const drift = await locations.reconcileLocationCounters(w.db, { siteId: w.site.id });
    expect(drift.drifts).toEqual([]);
  });

  it("another level than the proposed one needs an explicit confirmation, then releases the reserved place (A33)", async () => {
    const w = await makeWorld({ levelsPerRack: 2, capacity: 2 });
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    await putaway.proposeDestinations(w.db, { siteId: w.site.id, batchId: batch.id }, w.ctx);
    const task = (await putaway.listPutawayQueue(w.db, { siteId: w.site.id, batchId: batch.id })).tasks[0];
    const other = w.levels.find((l) => l.id !== task.proposedLocationId)!;
    const opKey = op("put");
    const err = await expectCode(putaway.confirmPutaway(w.db, { opKey, unitId: r.unit.id, locationId: other.id }, w.ctx), "DESTINATION_MISMATCH");
    expect(err.details).toBeTruthy();
    expect((await units.getUnitSummary(w.db, r.unit.id)).currentLocationId).toBe(w.cart.id);
    const done = await putaway.confirmPutaway(w.db, { opKey, unitId: r.unit.id, locationId: other.id, acceptMismatch: true }, w.ctx);
    expect(done.deviated).toBe(true);
    expect((await locations.getLocation(w.db, task.proposedLocationId!)).reservedCount).toBe(0);
    expect((await locations.getLocation(w.db, other.id)).occupiedCount).toBe(1);
  });

  it("refuses a blocked level, another site's level and a non-level code; nothing moves (A35, C14)", async () => {
    const w = await makeWorld();
    const other = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    await locations.setLocationStatus(w.db, w.levels[0].id, { status: "BLOCKED", reason: "Étagère cassée" }, admin);
    await expectCode(putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: r.unit.id, locationId: w.levels[0].id, acceptMismatch: true }, w.ctx), "LOCATION_NOT_USABLE");
    await expectCode(putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: r.unit.id, locationId: other.levels[0].id, acceptMismatch: true }, w.ctx), "SITE_MISMATCH");
    await expectCode(putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: r.unit.id, locationId: w.receiving.id, acceptMismatch: true }, w.ctx), "WRONG_CODE_TYPE");
    const still = await units.getUnitSummary(w.db, r.unit.id);
    expect(still.currentLocationId).toBe(w.cart.id);
    expect(still.version).toBe(r.unit.version);
  });

  it("blocking a level releases its reservations and sends the tasks back for a new proposal (A36)", async () => {
    const w = await makeWorld({ levelsPerRack: 2, capacity: 2 });
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    await receiveOne(w, batch.id, item.id);
    await putaway.proposeDestinations(w.db, { siteId: w.site.id, batchId: batch.id }, w.ctx);
    const task = (await putaway.listPutawayQueue(w.db, { siteId: w.site.id, batchId: batch.id })).tasks[0];
    const blocked = await locations.setLocationStatus(w.db, task.proposedLocationId!, { status: "BLOCKED", reason: "Inventaire" }, admin);
    expect(blocked.releasedReservations).toBe(1);
    const after = (await putaway.listPutawayQueue(w.db, { siteId: w.site.id, batchId: batch.id })).tasks[0];
    expect(after.status).toBe("PENDING");
    expect(after.holdReason).toBe("DESTINATION_BLOCKED");
    const again = await putaway.proposeDestinations(w.db, { siteId: w.site.id, batchId: batch.id }, w.ctx);
    expect(again.reserved).toBe(1);
    const reproposed = (await putaway.listPutawayQueue(w.db, { siteId: w.site.id, batchId: batch.id })).tasks[0];
    expect(reproposed.proposedLocationId).not.toBe(task.proposedLocationId);
  });

  it("an expired reservation gives its place back", async () => {
    const w = await makeWorld({ levelsPerRack: 1, capacity: 1 });
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    await receiveOne(w, batch.id, item.id);
    await putaway.proposeDestinations(w.db, { siteId: w.site.id, batchId: batch.id }, w.ctx);
    await w.db.$executeRawUnsafe(`UPDATE "WarehousePutawayTask" SET "reservationExpiresAt" = now() - interval '1 minute' WHERE "siteId" = $1 AND "status" = 'RESERVED'`, w.site.id);
    const expired = await putaway.expireReservations(w.db, w.site.id);
    expect(expired.expired).toBe(1);
    const level = await locations.getLocation(w.db, w.levels[0].id);
    expect(level.reservedCount).toBe(0);
  });
});

d("unit state — versions, audit and guarded corrections", () => {
  it("a stale version is refused; an older dated observation never overwrites a newer one (C43)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    const moved = await putaway.relocateUnit(w.db, { opKey: op("mv"), unitId: r.unit.id, toLocationId: w.receiving.id }, w.ctx);
    expect(moved.unit.version).toBe(r.unit.version + 1);
    await expectCode(putaway.relocateUnit(w.db, { opKey: op("mv"), unitId: r.unit.id, toLocationId: w.cart.id, expectedVersion: r.unit.version }, w.ctx2), "VERSION_CONFLICT");
    const unit = await withTx(w.db, (tx) => units.lockUnitTx(tx, r.unit.id));
    await expectCode(
      withTx(w.db, async (tx) => {
        const locked = await units.lockUnitTx(tx, r.unit.id);
        await units.applyUnitChangeTx(tx, locked, { currentLocationId: w.cart.id }, { type: "RELOCATE", observedAt: new Date(new Date(unit.observedAt).getTime() - 60_000) }, w.ctx, null);
      }),
      "VERSION_CONFLICT"
    );
    expect((await units.getUnitSummary(w.db, r.unit.id)).currentLocationId).toBe(w.receiving.id);
  });

  it("sale can only be authorised on a present, controlled pair with an agreement; quarantine blocks it (B11–B20)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    await expectCode(units.setUnitSaleState(w.db, { opKey: op("sale"), unitId: r.unit.id, saleState: "SALE_AUTHORIZED" }, w.ctx), "FORBIDDEN");
    await expectCode(units.setUnitSaleState(w.db, { opKey: op("sale"), unitId: r.unit.id, saleState: "SALE_AUTHORIZED" }, admin), "UNIT_STATE_CONFLICT");
    await units.setUnitQcState(w.db, { opKey: op("qc"), unitId: r.unit.id, qcState: "PASSED" }, w.ctx);
    const ok = await units.setUnitSaleState(w.db, { opKey: op("sale"), unitId: r.unit.id, saleState: "SALE_AUTHORIZED" }, admin);
    expect(ok.unit.saleState).toBe("SALE_AUTHORIZED");
    const q = await units.setUnitQcState(w.db, { opKey: op("qc"), unitId: r.unit.id, qcState: "QUARANTINE", reason: "Semelle décollée" }, w.ctx);
    expect(q.unit.saleState).toBe("BLOCKED");
  });

  it("owner change is admin-only, needs a reason, withdraws the sale right and is fully audited (C31)", async () => {
    const w = await makeWorld();
    const other = await makePartner(w.db, "Autre déposant");
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    await expectCode(units.changeUnitOwner(w.db, { opKey: op("own"), unitId: r.unit.id, ownerKind: "PARTNER", ownerPartnerId: other.id, reason: "Erreur de lot" }, w.ctx), "FORBIDDEN");
    await expectCode(units.changeUnitOwner(w.db, { opKey: op("own"), unitId: r.unit.id, ownerKind: "PARTNER", ownerPartnerId: other.id }, admin), "INVALID_INPUT");
    const changed = await units.changeUnitOwner(w.db, { opKey: op("own"), unitId: r.unit.id, ownerKind: "PARTNER", ownerPartnerId: other.id, reason: "Erreur de lot" }, admin);
    expect(changed.unit.ownerPartnerId).toBe(other.id);
    expect(changed.unit.saleState).toBe("STORAGE_ONLY");
    const detail = await units.getUnitDetail(w.db, r.unit.id);
    const move = detail.movements.find((m) => m.type === "OWNER_CHANGE")!;
    expect(move.reason).toBe("Erreur de lot");
    expect(JSON.stringify(move.changes)).toContain(w.partner.id);
  });

  it("missing then found again: the pair keeps its identity and its place is freed meanwhile (A41–A44)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    const level = w.levels[0];
    await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: r.unit.id, locationId: level.id, acceptMismatch: true }, w.ctx);
    const missing = await units.markUnitMissing(w.db, { opKey: op("miss"), unitId: r.unit.id, reason: "Absente au comptage" }, w.ctx);
    expect(missing.unit.presence).toBe("MISSING");
    expect(missing.exceptionId).toBeTruthy();
    expect((await locations.getLocation(w.db, level.id)).occupiedCount).toBe(0);
    const found = await putaway.relocateUnit(w.db, { opKey: op("mv"), unitId: r.unit.id, toLocationId: w.levels[1].id, reason: "Retrouvée" }, w.ctx);
    expect(found.unit.presence).toBe("PRESENT");
    expect(found.unit.id).toBe(r.unit.id);
    expect(found.unit.labelCode).toBe(r.unit.labelCode);
  });

  it("the database itself refuses to delete a pair, rewrite its identity or edit history (C01, C41)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    const raw = (sql: string, ...p: unknown[]) => w.db.$executeRawUnsafe(sql, ...p);
    await expect(raw(`DELETE FROM "WarehouseUnit" WHERE "id" = $1`, r.unit.id)).rejects.toThrow(/cannot be deleted/);
    await expect(raw(`UPDATE "WarehouseUnit" SET "labelCode" = 'x' WHERE "id" = $1`, r.unit.id)).rejects.toThrow(/immutable/);
    await expect(raw(`UPDATE "WarehouseUnit" SET "issuingSiteCode" = 'ZZ99' WHERE "id" = $1`, r.unit.id)).rejects.toThrow(/immutable/);
    await expect(raw(`DELETE FROM "WarehouseMovement" WHERE "unitId" = $1`, r.unit.id)).rejects.toThrow(/append-only/);
    await expect(raw(`UPDATE "WarehouseMovement" SET "reason" = 'x' WHERE "unitId" = $1`, r.unit.id)).rejects.toThrow(/append-only/);
    await expect(raw(`DELETE FROM "WarehouseLabelCode" WHERE "unitId" = $1`, r.unit.id)).rejects.toThrow();
    await expect(raw(`UPDATE "WarehouseLabelCode" SET "unitId" = $2 WHERE "unitId" = $1`, r.unit.id, randomUUID())).rejects.toThrow();
    await expect(raw(`UPDATE "WarehouseSite" SET "code" = 'ZZ98' WHERE "id" = $1`, w.site.id)).rejects.toThrow();
    await expect(raw(`TRUNCATE "WarehouseUnit" CASCADE`)).rejects.toThrow();
  });
});

d("inter-site transfer — the QR survives (roadmap §9)", () => {
  it("a pair issued at one site is shipped, received abroad and keeps its UUID and label code", async () => {
    const ch = await makeWorld();
    const de = await makeWorld();
    const item = await makeItem(ch.db);
    const batch = await makeReceivingBatch(ch);
    const r = await receiveOne(ch, batch.id, item.id);
    const transfer = await transfers.createTransfer(ch.db, { fromSiteId: ch.site.id, toSiteId: de.site.id });
    const shipped = await transfers.shipTransferUnit(ch.db, { opKey: op("trf"), transferId: transfer.id, unitId: r.unit.id }, ch.ctx);
    expect(shipped.unit.presence).toBe("IN_TRANSIT");
    expect(shipped.unit.currentLocationId).toBeNull();
    expect((await locations.getLocation(ch.db, ch.cart.id)).occupiedCount).toBe(0);

    // Scanned at the foreign site while in transit: resolved, not "unknown".
    const scan = await units.resolveScan(de.db, r.unit.labelCode);
    expect(scan.kind).toBe("UNIT");

    const arrived = await transfers.receiveTransferUnit(de.db, { opKey: op("trf"), unitId: r.unit.id, toLocationId: de.receiving.id }, de.ctx);
    expect(arrived.unit.id).toBe(r.unit.id);
    expect(arrived.unit.labelCode).toBe(r.unit.labelCode);
    expect(arrived.unit.labelCode.endsWith(`-${ch.site.code}`)).toBe(true);
    expect(arrived.unit.issuingSiteCode).toBe(ch.site.code);
    expect(arrived.unit.currentSiteCode).toBe(de.site.code);
    expect(arrived.unit.presence).toBe("PRESENT");
    expect(arrived.taskId).toBeTruthy();
    expect(await count(ch.db, `"WarehouseLabelCode" WHERE "unitId" = $1`, r.unit.id)).toBe(1);

    // Put away abroad with the same label.
    const done = await putaway.confirmPutaway(de.db, { opKey: op("put"), unitId: r.unit.id, locationId: de.levels[0].id, acceptMismatch: true }, de.ctx);
    expect(done.unit.currentSiteCode).toBe(de.site.code);
    const detail = await units.getUnitDetail(de.db, r.unit.id);
    expect(detail.movements.map((m) => m.type)).toEqual(expect.arrayContaining(["RECEIVE", "TRANSFER_OUT", "TRANSFER_IN", "PUTAWAY"]));
  });

  it("a pair cannot be put on a foreign site's shelf without a transfer (C14)", async () => {
    const ch = await makeWorld();
    const de = await makeWorld();
    const item = await makeItem(ch.db);
    const batch = await makeReceivingBatch(ch);
    const r = await receiveOne(ch, batch.id, item.id);
    await expectCode(putaway.relocateUnit(ch.db, { opKey: op("mv"), unitId: r.unit.id, toLocationId: de.levels[0].id }, ch.ctx), "SITE_MISMATCH");
  });
});

d("overview and reconciliation", () => {
  it("counters match the unit rows and the reconciliation lists each state once (C42)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const a = await receiveOne(w, batch.id, item.id);
    await receiveOne(w, batch.id, item.id);
    await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: a.unit.id, locationId: w.levels[0].id, acceptMismatch: true }, w.ctx);
    const o = await getOverview(w.db, w.site.code);
    expect(o.stock).toMatchObject({ present: 2, shelved: 1, atTemporary: 1, missing: 0 });
    expect(o.capacity.occupied).toBe(1);
    expect(o.putaway.active).toBe(1);
    expect(o.openBatches.map((b) => b.id)).toContain(batch.id);
    expect(o.flags.outboundConnectors).toBe("none");
    const rec = await getStockReconciliation(w.db, w.site.id);
    expect(rec.totalUnits).toBe(2);
    expect(rec.distinctIds).toBe(2);
    expect(rec.rows.reduce((s, r) => s + r.units, 0)).toBe(2);
  });
});
