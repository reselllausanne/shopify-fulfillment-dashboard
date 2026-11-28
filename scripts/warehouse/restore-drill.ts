/**
 * Restore drill (roadmap §1.1, §9, C01 / C02 / C03 / C27) — LOCAL TEST CLUSTER ONLY.
 *
 *   WAREHOUSE_PG_DATA=… WAREHOUSE_PG_PORT=54330 WAREHOUSE_PG_DB=warehouse_scale \
 *   WAREHOUSE_TEST_DATABASE_URL=postgresql://warehouse:warehouse@127.0.0.1:54330/warehouse_scale?schema=public \
 *     npx tsx scripts/warehouse/restore-drill.ts [--out file.json]
 *
 * Scenario played end to end:
 *   T0   reference QR texts are recorded (active, transferred, archived pair), the issuance
 *        journal is flushed to a sink OUTSIDE the database directory, a physical backup is taken;
 *   T1   work goes on: new pairs are received (labels glued), some put away, old pairs moved;
 *        the journal keeps being appended to the sink;
 *   T2   the primary disk is lost → the database is restored from the T0 backup;
 *   T3   on the restored database: reference QRs resolve to the same UUID with unchanged state;
 *        QRs glued after T0 are unknown — and are NOT turned into new pairs by a scan;
 *        the journal is reconciled: same UUIDs come back as "to be checked" (missing, owner
 *        unknown, sale blocked) with one reconciliation discrepancy each; a second reconcile
 *        changes nothing; movements made after T0 are reported as lost (that is the RPO of the
 *        ordinary backup, distinct from the permanence of identities).
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const url = process.env.WAREHOUSE_TEST_DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refus : WAREHOUSE_TEST_DATABASE_URL doit pointer sur une base locale (127.0.0.1).");
  process.exit(1);
}
process.env.WAREHOUSE_MODULE_ENABLED = "true";
process.env.WAREHOUSE_WRITES_ENABLED = "true";

const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "";
const NEW_PAIRS = 25;
const MOVED_OLD = 10;
const CLONE_PORT = Number(process.env.WAREHOUSE_DRILL_PORT ?? 54339);
const root = path.resolve(__dirname, "../..");
const devDb = path.join(root, "scripts/warehouse/dev-db.sh");
const pgHome = process.env.WAREHOUSE_PG_HOME ?? path.join(process.env.HOME ?? "", ".cache/resell-warehouse-pg");
const cloneDir = path.join(pgHome, `drill-${Date.now()}`);

function dirSizeMb(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else total += st.size;
    }
  };
  walk(dir);
  return Math.round(total / 1048576);
}

async function main() {
  const units = await import("../../lib/warehouse/units");
  const batches = await import("../../lib/warehouse/batches");
  const putaway = await import("../../lib/warehouse/putaway");
  const journal = await import("../../lib/warehouse/journal");
  const transfers = await import("../../lib/warehouse/transfers");
  const exceptions = await import("../../lib/warehouse/exceptions");
  const admin = { role: "admin" as const, operatorId: null, stationId: null };
  const op = () => `drill-${randomUUID()}`;

  const primary = new PrismaClient({ datasources: { db: { url } } });
  const report: Record<string, any> = { at: new Date().toISOString() };
  const sink = mkdtempSync(path.join(tmpdir(), "warehouse-journal-sink-"));
  report.sink = { dir: sink, note: "Stand-in for the off-primary journal target (another disk / object storage in production)." };

  const sites = await primary.$queryRawUnsafe<{ id: string; code: string }[]>(
    `SELECT s."id", s."code" FROM "WarehouseSite" s ORDER BY (SELECT count(*) FROM "WarehouseUnit" u WHERE u."currentSiteId" = s."id") DESC`
  );
  if (sites.length < 2) throw new Error("The drill needs at least two sites (run scale-seed.ts first).");
  const [site, other] = sites;
  const rec = (await primary.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "WarehouseLocation" WHERE "siteId" = $1 AND "kind" = 'RECEIVING' ORDER BY "code" LIMIT 1`, site.id))[0];
  const recOther = (await primary.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "WarehouseLocation" WHERE "siteId" = $1 AND "kind" = 'RECEIVING' ORDER BY "code" LIMIT 1`, other.id))[0];
  const partner = (await primary.$queryRawUnsafe<{ id: string }[]>(`SELECT "ownerPartnerId" AS id FROM "WarehouseUnit" WHERE "ownerPartnerId" IS NOT NULL LIMIT 1`))[0];

  // ── T0: reference QRs ──────────────────────────────────────────────────────
  const active = (await primary.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "WarehouseUnit" WHERE "presence" = 'PRESENT' AND "currentSiteId" = $1 ORDER BY "receivedAt" LIMIT 1`, site.id))[0];
  const toTransfer = (
    await primary.$queryRawUnsafe<{ id: string }[]>(
      `SELECT u."id" FROM "WarehouseUnit" u JOIN "WarehouseLocation" l ON l."id" = u."currentLocationId"
       WHERE u."presence" = 'PRESENT' AND u."currentSiteId" = $1 AND l."kind" = 'LEVEL' AND u."id" <> $2
         AND NOT EXISTS (SELECT 1 FROM "WarehousePutawayTask" t WHERE t."unitId" = u."id" AND t."status" IN ('PENDING','RESERVED'))
       ORDER BY u."receivedAt" DESC LIMIT 1`,
      site.id,
      active.id
    )
  )[0];
  const transfer = await transfers.createTransfer(primary, { fromSiteId: site.id, toSiteId: other.id, note: "Exercice de restauration" });
  await transfers.shipTransferUnit(primary, { opKey: op(), transferId: transfer.id, unitId: toTransfer.id }, admin);
  await transfers.receiveTransferUnit(primary, { opKey: op(), unitId: toTransfer.id, toLocationId: recOther.id }, admin);
  const archived = (await primary.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "WarehouseUnit" WHERE "historyArchivedAt" IS NOT NULL ORDER BY "receivedAt" LIMIT 1`))[0];
  const gone = (await primary.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "WarehouseUnit" WHERE "presence" = 'OUT' AND "historyArchivedAt" IS NULL ORDER BY "receivedAt" LIMIT 1`))[0];
  const refIds = [active, toTransfer, archived, gone].filter(Boolean).map((r) => r.id);
  const STATE_SQL = `SELECT "id", "labelCode", "issuingSiteCode", "itemId", "ownerKind", "ownerPartnerId", "presence", "currentSiteId", "currentLocationId",
                            "qcState", "saleState", "outReason", "version", "receivedAt", "historyArchivedAt"
                     FROM "WarehouseUnit" WHERE "id" = ANY($1::text[]) ORDER BY "id"`;
  const referenceState = await primary.$queryRawUnsafe<any[]>(STATE_SQL, refIds);
  report.references = referenceState.map((r) => ({
    text: r.labelCode,
    unitId: r.id,
    presence: r.presence,
    issuedYear: new Date(r.receivedAt).getUTCFullYear(),
    archived: Boolean(r.historyArchivedAt),
    transferred: r.id === toTransfer.id,
  }));

  // Journal flushed before the backup.
  const flushAll = async (db: PrismaClient) => {
    let exported = 0;
    for (;;) {
      const r = await journal.exportLabelJournal(db, { dir: sink, limit: 5000 });
      exported += r.exported;
      if (r.pending === 0 || r.exported === 0) return { exported, pending: r.pending };
    }
  };
  const flush0 = await flushAll(primary);
  const countsT0 = {
    units: Number((await primary.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "WarehouseUnit"`))[0].n),
    codes: Number((await primary.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "WarehouseLabelCode"`))[0].n),
    movements: Number((await primary.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "WarehouseMovement"`))[0].n),
  };
  await primary.$disconnect();

  // ── Backup at T0 (physical copy; the copy doubles as the restored server) ──
  const tBackup = performance.now();
  execFileSync(devDb, ["clone", String(CLONE_PORT), cloneDir], { stdio: "pipe", env: process.env });
  const backupSeconds = (performance.now() - tBackup) / 1000;
  report.backup = { atT0: countsT0, journalFlushedBeforeBackup: flush0.exported, copyAndStartSeconds: Number(backupSeconds.toFixed(1)), sizeMb: dirSizeMb(cloneDir) };
  const cloneUrl = url.replace(/:(\d+)\//, `:${CLONE_PORT}/`);

  // ── T1: work continues on the primary after the backup ─────────────────────
  const live = new PrismaClient({ datasources: { db: { url } } });
  const batch = await batches.createBatch(
    live,
    { siteId: site.id, kind: "RECEIVING", flow: "CONSIGNMENT", ownerKind: "PARTNER", ownerPartnerId: partner.id, receivingLocationId: rec.id, title: "Après la sauvegarde" } as any,
    admin
  );
  const itemId = referenceState[0].itemId as string;
  const glued: { id: string; code: string }[] = [];
  for (let i = 0; i < NEW_PAIRS; i += 1) {
    const r = await batches.receiveUnit(live, { opKey: op(), batchId: batch.id, itemId, condition: "NEW" } as any, admin);
    glued.push({ id: r.unit.id, code: r.unit.labelCode });
  }
  await putaway.proposeDestinations(live, { siteId: site.id, batchId: batch.id }, admin);
  const queue = await putaway.listPutawayQueue(live, { siteId: site.id, batchId: batch.id, limit: 100 });
  let putAway = 0;
  for (const t of queue.tasks.filter((x) => x.proposedLocationId).slice(0, 10)) {
    await putaway.confirmPutaway(live, { opKey: op(), unitId: t.unit.id, locationId: t.proposedLocationId as string }, admin);
    putAway += 1;
  }
  const oldPairs = await live.$queryRawUnsafe<{ id: string; currentLocationId: string }[]>(
    `SELECT u."id", u."currentLocationId" FROM "WarehouseUnit" u JOIN "WarehouseLocation" l ON l."id" = u."currentLocationId"
     WHERE u."presence" = 'PRESENT' AND u."currentSiteId" = $1 AND l."kind" = 'LEVEL' AND u."originBatchId" IS NULL AND u."id" <> ALL($2::text[])
     ORDER BY u."receivedAt" LIMIT $3`,
    site.id,
    refIds,
    MOVED_OLD
  );
  const freeLevels = await live.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "WarehouseLocation" WHERE "siteId" = $1 AND "kind" = 'LEVEL' AND "status" = 'ACTIVE' AND "occupiedCount" + "reservedCount" < "capacity" - 1 ORDER BY "walkSequence" DESC LIMIT $2`,
    site.id,
    MOVED_OLD
  );
  for (let i = 0; i < oldPairs.length; i += 1) {
    await putaway.relocateUnit(live, { opKey: op(), unitId: oldPairs[i].id, toLocationId: freeLevels[i].id, reason: "Réorganisation après sauvegarde" }, admin);
  }
  const flush1 = await flushAll(live);
  report.afterBackup = { pairsReceivedAndLabelled: glued.length, putAway, oldPairsMoved: oldPairs.length, journalLinesAppended: flush1.exported, journalPendingOnPrimary: flush1.pending };
  await live.$disconnect();

  // ── T2 / T3: the primary is lost; we work on the restored database ─────────
  const restored = new PrismaClient({ datasources: { db: { url: cloneUrl } } });
  try {
    const n = async (sql: string, ...p: unknown[]) => Number((await restored.$queryRawUnsafe<{ n: bigint }[]>(sql, ...p))[0].n);
    const unitsAtRestore = await n(`SELECT count(*) AS n FROM "WarehouseUnit"`);

    // Reference QRs: same UUID, same state, a scan changes nothing.
    const refChecks: any[] = [];
    for (const ref of referenceState) {
      const scan = await units.resolveScan(restored, ref.labelCode);
      refChecks.push({ text: ref.labelCode, sameUuid: scan.kind === "UNIT" && scan.unit.id === ref.id });
    }
    const stateAfter = await restored.$queryRawUnsafe<any[]>(STATE_SQL, refIds);
    report.referenceQrAfterRestore = {
      checked: refChecks.length,
      allResolveToSameUuid: refChecks.every((c) => c.sameUuid),
      stateIdenticalToT0: JSON.stringify(stateAfter) === JSON.stringify(referenceState),
      details: refChecks,
    };

    // QRs glued after the backup: unknown, and a scan must not create anything.
    let unknown = 0;
    for (const g of glued) {
      const scan = await units.resolveScan(restored, g.code);
      if (scan.kind === "UNIT_CODE_UNKNOWN") unknown += 1;
    }
    const unitsAfterScans = await n(`SELECT count(*) AS n FROM "WarehouseUnit"`);
    report.gluedAfterBackup = { scanned: glued.length, reportedUnknown: unknown, pairsCreatedByScanning: unitsAfterScans - unitsAtRestore };

    // Journal reconciliation.
    const entries = await journal.readJournalDir(sink);
    const dry = await journal.reconcileJournal(restored, entries, { dryRun: true });
    const unitsAfterDry = await n(`SELECT count(*) AS n FROM "WarehouseUnit"`);
    const t0 = performance.now();
    const real = await journal.reconcileJournal(restored, entries, {});
    const reconcileSeconds = (performance.now() - t0) / 1000;
    const again = await journal.reconcileJournal(restored, entries, {});
    let sameUuid = 0;
    let safeState = 0;
    for (const g of glued) {
      const scan = await units.resolveScan(restored, g.code);
      if (scan.kind === "UNIT" && scan.unit.id === g.id) {
        sameUuid += 1;
        if (scan.unit.presence === "MISSING" && scan.unit.ownerKind === "UNKNOWN" && scan.unit.saleState === "BLOCKED") safeState += 1;
      }
    }
    const openRecon = await exceptions.listExceptions(restored, { status: "OPEN", type: "RECOVERY_RECONCILE", limit: 500 } as any).catch(() => null);
    report.journalReconcile = {
      journalEntriesRead: entries.length,
      dryRun: { wouldRestore: dry.restored, alreadyKnown: dry.alreadyKnown, conflicts: dry.conflicts.length, wroteNothing: unitsAfterDry === unitsAfterScans },
      applied: { restored: real.restored, alreadyKnown: real.alreadyKnown, conflicts: real.conflicts.length, seconds: Number(reconcileSeconds.toFixed(2)) },
      secondRun: { restored: again.restored, alreadyKnown: again.alreadyKnown },
      gluedPairsFoundAgainWithSameUuid: sameUuid,
      restoredAsMissingOwnerUnknownSaleBlocked: safeState,
      reconciliationDiscrepanciesOpen:
        openRecon && Array.isArray((openRecon as any).items)
          ? (openRecon as any).items.length
          : await n(`SELECT count(*) AS n FROM "WarehouseException" WHERE "type" = 'RECOVERY_RECONCILE' AND "status" = 'OPEN'`),
      sellableAmongRestored: await n(`SELECT count(*) AS n FROM "WarehouseUnit" WHERE "originType" = 'RECOVERED' AND "saleState" = 'SALE_AUTHORIZED'`),
    };

    // What the ordinary backup lost: movements after T0.
    const lost = await restored.$queryRawUnsafe<{ id: string; currentLocationId: string }[]>(`SELECT "id", "currentLocationId" FROM "WarehouseUnit" WHERE "id" = ANY($1::text[])`, oldPairs.map((o) => o.id));
    report.movementsLostByRestore = {
      oldPairsMovedAfterBackup: oldPairs.length,
      backAtTheirT0Address: lost.filter((l) => oldPairs.find((o) => o.id === l.id)?.currentLocationId === l.currentLocationId).length,
      putawaysLost: putAway,
      procedure: "Recount the levels touched since the backup (stock-take session per level): pairs found elsewhere are moved by scan, with a discrepancy.",
    };

    // The restored database still guards identities and can issue again.
    const triggers = await n(`SELECT count(*) AS n FROM pg_trigger WHERE tgname LIKE 'trg_warehouse_%' AND NOT tgisinternal`);
    const migrations = await n(`SELECT count(*) AS n FROM "_prisma_migrations" WHERE "migration_name" LIKE '%warehouse_lot1%' AND "finished_at" IS NOT NULL`);
    const batchR = await batches.createBatch(
      restored,
      { siteId: site.id, kind: "RECEIVING", flow: "CONSIGNMENT", ownerKind: "PARTNER", ownerPartnerId: partner.id, receivingLocationId: rec.id, title: "Après restauration" } as any,
      admin
    );
    const fresh = await batches.receiveUnit(restored, { opKey: op(), batchId: batchR.id, itemId, condition: "NEW" } as any, admin);
    report.restoredDatabase = {
      identityTriggers: triggers,
      warehouseMigrationsRecorded: migrations,
      codes: await n(`SELECT count(*) AS n FROM "WarehouseLabelCode"`),
      distinctCodes: await n(`SELECT count(DISTINCT "code") AS n FROM "WarehouseLabelCode"`),
      newIssueAfterRestore: fresh.unit.labelCode,
      newIssueCollidesWithJournaledCode: glued.some((g) => g.code === fresh.unit.labelCode),
    };
    report.verdict = {
      identitiesPermanent: report.referenceQrAfterRestore.allResolveToSameUuid && report.referenceQrAfterRestore.stateIdenticalToT0,
      noPairCreatedFromScan: report.gluedAfterBackup.pairsCreatedByScanning === 0 && unknown === glued.length,
      journalRecoversIdentities: sameUuid === glued.length && safeState === glued.length && again.restored === 0,
      rpoIdentities: "0 code lost when the journal sink is current (here: flushed after every batch).",
      rpoMovements: "Everything since the last ordinary backup (here: the T0 copy).",
      rtoMeasuredHere: `${report.backup.copyAndStartSeconds} s to copy and start ${report.backup.sizeMb} MB + ${report.journalReconcile.applied.seconds} s journal reconcile — local disk, not the VPS.`,
    };
  } finally {
    await restored.$disconnect();
    try {
      execFileSync(devDb, ["stop-clone", cloneDir], { stdio: "pipe", env: process.env });
    } catch {}
    rmSync(cloneDir, { recursive: true, force: true });
  }

  const json = JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2);
  if (OUT) writeFileSync(OUT, json);
  console.log(json);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  try {
    execFileSync(devDb, ["stop-clone", cloneDir], { stdio: "pipe", env: process.env });
  } catch {}
  process.exit(1);
});
