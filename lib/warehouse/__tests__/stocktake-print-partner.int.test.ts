import { afterAll, describe, expect, it } from "vitest";
import { allocateUnit, releaseAllocation } from "../allocations";
import { archiveOutUnitHistory, getArchivedMovements } from "../archive";
import * as batches from "../batches";
import * as exceptions from "../exceptions";
import * as imports from "../imports";
import { getOverview } from "../overview";
import * as locations from "../locations";
import * as partnerView from "../partnerView";
import * as pricing from "../pricing";
import * as printing from "../printing";
import * as putaway from "../putaway";
import * as units from "../units";
import { HAS_DB, admin, closeTestDb, count, expectCode, makeItem, makePartner, makeReceivingBatch, makeWorld, op, randomGtin, receiveOne, type World } from "./harness";

const d = describe.skipIf(!HAS_DB);
afterAll(closeTestDb);

async function stockTakeBatch(w: World) {
  return batches.createBatch(w.db, { siteId: w.site.id, kind: "STOCK_TAKE", flow: "CONSIGNMENT", ownerKind: "PARTNER", ownerPartnerId: w.partner.id, title: "Reprise" }, w.ctx);
}

d("stock-take of pairs already on the shelves (pilot flow)", () => {
  it("level → boxes → labels: pairs are born at the level, owned by the partner, without a putaway task", async () => {
    const w = await makeWorld({ capacity: 3 });
    const item = await makeItem(w.db);
    const batch = await stockTakeBatch(w);
    const level = w.levels[0];
    const { session, resumed } = await batches.openCountSession(w.db, { batchId: batch.id, locationId: level.id }, w.ctx);
    expect(resumed).toBe(false);
    const made = [];
    for (let i = 0; i < 3; i += 1) made.push(await batches.stockTakeCreateUnit(w.db, { opKey: op("st"), sessionId: session.id, itemId: item.id, condition: "NEW" }, w.ctx));
    expect(new Set(made.map((m) => m.unit.id)).size).toBe(3);
    expect(made[2].countedInSession).toBe(3);
    for (const m of made) {
      expect(m.unit.currentLocationId).toBe(level.id);
      expect(m.unit.ownerPartnerId).toBe(w.partner.id);
      expect(m.unit.originType).toBe("STOCK_TAKE");
      expect(m.print.status).toBe("QUEUED");
    }
    expect((await locations.getLocation(w.db, level.id)).occupiedCount).toBe(3);
    expect(await count(w.db, `"WarehousePutawayTask" WHERE "siteId" = $1`, w.site.id)).toBe(0);

    // Replay of one creation: same pair.
    const key = op("st");
    const once = await batches.stockTakeCreateUnit(w.db, { opKey: key, sessionId: session.id, itemId: item.id }, w.ctx);
    const twice = await batches.stockTakeCreateUnit(w.db, { opKey: key, sessionId: session.id, itemId: item.id }, w.ctx);
    expect(twice.unit.id).toBe(once.unit.id);
    expect(twice.replayed).toBe(true);
    // Reality over configuration: the 4th box of a 3-place level is recorded and flagged, not refused.
    expect(once.exceptions.map((e) => e.type)).toContain("CAPACITY_MISMATCH");

    const closed = await batches.closeCountSession(w.db, { sessionId: session.id }, w.ctx);
    expect(closed.counted).toBe(4);
    expect(closed.created).toBe(4);
    expect(closed.notScanned).toEqual([]);
    const detail = await batches.getBatchDetail(w.db, batch.id);
    expect(detail.totals.identified).toBe(4);
    expect(detail.totals.shelved).toBe(4);
  });

  it("one level is counted by one station at a time; the same station resumes; another must take over explicitly (A03)", async () => {
    const w = await makeWorld();
    const batch = await stockTakeBatch(w);
    const level = w.levels[0];
    const first = await batches.openCountSession(w.db, { batchId: batch.id, locationId: level.id }, w.ctx);
    const again = await batches.openCountSession(w.db, { batchId: batch.id, locationId: level.id }, w.ctx);
    expect(again.resumed).toBe(true);
    expect(again.session.id).toBe(first.session.id);
    await expectCode(batches.openCountSession(w.db, { batchId: batch.id, locationId: level.id }, w.ctx2), "SESSION_CONFLICT");
    const taken = await batches.openCountSession(w.db, { batchId: batch.id, locationId: level.id, takeOver: true }, w.ctx2);
    expect(taken.session.id).toBe(first.session.id);
    // A04: a browser with no paired station does not slip into a station's count either.
    const unpaired = { ...w.ctx, stationId: null };
    const refused = await expectCode(batches.openCountSession(w.db, { batchId: batch.id, locationId: level.id }, unpaired), "SESSION_CONFLICT");
    expect(refused.details).toMatchObject({ sessionId: first.session.id, takeOver: true });
    expect((await batches.openCountSession(w.db, { batchId: batch.id, locationId: level.id, takeOver: true }, unpaired)).resumed).toBe(true);
    // The desk the count was taken from stops writing into it: nothing recorded, told to rescan the level.
    const item = await makeItem(w.db);
    const late = await expectCode(batches.stockTakeCreateUnit(w.db, { opKey: op("st"), sessionId: first.session.id, itemId: item.id }, w.ctx2), "SESSION_CONFLICT");
    expect(late.details).toMatchObject({ takenOver: true });
    expect(await count(w.db, `"WarehouseUnit" WHERE "originBatchId" = $1`, batch.id)).toBe(0);
    const here = await batches.stockTakeCreateUnit(w.db, { opKey: op("st"), sessionId: first.session.id, itemId: item.id }, unpaired);
    expect(here.unit.currentLocationId).toBe(level.id);
    // …and the station it was taken from must ask in turn.
    await expectCode(batches.openCountSession(w.db, { batchId: batch.id, locationId: level.id }, w.ctx2), "SESSION_CONFLICT");
    // Same unpaired browser again: a plain resume.
    expect((await batches.openCountSession(w.db, { batchId: batch.id, locationId: level.id }, unpaired)).resumed).toBe(true);
    // A rack or a row is not a countable position: only places that hold pairs are.
    const rack = (await locations.listLocations(w.db, { siteId: w.site.id, kinds: ["RACK"] })).items[0];
    await expectCode(batches.openCountSession(w.db, { batchId: batch.id, locationId: rack.id }, w.ctx), "LOCATION_NOT_USABLE");
  });

  it("an already labelled pair found on another level is moved only after an explicit confirmation (A40)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await stockTakeBatch(w);
    const [l1, l2] = w.levels;
    const s1 = await batches.openCountSession(w.db, { batchId: batch.id, locationId: l1.id }, w.ctx);
    const made = await batches.stockTakeCreateUnit(w.db, { opKey: op("st"), sessionId: s1.session.id, itemId: item.id }, w.ctx);
    await batches.closeCountSession(w.db, { sessionId: s1.session.id }, w.ctx);

    const s2 = await batches.openCountSession(w.db, { batchId: batch.id, locationId: l2.id }, w.ctx);
    const key = op("sc");
    const err = await expectCode(batches.stockTakeScanUnit(w.db, { opKey: key, sessionId: s2.session.id, unitId: made.unit.id }, w.ctx), "CONFIRMATION_REQUIRED");
    expect(err.details.confirm).toBe("confirmMove");
    expect((await units.getUnitSummary(w.db, made.unit.id)).currentLocationId).toBe(l1.id);
    const moved = await batches.stockTakeScanUnit(w.db, { opKey: key, sessionId: s2.session.id, unitId: made.unit.id, confirmMove: true }, w.ctx);
    expect(moved.result).toBe("MOVED_HERE");
    expect(moved.unit.currentLocationId).toBe(l2.id);
    expect((await locations.getLocation(w.db, l1.id)).occupiedCount).toBe(0);
    expect((await locations.getLocation(w.db, l2.id)).occupiedCount).toBe(1);
    // Scanned again in the same session: counted once.
    const dup = await batches.stockTakeScanUnit(w.db, { opKey: op("sc"), sessionId: s2.session.id, unitId: made.unit.id }, w.ctx);
    expect(dup.result).toBe("ALREADY_COUNTED");
    expect(dup.countedInSession).toBe(1);
  });

  it("a recount lists the pairs the system places there but nobody scanned — nothing is removed silently (A06)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await stockTakeBatch(w);
    const level = w.levels[0];
    const s1 = await batches.openCountSession(w.db, { batchId: batch.id, locationId: level.id }, w.ctx);
    const a = await batches.stockTakeCreateUnit(w.db, { opKey: op("st"), sessionId: s1.session.id, itemId: item.id }, w.ctx);
    const b = await batches.stockTakeCreateUnit(w.db, { opKey: op("st"), sessionId: s1.session.id, itemId: item.id }, w.ctx);
    await batches.closeCountSession(w.db, { sessionId: s1.session.id }, w.ctx);

    const s2 = await batches.openCountSession(w.db, { batchId: batch.id, locationId: level.id }, w.ctx);
    expect(s2.session.notYetScanned.length).toBe(2);
    const found = await batches.stockTakeScanUnit(w.db, { opKey: op("sc"), sessionId: s2.session.id, unitId: a.unit.id }, w.ctx);
    expect(found.result).toBe("FOUND_HERE");
    const closed = await batches.closeCountSession(w.db, { sessionId: s2.session.id }, w.ctx);
    expect(closed.notScanned.map((n) => n.unitId)).toEqual([b.unit.id]);
    expect(closed.exceptionId).toBeTruthy();
    // The unscanned pair is still recorded here until someone decides.
    const still = await units.getUnitSummary(w.db, b.unit.id);
    expect(still.presence).toBe("PRESENT");
    expect(still.currentLocationId).toBe(level.id);
    const open = await exceptions.listExceptions(w.db, { siteId: w.site.id, status: "OPEN" });
    expect(open.openByType.COUNT_MISMATCH).toBe(1);
    const resolved = await exceptions.resolveException(w.db, { id: closed.exceptionId!, status: "RESOLVED", resolution: "Recomptée, présente", reason: "Second comptage" }, w.ctx);
    expect(resolved.status).toBe("RESOLVED");
  });

  it("a count never changes the owner: another owner's pair is counted and flagged (A02)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const own = await batches.createBatch(w.db, { siteId: w.site.id, kind: "RECEIVING", flow: "OWN_STOCK", ownerKind: "OWN", receivingLocationId: w.cart.id }, w.ctx);
    const r = await receiveOne(w, own.id, item.id);
    const level = w.levels[0];
    await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: r.unit.id, locationId: level.id, acceptMismatch: true }, w.ctx);
    const batch = await stockTakeBatch(w);
    const s = await batches.openCountSession(w.db, { batchId: batch.id, locationId: level.id }, w.ctx);
    const key = op("sc");
    const err = await expectCode(batches.stockTakeScanUnit(w.db, { opKey: key, sessionId: s.session.id, unitId: r.unit.id }, w.ctx), "CONFIRMATION_REQUIRED");
    expect(err.details.confirm).toBe("acknowledgeOwner");
    const counted = await batches.stockTakeScanUnit(w.db, { opKey: key, sessionId: s.session.id, unitId: r.unit.id, acknowledgeOwner: true }, w.ctx);
    expect(counted.unit.ownerKind).toBe("OWN");
    expect(counted.exceptions.map((e) => e.type)).toContain("OWNER_SUSPECT");
  });

  it("closing a batch with an open count is refused; a short batch needs a reason (A10)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await stockTakeBatch(w);
    const s = await batches.openCountSession(w.db, { batchId: batch.id, locationId: w.levels[0].id }, w.ctx);
    await expectCode(batches.closeBatch(w.db, { batchId: batch.id }, w.ctx), "SESSION_CONFLICT");
    await batches.closeCountSession(w.db, { sessionId: s.session.id }, w.ctx);
    const closed = await batches.closeBatch(w.db, { batchId: batch.id }, w.ctx);
    expect(closed.batch.status).toBe("CLOSED");

    const recv = await makeReceivingBatch(w);
    await batches.addBatchLines(w.db, recv.id, [{ itemId: item.id, expectedQty: 2 }]);
    await receiveOne(w, recv.id, item.id);
    await expectCode(batches.closeBatch(w.db, { batchId: recv.id }, w.ctx), "INVALID_INPUT");
    const short = await batches.closeBatch(w.db, { batchId: recv.id, reason: "Une paire non livrée" }, w.ctx);
    expect(short.batch.status).toBe("CLOSED");
    const open = await exceptions.listExceptions(w.db, { batchId: recv.id, status: "OPEN" });
    expect(open.items.map((e) => e.type)).toContain("MISSING");
  });
});

d("label printing — station queue, failure and uncertainty", () => {
  it("no route configured: the pair exists, the label is 'to print', nothing is lost (A31)", async () => {
    const w = await makeWorld({ routePrinter: false });
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    expect(r.print).toMatchObject({ status: "NOT_QUEUED", reason: "NO_ROUTE" });
    expect(r.unit.id).toBeTruthy();
    // Printer added and routed from the interface: the label can now be queued (roadmap §9).
    await printing.setStationRoute(w.db, { stationId: w.station.id, labelKind: "PAIR", printerId: w.printer.id });
    const re = await printing.reprintUnitLabel(w.db, { opKey: op("rp"), unitId: r.unit.id, stationId: w.station.id, reason: "Première impression" }, w.ctx);
    expect(re.print.status).toBe("QUEUED");
    expect(re.labelCode).toBe(r.unit.labelCode);
  });

  it("each station only receives its own jobs, and one job is claimed by one agent only (roadmap §9)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const a = await receiveOne(w, batch.id, item.id, w.ctx);
    const b = await receiveOne(w, batch.id, item.id, w.ctx2);
    // Station 1 has exactly one job; two agents racing for it.
    const [c1, c2] = await Promise.all([printing.claimNextPrintJob(w.db, { stationId: w.station.id }), printing.claimNextPrintJob(w.db, { stationId: w.station.id })]);
    const claimed = [c1, c2].filter(Boolean);
    expect(claimed.length).toBe(1);
    expect(claimed[0]!.objectId).toBe(a.unit.id);
    expect(claimed[0]!.printer.systemName).toBe("ZD421-test");
    const other = await printing.claimNextPrintJob(w.db, { stationId: w.station2.id });
    expect(other!.objectId).toBe(b.unit.id);
    expect(await printing.claimNextPrintJob(w.db, { stationId: w.station2.id })).toBeNull();

    const sent = await printing.reportPrintJob(w.db, { jobId: claimed[0]!.id, claimToken: claimed[0]!.claimToken, outcome: "SENT" }, w.ctx);
    expect(sent.status).toBe("SENT");
    expect((await units.getUnitSummary(w.db, a.unit.id)).labelPrintCount).toBe(1);
    // A stale token cannot report.
    await expectCode(printing.reportPrintJob(w.db, { jobId: other!.id, claimToken: "wrong", outcome: "SENT" }, w.ctx), "PRINT_STATE_CONFLICT");
    // Scanning the stuck label proves it: verified + job confirmed.
    const verified = await printing.confirmUnitLabelScan(w.db, { opKey: op("lv"), unitId: a.unit.id }, w.ctx);
    expect(verified.alreadyVerified).toBe(false);
    expect((await printing.getPrintJob(w.db, claimed[0]!.id)).status).toBe("CONFIRMED");
  });

  it("a failed print is retried on the same job; a reprint is a new job with a reason and the SAME code — never a new pair (roadmap §9)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    const job = (await printing.claimNextPrintJob(w.db, { stationId: w.station.id }))!;
    const failed = await printing.reportPrintJob(w.db, { jobId: job.id, claimToken: job.claimToken, outcome: "FAILED", error: "Imprimante introuvable" }, w.ctx);
    expect(failed.status).toBe("FAILED");
    expect((await printing.getPrinter(w.db, w.printer.id)).lastError).toBe("Imprimante introuvable");
    expect((await units.getUnitSummary(w.db, r.unit.id)).labelPrintCount).toBe(0);
    const retried = await printing.actOnPrintJob(w.db, { jobId: job.id, action: "RETRY" });
    expect(retried.status).toBe("QUEUED");
    const again = (await printing.claimNextPrintJob(w.db, { stationId: w.station.id }))!;
    expect(again.id).toBe(job.id);
    expect(again.attempts).toBe(2);
    await printing.reportPrintJob(w.db, { jobId: again.id, claimToken: again.claimToken, outcome: "SENT" }, w.ctx);

    await expectCode(printing.reprintUnitLabel(w.db, { opKey: op("rp"), unitId: r.unit.id, stationId: w.station.id, reason: "" }, w.ctx), "INVALID_INPUT");
    const key = op("rp");
    const re = await printing.reprintUnitLabel(w.db, { opKey: key, unitId: r.unit.id, stationId: w.station.id, reason: "Étiquette déchirée" }, w.ctx);
    const reAgain = await printing.reprintUnitLabel(w.db, { opKey: key, unitId: r.unit.id, stationId: w.station.id, reason: "Étiquette déchirée" }, w.ctx);
    expect(re.labelCode).toBe(r.unit.labelCode);
    expect(reAgain.replayed).toBe(true);
    expect(await count(w.db, `"WarehouseUnit" WHERE "originBatchId" = $1`, batch.id)).toBe(1);
    expect(await count(w.db, `"WarehouseLabelCode" WHERE "unitId" = $1`, r.unit.id)).toBe(1);
    const jobs = await printing.listPrintJobs(w.db, { objectId: r.unit.id });
    expect(jobs.length).toBe(2);
    expect(jobs.filter((j) => j.isReprint).length).toBe(1);
    expect(jobs.every((j) => j.labelCode === r.unit.labelCode)).toBe(true);
  });

  it("a claimed job with no answer becomes UNCERTAIN: never resent or rerouted automatically (C11)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    await receiveOne(w, batch.id, item.id);
    const job = (await printing.claimNextPrintJob(w.db, { stationId: w.station.id }))!;
    await w.db.$executeRawUnsafe(`UPDATE "WarehousePrintJob" SET "timeoutAt" = now() - interval '1 second' WHERE "id" = $1`, job.id);
    const swept = await printing.sweepPrintTimeouts(w.db);
    expect(swept.uncertain).toBeGreaterThanOrEqual(1);
    expect((await printing.getPrintJob(w.db, job.id)).status).toBe("UNCERTAIN");
    expect(await printing.claimNextPrintJob(w.db, { stationId: w.station.id })).toBeNull();
    await expectCode(printing.actOnPrintJob(w.db, { jobId: job.id, action: "RETRY" }), "PRINT_STATE_CONFLICT");
    await expectCode(printing.actOnPrintJob(w.db, { jobId: job.id, action: "REROUTE", printerId: w.printer.id }), "PRINT_STATE_CONFLICT");
    const open = await exceptions.listExceptions(w.db, { siteId: w.site.id, status: "OPEN" });
    expect(open.openByType.PRINT_UNCERTAIN).toBe(1);
    // A late "sent" from the agent is real information.
    const late = await printing.reportPrintJob(w.db, { jobId: job.id, claimToken: job.claimToken, outcome: "SENT" }, w.ctx);
    expect(late.status).toBe("SENT");
  });

  it("station credentials: paired station authenticates, a revoked or disabled one does not; printers stay on their site (C14)", async () => {
    const w = await makeWorld();
    const other = await makeWorld();
    const { credential } = await printing.pairStation(w.db, w.station.id);
    expect((await printing.authenticateStation(w.db, credential))?.id).toBe(w.station.id);
    expect(await printing.authenticateStation(w.db, `${w.station.id}.wrong`)).toBeNull();
    expect(await printing.authenticateStation(w.db, "garbage")).toBeNull();
    const stored = await w.db.$queryRawUnsafe<any[]>(`SELECT * FROM "WarehouseStation" WHERE "id" = $1`, w.station.id);
    expect(JSON.stringify(stored[0])).not.toContain(credential.split(".")[1]);
    await printing.updateStation(w.db, w.station.id, { status: "DISABLED" });
    expect(await printing.authenticateStation(w.db, credential)).toBeNull();
    await expectCode(printing.setStationRoute(w.db, { stationId: w.station2.id, labelKind: "PAIR", printerId: other.printer.id }), "SITE_MISMATCH");
  });

  it("a PDF-only printer is never claimed by an agent; the operator marks the manual print", async () => {
    const w = await makeWorld({ routePrinter: false });
    const pdf = await printing.createPrinter(w.db, { siteId: w.site.id, name: "PDF", adapter: "PDF_MANUAL", mediaWidthMm: 50, mediaHeightMm: 30, supportedKinds: ["PAIR"] });
    await printing.setStationRoute(w.db, { stationId: w.station.id, labelKind: "PAIR", printerId: pdf.id });
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    expect(r.print.status).toBe("QUEUED");
    expect(await printing.claimNextPrintJob(w.db, { stationId: w.station.id })).toBeNull();
    const job = (await printing.listPrintJobs(w.db, { objectId: r.unit.id }))[0];
    // Waiting for a hand print is not "the print station is closed": no stuck-queue alert, however old.
    await w.db.$executeRaw`UPDATE "WarehousePrintJob" SET "createdAt" = now() - interval '1 hour' WHERE "id" = ${job.id}`;
    const waiting = await getOverview(w.db, w.site.id);
    expect(waiting.printing.queued).toBe(1);
    expect(waiting.alerts.map((a) => a.code)).not.toContain("PRINT_QUEUE_STUCK");
    const sent = await printing.actOnPrintJob(w.db, { jobId: job.id, action: "MANUAL_SENT" }, w.ctx);
    expect(sent.status).toBe("SENT");
    expect((await units.getUnitSummary(w.db, r.unit.id)).labelPrintCount).toBe(1);
  });
});

d("partner isolation (roadmap §9: lists, detail, counters, exports, direct links)", () => {
  it("a partner only ever sees its own pairs, with no warehouse-internal field", async () => {
    const w = await makeWorld();
    const other = await makePartner(w.db, "Concurrent");
    await pricing.saveAgreement(w.db, { partnerId: other.id, saleAllowed: true, currency: "CHF" }, admin);
    const item = await makeItem(w.db, { name: "Modèle partagé" });
    const mine = await makeReceivingBatch(w);
    const theirs = await makeReceivingBatch(w, { ownerPartnerId: other.id });
    const own = await batches.createBatch(w.db, { siteId: w.site.id, kind: "RECEIVING", flow: "OWN_STOCK", ownerKind: "OWN", receivingLocationId: w.cart.id }, w.ctx);
    const myUnits = [await receiveOne(w, mine.id, item.id), await receiveOne(w, mine.id, item.id)];
    const theirUnit = await receiveOne(w, theirs.id, item.id);
    const ownUnit = await receiveOne(w, own.id, item.id);
    await pricing.setUnitPrice(w.db, { opKey: op("pr"), unitId: myUnits[0].unit.id, publicPrice: "200" }, admin);
    // A foreign price long enough never to appear by chance inside a random UUID or GTIN.
    await pricing.setUnitPrice(w.db, { opKey: op("pr"), unitId: theirUnit.unit.id, publicPrice: "987654" }, admin);

    const summary = await partnerView.getPartnerStockSummary(w.db, w.partner.id);
    expect(summary.held).toBe(2);
    expect(summary.pricedUnits).toBe(1);
    expect(summary.publicValue).toEqual([{ currency: "CHF", amount: "200.00", units: 1 }]);
    expect(summary.published).toBeNull();
    expect(summary.publishedReason).toBeTruthy();

    const list = await partnerView.listPartnerUnits(w.db, w.partner.id, { limit: 100 });
    expect(list.items.map((u) => u.id).sort()).toEqual(myUnits.map((u) => u.unit.id).sort());
    // Search by the foreign pair's reference or by a shared model name does not leak it.
    for (const search of [theirUnit.unit.id, theirUnit.unit.labelCode, theirUnit.unit.shortRef, "Modèle partagé", item.gtin as string]) {
      const found = await partnerView.listPartnerUnits(w.db, w.partner.id, { search, limit: 100 });
      expect(found.items.every((u) => myUnits.some((m) => m.unit.id === u.id))).toBe(true);
    }
    const grouped = await partnerView.listPartnerStockByItem(w.db, w.partner.id, {});
    expect(grouped.items.reduce((s, g) => s + g.quantity, 0)).toBe(2);

    const serialized = JSON.stringify({ summary, list, grouped });
    for (const forbidden of [w.cart.code, "CART", "locationId", "currentLocation", "operator", "stationId", "margin", "fees", other.id, theirUnit.unit.id, ownUnit.unit.id, "987654"]) {
      expect(serialized).not.toContain(forbidden);
    }

    // Direct link to a foreign pair, to Resell's own pair and to an unknown id: the same answer.
    const e1 = await expectCode(partnerView.getPartnerUnit(w.db, w.partner.id, theirUnit.unit.id), "NOT_FOUND");
    const e2 = await expectCode(partnerView.getPartnerUnit(w.db, w.partner.id, ownUnit.unit.id), "NOT_FOUND");
    const e3 = await expectCode(partnerView.getPartnerUnit(w.db, w.partner.id, "00000000-0000-4000-8000-000000000000"), "NOT_FOUND");
    const e4 = await expectCode(partnerView.getPartnerUnit(w.db, w.partner.id, "' OR 1=1 --"), "NOT_FOUND");
    expect(new Set([e1.message, e2.message, e3.message, e4.message]).size).toBe(1);
    expect(new Set([e1.status, e2.status, e3.status, e4.status]).size).toBe(1);

    const detail = await partnerView.getPartnerUnit(w.db, w.partner.id, myUnits[0].unit.id);
    expect(detail.publicPrice).toBe("200.00");
    expect(detail.sellerNet).toBe("175.00");
    expect(JSON.stringify(detail)).not.toContain(w.cart.code);

    const csv = await partnerView.exportPartnerStockCsv(w.db, w.partner.id);
    expect(csv.rows).toBe(2);
    expect(csv.csv).not.toContain(theirUnit.unit.shortRef);
    expect(csv.csv).not.toContain("987654");

    // The other partner sees only its own, with its own price.
    const theirsList = await partnerView.listPartnerUnits(w.db, other.id, { limit: 100 });
    expect(theirsList.items.map((u) => u.id)).toEqual([theirUnit.unit.id]);

    // Requests are scoped too.
    await pricing.createPartnerRequest(w.db, { partnerId: w.partner.id, unitId: myUnits[0].unit.id, type: "PRICE_CHANGE", message: "Merci de passer à 210", requestedPublicPrice: "210" });
    expect((await pricing.listPartnerRequests(w.db, { partnerId: w.partner.id })).length).toBe(1);
    expect((await pricing.listPartnerRequests(w.db, { partnerId: other.id })).length).toBe(0);
  });

  it("a pair whose owner is unknown or was changed disappears from the former partner's view", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    await units.changeUnitOwner(w.db, { opKey: op("own"), unitId: r.unit.id, ownerKind: "UNKNOWN", reason: "Doute sur le dépôt" }, admin);
    expect((await partnerView.listPartnerUnits(w.db, w.partner.id, {})).items).toEqual([]);
    await expectCode(partnerView.getPartnerUnit(w.db, w.partner.id, r.unit.id), "NOT_FOUND");
  });
});

d("prices — public price and partner net, proposals and guards (roadmap §9)", () => {
  it("admin-only, validated price shown to the partner with both amounts; a new price supersedes the old one", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    await expectCode(pricing.setUnitPrice(w.db, { opKey: op("pr"), unitId: r.unit.id, publicPrice: "200" }, w.ctx), "FORBIDDEN");
    await expectCode(pricing.setUnitPrice(w.db, { opKey: op("pr"), unitId: r.unit.id, publicPrice: "-5" }, admin), "INVALID_INPUT");
    await expectCode(pricing.setUnitPrice(w.db, { opKey: op("pr"), unitId: r.unit.id, publicPrice: "100", sellerNet: "120" }, admin), "INVALID_INPUT");
    const first = await pricing.setUnitPrice(w.db, { opKey: op("pr"), unitId: r.unit.id, publicPrice: "200" }, admin);
    expect(first).toMatchObject({ publicPrice: 200, fees: 25, sellerNet: 175 });
    await pricing.setUnitPrice(w.db, { opKey: op("pr"), unitId: r.unit.id, publicPrice: "180,50" }, admin);
    expect(await count(w.db, `"WarehouseUnitPrice" WHERE "unitId" = $1 AND "status" = 'VALIDATED'`, r.unit.id)).toBe(1);
    expect(await count(w.db, `"WarehouseUnitPrice" WHERE "unitId" = $1 AND "status" = 'SUPERSEDED'`, r.unit.id)).toBe(1);
    const row = (await partnerView.listPartnerUnits(w.db, w.partner.id, {})).items[0];
    expect(row.publicPrice).toBe("180.50");
    expect(row.sellerNet).toBe("157.45");
    expect(row.currency).toBe("CHF");
  });

  it("a StockX-based proposal touches only the partner's pairs of that exact size, waits for validation, and an incomplete basis cannot be validated", async () => {
    const w = await makeWorld();
    const other = await makePartner(w.db);
    const size42 = await makeItem(w.db, { name: "Dunk", sizeLabel: "42" });
    const size43 = await makeItem(w.db, { name: "Dunk", sizeLabel: "43" });
    const batch = await makeReceivingBatch(w);
    const foreign = await makeReceivingBatch(w, { ownerPartnerId: other.id });
    const a = await receiveOne(w, batch.id, size42.id);
    const b = await receiveOne(w, batch.id, size42.id);
    const wrongSize = await receiveOne(w, batch.id, size43.id);
    const notMine = await receiveOne(w, foreign.id, size42.id);

    const base = { partnerId: w.partner.id, itemId: size42.id, basisAmount: "200", basisCurrency: "CHF", basisObservedAt: new Date().toISOString(), factor: "0.70" };
    const unreliable = await pricing.proposeStockxPrices(w.db, { ...base, opKey: op("px"), basisRef: "", basisIncludesFees: null }, admin);
    expect(unreliable.proposed).toBe(2);
    expect(unreliable.unitIds.sort()).toEqual([a.unit.id, b.unit.id].sort());
    expect(unreliable.reliable).toBe(false);
    expect(unreliable.breakdown).toMatchObject({ publicPrice: 140, sellerNet: 121, interpretedAs: "PUBLIC_PRICE" });
    expect(await count(w.db, `"WarehouseUnitPrice" WHERE "unitId" IN ($1, $2)`, wrongSize.unit.id, notMine.unit.id)).toBe(0);
    // Not visible to the partner while only proposed.
    expect((await partnerView.listPartnerUnits(w.db, w.partner.id, {})).items.every((u) => u.publicPrice === null)).toBe(true);
    const pending = await pricing.listPartnerPrices(w.db, { partnerId: w.partner.id, only: "PROPOSED" });
    expect(pending.items.length).toBe(2);
    await expectCode(pricing.decidePrice(w.db, { priceId: pending.items[0].proposalId!, decision: "VALIDATE" }, admin), "CONFLICT");

    const reliable = await pricing.proposeStockxPrices(w.db, { ...base, opKey: op("px"), basisRef: "stockx.com/fr-fr/dunk?size=42 relevé 28.11", basisIncludesFees: false }, admin);
    expect(reliable.reliable).toBe(true);
    const fresh = await pricing.listPartnerPrices(w.db, { partnerId: w.partner.id, only: "PROPOSED" });
    const target = fresh.items.find((p) => p.unitId === a.unit.id)!;
    await expectCode(pricing.decidePrice(w.db, { priceId: target.proposalId!, decision: "VALIDATE" }, w.ctx), "FORBIDDEN");
    const ok = await pricing.decidePrice(w.db, { priceId: target.proposalId!, decision: "VALIDATE" }, admin);
    expect(ok.status).toBe("VALIDATED");
    const mine = (await partnerView.listPartnerUnits(w.db, w.partner.id, {})).items;
    expect(mine.find((u) => u.id === a.unit.id)!.publicPrice).toBe("140.00");
    expect(mine.find((u) => u.id === b.unit.id)!.publicPrice).toBeNull();
    expect(mine.find((u) => u.id === wrongSize.unit.id)!.publicPrice).toBeNull();
  });

  it("correcting the variant or the owner withdraws the price: a price never follows a pair to another size or owner", async () => {
    const w = await makeWorld();
    const [s42, s43] = [await makeItem(w.db), await makeItem(w.db)];
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, s42.id);
    await pricing.setUnitPrice(w.db, { opKey: op("pr"), unitId: r.unit.id, publicPrice: "200" }, admin);
    await units.correctUnitItem(w.db, { opKey: op("it"), unitId: r.unit.id, itemId: s43.id, reason: "Mauvaise pointure saisie" }, w.ctx);
    expect(await count(w.db, `"WarehouseUnitPrice" WHERE "unitId" = $1 AND "status" = 'VALIDATED'`, r.unit.id)).toBe(0);
    expect((await partnerView.listPartnerUnits(w.db, w.partner.id, {})).items[0].publicPrice).toBeNull();
  });
});

d("allocation seam for the sales lot — internal only", () => {
  it("only a present, controlled, sale-authorised pair can be reserved, once", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    await expectCode(allocateUnit(w.db, { opKey: op("al"), unitId: r.unit.id, channel: "TEST", orderRef: "O-1" }, admin), "UNIT_STATE_CONFLICT");
    await units.setUnitQcState(w.db, { opKey: op("qc"), unitId: r.unit.id, qcState: "PASSED" }, w.ctx);
    await units.setUnitSaleState(w.db, { opKey: op("sale"), unitId: r.unit.id, saleState: "SALE_AUTHORIZED" }, admin);
    const a = await allocateUnit(w.db, { opKey: op("al"), unitId: r.unit.id, channel: "TEST", orderRef: "O-1" }, admin);
    await expectCode(allocateUnit(w.db, { opKey: op("al"), unitId: r.unit.id, channel: "TEST", orderRef: "O-2" }, admin), "ALREADY_ALLOCATED");
    const released = await releaseAllocation(w.db, { opKey: op("al"), allocationId: a.allocationId, reason: "Commande annulée" }, admin);
    expect(released.status).toBe("RELEASED");
  });
});

d("assisted imports (A07, A11, C28)", () => {
  it("previews with per-line errors, never guesses a mangled GTIN, resumes without duplicates", async () => {
    const w = await makeWorld();
    const batch = await makeReceivingBatch(w);
    const g1 = randomGtin();
    const csv = `gtin;description;pointure;quantité\n${g1};Dunk Low;42;2\n1.98481E+11;Sac;;1\n;;;3\n0${g1.slice(0, 11)}X;Bad;;1\n${randomGtin()};Samba;43;1\n`;
    const preview = await imports.previewImport(w.db, { kind: "BATCH_LINES", targetId: batch.id, filename: "lot.csv", csv });
    expect(preview.totalRows).toBe(5);
    expect(preview.errorRows).toBe(3);
    expect(preview.pendingRows).toBe(2);
    expect(preview.rows[1].error).toMatch(/tableur/);
    expect(preview.rows[0].raw.gtin).toBe(g1);
    expect(await count(w.db, `"WarehouseBatchLine" WHERE "batchId" = $1`, batch.id)).toBe(0);

    const same = await imports.previewImport(w.db, { kind: "BATCH_LINES", targetId: batch.id, filename: "lot-copie.csv", csv });
    expect(same.id).toBe(preview.id);
    expect(same.alreadyImported).toBe(true);

    const partial = await imports.applyImport(w.db, { importId: preview.id, maxRows: 1 });
    expect(partial.appliedRows).toBe(1);
    expect(partial.pendingRows).toBe(1);
    const done = await imports.applyImport(w.db, { importId: preview.id });
    expect(done.appliedRows).toBe(2);
    expect(done.pendingRows).toBe(0);
    expect(done.status).toBe("PARTIAL");
    const again = await imports.applyImport(w.db, { importId: preview.id });
    expect(again.appliedRows).toBe(2);
    expect(await count(w.db, `"WarehouseBatchLine" WHERE "batchId" = $1`, batch.id)).toBe(2);
    // An import never creates physical units.
    expect(await count(w.db, `"WarehouseUnit" WHERE "originBatchId" = $1`, batch.id)).toBe(0);
  });

  it("imports locations idempotently", async () => {
    const w = await makeWorld();
    const csv = "secteur,rangée,rack,niveau,capacité\nB,1,1,1,8\nB,1,1,2,8\nB,1,1,abc,8\n";
    const preview = await imports.previewImport(w.db, { kind: "LOCATIONS", targetId: w.site.id, filename: "racks.csv", csv });
    expect(preview.errorRows).toBe(1);
    const applied = await imports.applyImport(w.db, { importId: preview.id });
    expect(applied.appliedRows).toBe(2);
    const levels = await locations.listLocations(w.db, { siteId: w.site.id, kinds: ["LEVEL"], sector: "B" });
    expect(levels.items.map((l) => l.code)).toEqual([`${w.site.code}-B-R01-T01-N01`, `${w.site.code}-B-R01-T01-N02`]);
    expect(levels.items[0].capacity).toBe(8);
  });
});

d("QR permanence — rename, archive, journal (roadmap §9)", () => {
  it("a renamed level still resolves by its old printed code", async () => {
    const w = await makeWorld();
    const level = w.levels[0];
    const renamed = await locations.renameLocation(w.db, level.id, { newCode: `${w.site.code}-Z-R09-T09-N09`, newShortCode: "Z-09-09-9" });
    expect(renamed.code).toBe(`${w.site.code}-Z-R09-T09-N09`);
    const old = await locations.resolveLocationCode(w.db, level.code);
    expect(old?.id).toBe(level.id);
    expect(old?.viaAlias).toBe(true);
    const scan = await units.resolveScan(w.db, level.code.toLowerCase());
    expect(scan.kind).toBe("LOCATION");
    // The old code can never be given to another location.
    await expectCode(locations.renameLocation(w.db, w.levels[1].id, { newCode: level.code }), "CONFLICT");
  });

  it("an archived pair that left years ago still resolves from its label, with its history retrievable", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    await putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: r.unit.id, locationId: w.levels[0].id, acceptMismatch: true }, w.ctx);
    await units.markUnitOut(w.db, { opKey: op("out"), unitId: r.unit.id, outReason: "WITHDRAWN", reason: "Retrait par le partenaire" }, admin);
    expect((await locations.getLocation(w.db, w.levels[0].id)).occupiedCount).toBe(0);
    // Issued "10 years ago".
    await w.db.$executeRawUnsafe(`UPDATE "WarehouseUnit" SET "outAt" = now() - interval '10 years' WHERE "id" = $1`, r.unit.id);
    const before = await count(w.db, `"WarehouseMovement" WHERE "unitId" = $1`, r.unit.id);
    const archived = await archiveOutUnitHistory(w.db, { outBefore: new Date(Date.now() - 365 * 86_400_000), unitIds: [r.unit.id] });
    expect(archived.units).toBe(1);
    expect(archived.movements).toBe(before);
    expect(await count(w.db, `"WarehouseMovement" WHERE "unitId" = $1`, r.unit.id)).toBe(0);
    expect((await getArchivedMovements(w.db, r.unit.id)).length).toBe(before);

    const scan = await units.resolveScan(w.db, r.unit.labelCode);
    expect(scan.kind).toBe("UNIT");
    if (scan.kind === "UNIT") {
      expect(scan.unit.id).toBe(r.unit.id);
      expect(scan.unit.presence).toBe("OUT");
    }
    const detail = await units.getUnitDetail(w.db, r.unit.id);
    expect(detail.unit.historyArchivedAt).toBeTruthy();
    expect(detail.unit.historyArchiveRef).toBe(archived.archiveRef);
    // The archive routine is the only way out of the journal, and only for pairs that left.
    await expect(w.db.$executeRawUnsafe(`DELETE FROM "WarehouseMovementArchive" WHERE false`)).resolves.toBe(0);
    // A scan of an out pair never brings it back into stock.
    await expectCode(putaway.relocateUnit(w.db, { opKey: op("mv"), unitId: r.unit.id, toLocationId: w.cart.id }, w.ctx), "UNIT_NOT_PRESENT");
  });

  it("an unknown code with our format is reported as unknown — never used to create a pair; a mangled number is refused", async () => {
    const w = await makeWorld();
    const ghost = `0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d-${w.site.code}`;
    const scan = await units.resolveScan(w.db, ghost);
    expect(scan.kind).toBe("UNIT_CODE_UNKNOWN");
    expect((await units.resolveScan(w.db, "1.98481E+11")).kind).toBe("MANGLED_NUMBER");
    const unknownGtin = await units.resolveScan(w.db, randomGtin());
    expect(unknownGtin.kind).toBe("GTIN");
    if (unknownGtin.kind === "GTIN") expect(unknownGtin.resolution.status).toBe("UNKNOWN");
    expect(await count(w.db, `"WarehouseUnit" WHERE "id" = $1`, ghost.slice(0, 36))).toBe(0);
  });

  it("an old external label is a search alias: unique → found, ambiguous → explicit choice (C32)", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const a = await receiveOne(w, batch.id, item.id);
    const b = await receiveOne(w, batch.id, item.id);
    const legacy = `LEG-${a.unit.shortRef}`;
    await units.addUnitExternalRef(w.db, { unitId: a.unit.id, namespace: "LEGACY_LABEL", value: legacy });
    const one = await units.resolveScan(w.db, legacy);
    expect(one.kind).toBe("UNIT");
    if (one.kind === "UNIT") expect(one.via).toBe("EXTERNAL_REF");
    await units.addUnitExternalRef(w.db, { unitId: b.unit.id, namespace: "PARTNER_REF", value: legacy });
    const two = await units.resolveScan(w.db, legacy);
    expect(two.kind).toBe("EXTERNAL_REF_AMBIGUOUS");
  });
});

d("stop switch (roadmap §9: hide the module and stop its writes)", () => {
  it("writes disabled: every gesture is refused, reads keep working, nothing is written", async () => {
    const w = await makeWorld();
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    // Scoped to this world: other test files write to the same database in parallel.
    const mine = `"WarehouseMovement" WHERE "batchId" = $1 OR "unitId" = $2`;
    const before = await count(w.db, mine, batch.id, r.unit.id);
    const unitsBefore = await count(w.db, `"WarehouseUnit" WHERE "originBatchId" = $1`, batch.id);
    process.env.WAREHOUSE_WRITES_ENABLED = "false";
    try {
      await expectCode(receiveOne(w, batch.id, item.id), "WRITES_DISABLED");
      await expectCode(putaway.confirmPutaway(w.db, { opKey: op("put"), unitId: r.unit.id, locationId: w.levels[0].id, acceptMismatch: true }, w.ctx), "WRITES_DISABLED");
      await expectCode(printing.claimNextPrintJob(w.db, { stationId: w.station.id }), "WRITES_DISABLED");
      await expectCode(pricing.setUnitPrice(w.db, { opKey: op("pr"), unitId: r.unit.id, publicPrice: "10" }, admin), "WRITES_DISABLED");
      await expectCode(locations.createSite(w.db, { code: "QQ00", name: "x", countryCode: "CH" }), "WRITES_DISABLED");
      expect((await units.getUnitSummary(w.db, r.unit.id)).id).toBe(r.unit.id);
      expect((await partnerView.listPartnerUnits(w.db, w.partner.id, {})).items.length).toBe(1);
      expect((await units.resolveScan(w.db, r.unit.labelCode)).kind).toBe("UNIT");
    } finally {
      process.env.WAREHOUSE_WRITES_ENABLED = "true";
    }
    expect(await count(w.db, mine, batch.id, r.unit.id)).toBe(before);
    expect(await count(w.db, `"WarehouseUnit" WHERE "originBatchId" = $1`, batch.id)).toBe(unitsBefore);
  });
});
