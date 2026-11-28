import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { UNIT_LABEL_FORMAT_V1, classifyScan } from "./codes";
import { labelJournalDir } from "./config";
import { withTx, type WarehouseConn, type WarehouseDb } from "./db";
import { WarehouseError } from "./errors";
import { openExceptionTx } from "./exceptions";
import { assertWritesEnabled } from "./operations";

/**
 * Label issuance journal — protects QR codes that are already stuck on boxes (C01).
 *
 * Every issued code is written to `WarehouseLabelJournal` in the same transaction as the unit,
 * then appended (JSONL, fsync) to an independent sink: a directory that must live OFF the
 * primary database disk (another volume, or a folder shipped off-box). After a restore to an
 * earlier point in time, `reconcileJournal` re-attaches the codes issued since the backup:
 * same UUID, same code — in an explicit uncertain state with a reconciliation discrepancy.
 * It never invents an owner, an address, a sale right or an availability from a QR alone.
 */

export type JournalEntry = {
  v: number;
  seq: string;
  code: string;
  unitId: string;
  format: string;
  issuingSiteCode: string;
  itemId: string | null;
  ownerKind: string | null;
  ownerPartnerId: string | null;
  originType: string | null;
  originBatchId: string | null;
  locationId: string | null;
  issuedAt: string;
  /** sha256 of the payload as stored in the database row. */
  payloadHash: string;
};

const fileFor = (dir: string, issuedAt: string) => path.join(dir, `label-journal-${issuedAt.slice(0, 7)}.jsonl`);

/**
 * Append pending journal rows to the sink, then mark them exported. Crash-safe: a row is marked
 * only after its line is fsynced; a replay may append a line twice (readers de-duplicate by
 * code), it can never lose one.
 */
export async function exportLabelJournal(db: WarehouseDb, opts: { dir?: string | null; limit?: number } = {}): Promise<{ exported: number; pending: number; sink: string | null }> {
  const dir = opts.dir ?? labelJournalDir();
  const pendingCount = async () =>
    (await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM "WarehouseLabelJournal" WHERE "exportedAt" IS NULL`))[0].n;
  if (!dir) return { exported: 0, pending: await pendingCount(), sink: null };
  await fs.mkdir(dir, { recursive: true });
  const rows = await db.$queryRaw<{ seq: bigint; code: string; unitId: string; payload: any; payloadHash: string; issuedAt: Date }[]>(Prisma.sql`
    SELECT "seq", "code", "unitId", "payload", "payloadHash", "issuedAt" FROM "WarehouseLabelJournal"
    WHERE "exportedAt" IS NULL ORDER BY "seq" LIMIT ${Math.min(5000, Math.max(1, opts.limit ?? 1000))}`);
  if (rows.length === 0) return { exported: 0, pending: 0, sink: dir };

  const byFile = new Map<string, { lines: string[]; seqs: bigint[] }>();
  for (const r of rows) {
    const issuedAt = new Date(r.issuedAt).toISOString();
    const entry: JournalEntry = {
      v: 1,
      seq: r.seq.toString(),
      code: r.code,
      unitId: r.unitId,
      format: r.payload?.format ?? UNIT_LABEL_FORMAT_V1,
      issuingSiteCode: r.payload?.issuingSiteCode ?? r.code.slice(-4),
      itemId: r.payload?.itemId ?? null,
      ownerKind: r.payload?.ownerKind ?? null,
      ownerPartnerId: r.payload?.ownerPartnerId ?? null,
      originType: r.payload?.originType ?? null,
      originBatchId: r.payload?.originBatchId ?? null,
      locationId: r.payload?.locationId ?? null,
      issuedAt,
      payloadHash: r.payloadHash,
    };
    const file = fileFor(dir, issuedAt);
    if (!byFile.has(file)) byFile.set(file, { lines: [], seqs: [] });
    byFile.get(file)!.lines.push(JSON.stringify(entry));
    byFile.get(file)!.seqs.push(r.seq);
  }
  let exported = 0;
  for (const [file, { lines, seqs }] of byFile) {
    const handle = await fs.open(file, "a");
    try {
      await handle.appendFile(`${lines.join("\n")}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await db.$executeRaw(Prisma.sql`
      UPDATE "WarehouseLabelJournal" SET "exportedAt" = now(), "exportSink" = 'file', "exportRef" = ${path.basename(file)}
      WHERE "seq" IN (${Prisma.join(seqs)}) AND "exportedAt" IS NULL`);
    exported += seqs.length;
  }
  return { exported, pending: await pendingCount(), sink: dir };
}

/** Read every journal file of a sink directory, de-duplicated by code (first occurrence wins). */
export async function readJournalDir(dir: string): Promise<JournalEntry[]> {
  const files = (await fs.readdir(dir)).filter((f) => /^label-journal-\d{4}-\d{2}\.jsonl$/.test(f)).sort();
  const seen = new Map<string, JournalEntry>();
  for (const f of files) {
    const text = await fs.readFile(path.join(dir, f), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as JournalEntry;
        if (e?.code && e?.unitId && !seen.has(e.code)) seen.set(e.code, e);
      } catch {
        // A torn last line after a crash: ignored, its row was not marked exported and is re-exported.
      }
    }
  }
  return [...seen.values()];
}

export type ReconcileReport = {
  entries: number;
  alreadyKnown: number;
  restored: number;
  conflicts: { code: string; reason: string }[];
  exceptionIds: string[];
};

/**
 * After a database restore: make every journaled code resolvable again.
 *
 *  - code already in the registry with the same unit → nothing to do;
 *  - code or unit id present but linked differently → reported as a conflict, nothing written;
 *  - missing → the unit is re-created with the SAME id and code, origin RECOVERED, presence
 *    MISSING (address unknown), owner UNKNOWN, sale BLOCKED, plus a RECOVERY_RECONCILE
 *    discrepancy carrying the journal context as hints for the physical check.
 *
 * `dryRun` only reports.
 */
export async function reconcileJournal(db: WarehouseDb, entries: JournalEntry[], opts: { dryRun?: boolean } = {}): Promise<ReconcileReport> {
  if (!opts.dryRun) assertWritesEnabled();
  const report: ReconcileReport = { entries: entries.length, alreadyKnown: 0, restored: 0, conflicts: [], exceptionIds: [] };
  // Fast path: after a restore almost every journaled code is still in the registry. Check them
  // by blocks so that reconciling a million-line journal costs a few hundred indexed queries.
  const known = new Set<string>();
  for (let i = 0; i < entries.length; i += 2000) {
    const codes = entries.slice(i, i + 2000).map((e) => String(e.code).toLowerCase().replace(/-([a-z]{2}[0-9]{2})$/, (_m, s) => `-${s.toUpperCase()}`));
    const rows = await db.$queryRaw<{ code: string; unitId: string }[]>(Prisma.sql`
      SELECT "code", "unitId" FROM "WarehouseLabelCode" WHERE "code" IN (${Prisma.join(codes)})`);
    for (const r of rows) known.add(`${r.code}|${r.unitId}`);
  }
  for (const e of entries) {
    const scan = classifyScan(e.code);
    if (scan.kind === "UNIT_LABEL" && scan.unitId === String(e.unitId).toLowerCase() && known.has(`${scan.code}|${scan.unitId}`)) {
      report.alreadyKnown += 1;
      continue;
    }
    if (scan.kind !== "UNIT_LABEL" || scan.unitId !== String(e.unitId).toLowerCase()) {
      report.conflicts.push({ code: e.code, reason: "Entrée de journal incohérente (code ≠ identifiant)." });
      continue;
    }
    const outcome = await withTx(db, async (tx) => {
      const reg = await tx.$queryRaw<{ unitId: string }[]>(Prisma.sql`SELECT "unitId" FROM "WarehouseLabelCode" WHERE "code" = ${scan.code}`);
      if (reg[0]) return reg[0].unitId === scan.unitId ? ("KNOWN" as const) : ("CONFLICT_CODE" as const);
      const unit = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "WarehouseUnit" WHERE "id" = ${scan.unitId}`);
      if (unit[0]) return "CONFLICT_UNIT" as const;
      if (opts.dryRun) return "WOULD_RESTORE" as const;

      const site = await tx.$queryRaw<{ id: string; code: string }[]>(Prisma.sql`SELECT "id", "code" FROM "WarehouseSite" WHERE "code" = ${scan.issuingSiteCode}`);
      if (!site[0]) return "NO_SITE" as const;
      let itemId: string | null = null;
      if (e.itemId) {
        const item = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "WarehouseItem" WHERE "id" = ${e.itemId}`);
        itemId = item[0]?.id ?? null;
      }
      if (!itemId) {
        // The variant row itself was lost with the restore: a provisional placeholder, to be identified on the box.
        itemId = randomUUID();
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "WarehouseItem" ("id", "name", "status", "catalogSource", "searchText")
          VALUES (${itemId}, 'À identifier (reprise après restauration)', 'PROVISIONAL', 'MANUAL', 'a identifier reprise restauration')`);
      }
      const issuedAt = new Date(e.issuedAt);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "WarehouseUnit"
          ("id", "labelCode", "issuingSiteId", "issuingSiteCode", "itemId", "ownerKind", "originType", "presence", "currentSiteId",
           "qcState", "saleState", "observedAt", "receivedAt")
        VALUES (${scan.unitId}, ${scan.code}, ${site[0].id}, ${site[0].code}, ${itemId}, 'UNKNOWN', 'RECOVERED', 'MISSING', ${site[0].id},
                'PENDING', 'BLOCKED', ${issuedAt}, ${issuedAt})`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "WarehouseLabelCode" ("code", "unitId", "format", "isOriginal", "issuingSiteCode", "issuedAt", "note")
        VALUES (${scan.code}, ${scan.unitId}, ${UNIT_LABEL_FORMAT_V1}, true, ${site[0].code}, ${issuedAt}, 'Restauré depuis le journal d''émission')`);
      const payload = JSON.stringify({ ...e, restoredFromJournal: true });
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "WarehouseLabelJournal" ("code", "unitId", "payload", "payloadHash", "issuedAt", "exportedAt", "exportSink", "exportRef")
        VALUES (${scan.code}, ${scan.unitId}, ${payload}::jsonb, ${createHash("sha256").update(payload).digest("hex")}, ${issuedAt}, now(), 'file', 'restored')
        ON CONFLICT ("code") DO NOTHING`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "WarehouseMovement" ("id", "unitId", "type", "toSiteId", "reason", "actorRole", "unitVersion", "observedAt", "changes")
        VALUES (${randomUUID()}, ${scan.unitId}, 'RECOVERED', ${site[0].id}, 'Lien QR restauré depuis le journal d''émission', 'system', 1, ${issuedAt},
                ${JSON.stringify({ journalSeq: e.seq })}::jsonb)`);
      return openExceptionTx(
        tx,
        {
          siteId: site[0].id,
          type: "RECOVERY_RECONCILE",
          unitId: scan.unitId,
          rawCode: scan.code,
          details: {
            instruction: "Retrouver la boîte, confirmer variante, propriétaire et adresse, puis corriger par gestes audités.",
            hints: { ownerKind: e.ownerKind, ownerPartnerId: e.ownerPartnerId, originType: e.originType, originBatchId: e.originBatchId, locationId: e.locationId, itemId: e.itemId },
          },
          opKey: `journal-restore:${scan.code}`,
        },
        { role: "system" }
      );
    });
    if (outcome === "KNOWN") report.alreadyKnown += 1;
    else if (outcome === "CONFLICT_CODE") report.conflicts.push({ code: e.code, reason: "Ce code désigne déjà une autre paire dans le registre." });
    else if (outcome === "CONFLICT_UNIT") report.conflicts.push({ code: e.code, reason: "L'identifiant existe sans ce code dans le registre." });
    else if (outcome === "NO_SITE") report.conflicts.push({ code: e.code, reason: "Site d'émission absent de la base restaurée." });
    else if (outcome === "WOULD_RESTORE") report.restored += 1;
    else {
      report.restored += 1;
      report.exceptionIds.push(outcome);
    }
  }
  return report;
}

/** Reconcile from the configured sink directory. */
export async function reconcileJournalFromSink(db: WarehouseDb, opts: { dir?: string | null; dryRun?: boolean } = {}): Promise<ReconcileReport> {
  const dir = opts.dir ?? labelJournalDir();
  if (!dir) throw new WarehouseError("INVALID_INPUT", "Aucun support de journal configuré (WAREHOUSE_LABEL_JOURNAL_DIR).", 400);
  return reconcileJournal(db, await readJournalDir(dir), { dryRun: opts.dryRun });
}

export async function getJournalStatus(conn: WarehouseConn): Promise<{ total: number; pendingExport: number; lastExportedAt: string | null; sink: string | null }> {
  const rows = await conn.$queryRaw<{ total: number; pending: number; last: Date | null }[]>(Prisma.sql`
    SELECT count(*)::int AS "total", count(*) FILTER (WHERE "exportedAt" IS NULL)::int AS "pending", max("exportedAt") AS "last"
    FROM "WarehouseLabelJournal"`);
  return { total: rows[0].total, pendingExport: rows[0].pending, lastExportedAt: rows[0].last ? new Date(rows[0].last).toISOString() : null, sink: labelJournalDir() };
}
