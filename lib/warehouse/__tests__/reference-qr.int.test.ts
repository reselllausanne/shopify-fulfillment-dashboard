import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { archiveOutUnitHistory } from "../archive";
import { classifyScan } from "../codes";
import { withTx } from "../db";
import * as locations from "../locations";
import * as transfers from "../transfers";
import * as units from "../units";
import { HAS_DB, admin, closeTestDb, makeItem, makePartner, op, testDb } from "./harness";

/**
 * Reference QR texts (roadmap §9): the exact strings printed on labels are kept in the repo.
 * The test database is NOT reset between runs, so these identities live through every later
 * schema change exactly like a pair glued in the warehouse: the first run issues them, every
 * following run — after any migration — must find the same UUID from the same text.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "fixtures/reference-qr.json"), "utf8")) as {
  units: { format: string; text: string; unitId: string; issuingSiteCode: string; issuedAt: string; scenario: string }[];
  scannerVariants: { of: string; text: string }[];
  locations: { text: string; scenario: string }[];
  neverOurs: { text: string }[];
};

describe("reference QR texts — parsing (no database)", () => {
  it("every printed pair text designates exactly its UUID and issuing site", () => {
    for (const f of fixtures.units) {
      const scan = classifyScan(f.text);
      expect(scan).toEqual({ kind: "UNIT_LABEL", code: f.text, unitId: f.unitId, issuingSiteCode: f.issuingSiteCode });
    }
  });
  it("scanner transport noise does not change the identity", () => {
    for (const v of fixtures.scannerVariants) {
      const scan = classifyScan(v.text);
      expect(scan.kind).toBe("UNIT_LABEL");
      if (scan.kind === "UNIT_LABEL") expect(scan.code).toBe(v.of);
    }
  });
  it("location texts are locations; look-alikes are never one of our pairs", () => {
    for (const l of fixtures.locations) expect(classifyScan(l.text)).toMatchObject({ kind: "LOCATION", code: l.text });
    for (const n of fixtures.neverOurs) expect(classifyScan(n.text).kind).not.toBe("UNIT_LABEL");
  });
});

const d = describe.skipIf(!HAS_DB);
afterAll(closeTestDb);

d("reference QR texts — resolution on a database that outlives the test run", () => {
  const db = testDb();

  async function ensureWorld() {
    const sites = await locations.listSites(db, { includeRetired: true });
    const home = sites.find((s) => s.code === "ZQ16") ?? (await locations.createSite(db, { code: "ZQ16", name: "QR de référence", countryCode: "CH", isTest: true }));
    const away = sites.find((s) => s.code === "ZQ17") ?? (await locations.createSite(db, { code: "ZQ17", name: "QR de référence — second site", countryCode: "DE", isTest: true }));
    await locations.generateRacks(db, { siteId: home.id, sector: "A", rowFrom: 1, rowTo: 1, racksPerRow: 3, levelsPerRack: 2, capacityPerLevel: 500 });
    const ensureSpecial = async (siteId: string, code: string, kind: "RECEIVING") =>
      (await locations.resolveLocationCode(db, code)) ?? (await locations.createSpecialLocation(db, { siteId, kind }));
    const rec = await ensureSpecial(home.id, "ZQ16-REC-01", "RECEIVING");
    const recAway = await ensureSpecial(away.id, "ZQ17-REC-01", "RECEIVING");
    return { home, away, rec, recAway };
  }

  it("issues the reference pairs once, then always finds the same UUID from the printed text", async () => {
    const { home, away, rec, recAway } = await ensureWorld();
    const level = await locations.resolveLocationCode(db, "ZQ16-A-R01-T03-N02");
    expect(level?.kind).toBe("LEVEL");

    for (const f of fixtures.units) {
      const existing = await db.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "WarehouseUnit" WHERE "id" = ${f.unitId}`);
      if (existing.length === 0) {
        // First run on this database: issue the pair with the exact printed identity.
        const item = await makeItem(db);
        const partner = await makePartner(db, "QR de référence");
        await withTx(db, (tx) =>
          units.createUnitTx(
            tx,
            {
              siteId: home.id,
              siteCode: home.code,
              itemId: item.id,
              ownerKind: "PARTNER",
              ownerPartnerId: partner.id,
              originType: "CONSIGNMENT",
              locationId: rec.id,
              movementType: "RECEIVE",
              observedAt: new Date(f.issuedAt),
              generateId: () => f.unitId,
            },
            admin,
            null
          )
        );
        await db.$executeRaw(Prisma.sql`UPDATE "WarehouseUnit" SET "receivedAt" = ${new Date(f.issuedAt)}, "createdAt" = ${new Date(f.issuedAt)} WHERE "id" = ${f.unitId}`);
        await db.$executeRaw(Prisma.sql`UPDATE "WarehouseLabelCode" SET "issuedAt" = ${new Date(f.issuedAt)} WHERE "code" = ${f.text}`).catch(() => undefined);
        if (f.scenario === "ARCHIVED_OUT") {
          await units.markUnitOut(db, { opKey: op("ref-out"), unitId: f.unitId, outReason: "SOLD", reason: "Vente (QR de référence)" }, admin);
          await db.$executeRaw(Prisma.sql`UPDATE "WarehouseUnit" SET "outAt" = ${new Date("2017-02-01T10:00:00.000Z")} WHERE "id" = ${f.unitId}`);
          await archiveOutUnitHistory(db, { outBefore: new Date("2020-01-01T00:00:00.000Z"), unitIds: [f.unitId] });
        }
        if (f.scenario === "TRANSFERRED") {
          const t = await transfers.createTransfer(db, { fromSiteId: home.id, toSiteId: away.id });
          await transfers.shipTransferUnit(db, { opKey: op("ref-ship"), transferId: t.id, unitId: f.unitId }, admin);
          await transfers.receiveTransferUnit(db, { opKey: op("ref-rcv"), unitId: f.unitId, toLocationId: recAway.id }, admin);
        }
      }

      const before = await db.$queryRaw<any[]>(Prisma.sql`
        SELECT "id", "labelCode", "issuingSiteCode", "ownerKind", "ownerPartnerId", "presence", "saleState", "currentSiteId", "version", "historyArchivedAt"
        FROM "WarehouseUnit" WHERE "id" = ${f.unitId}`);
      const scan = await units.resolveScan(db, f.text);
      expect(scan.kind).toBe("UNIT");
      if (scan.kind !== "UNIT") continue;
      expect(scan.unit.id).toBe(f.unitId);
      expect(scan.unit.labelCode).toBe(f.text);
      expect(scan.via).toBe("LABEL");
      // A scan is a read: no restock, no owner change, no new version, same label.
      const after = await db.$queryRaw<any[]>(Prisma.sql`
        SELECT "id", "labelCode", "issuingSiteCode", "ownerKind", "ownerPartnerId", "presence", "saleState", "currentSiteId", "version", "historyArchivedAt"
        FROM "WarehouseUnit" WHERE "id" = ${f.unitId}`);
      expect(after).toEqual(before);
      expect(after[0].issuingSiteCode).toBe("ZQ16");
      if (f.scenario === "ARCHIVED_OUT") {
        expect(after[0].presence).toBe("OUT");
        expect(after[0].historyArchivedAt).toBeTruthy();
        expect(new Date(scan.unit.receivedAt).getUTCFullYear()).toBe(2016);
      }
      if (f.scenario === "TRANSFERRED") {
        expect(after[0].currentSiteId).toBe(away.id);
        expect(scan.unit.labelCode.endsWith("-ZQ16")).toBe(true);
      }
    }

    for (const v of fixtures.scannerVariants) {
      const scan = await units.resolveScan(db, v.text);
      expect(scan.kind).toBe("UNIT");
      if (scan.kind === "UNIT") expect(scan.unit.labelCode).toBe(v.of);
    }
    for (const l of fixtures.locations) {
      const scan = await units.resolveScan(db, l.text);
      expect(scan.kind).toBe("LOCATION");
      if (scan.kind === "LOCATION") expect(scan.location.code).toBe(l.text);
    }
    for (const n of fixtures.neverOurs) {
      const scan = await units.resolveScan(db, n.text);
      expect(scan.kind).not.toBe("UNIT");
    }
    // The database itself refuses to detach a printed code from its pair.
    await expect(db.$executeRaw(Prisma.sql`UPDATE "WarehouseLabelCode" SET "unitId" = ${fixtures.units[1].unitId} WHERE "code" = ${fixtures.units[0].text}`)).rejects.toThrow();
    await expect(db.$executeRaw(Prisma.sql`DELETE FROM "WarehouseLabelCode" WHERE "code" = ${fixtures.units[0].text}`)).rejects.toThrow();
    await expect(db.$executeRaw(Prisma.sql`UPDATE "WarehouseUnit" SET "labelCode" = 'x' WHERE "id" = ${fixtures.units[0].unitId}`)).rejects.toThrow();
  });
});
