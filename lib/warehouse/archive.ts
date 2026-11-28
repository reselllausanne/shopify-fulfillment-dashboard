import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withTx, type WarehouseConn, type WarehouseDb } from "./db";
import { invalid } from "./errors";
import { assertWritesEnabled } from "./operations";

/**
 * History archiving (scale: the hot movement journal must stay bounded).
 *
 * Only units that LEFT the warehouse are archived, and only their movement history: the unit row,
 * its label code and its registry entry stay in the hot tables forever, so an old QR still
 * resolves by the same unique-index lookup. The moved rows are copied verbatim (JSON) into
 * `WarehouseMovementArchive` in the same transaction that deletes them from the journal — the
 * journal's append-only trigger only lets this routine delete (`warehouse.archiving`).
 */

export type ArchiveResult = { archiveRef: string; units: number; movements: number };

export async function archiveOutUnitHistory(
  db: WarehouseDb,
  input: { outBefore: Date; limitUnits?: number; unitIds?: string[] }
): Promise<ArchiveResult> {
  assertWritesEnabled();
  if (!(input.outBefore instanceof Date) || Number.isNaN(input.outBefore.getTime())) throw invalid("Date limite invalide.");
  const archiveRef = `ARC-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const limit = Math.min(5000, Math.max(1, input.limitUnits ?? 500));
  return withTx(
    db,
    async (tx) => {
      const units = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "WarehouseUnit"
        WHERE "presence" = 'OUT' AND "outAt" IS NOT NULL AND "outAt" < ${input.outBefore} AND "historyArchivedAt" IS NULL
          ${input.unitIds?.length ? Prisma.sql`AND "id" IN (${Prisma.join(input.unitIds)})` : Prisma.empty}
        ORDER BY "outAt", "id" LIMIT ${limit} FOR UPDATE SKIP LOCKED`);
      if (units.length === 0) return { archiveRef, units: 0, movements: 0 };
      const ids = units.map((u) => u.id);
      await tx.$executeRaw(Prisma.sql`SET LOCAL warehouse.archiving = 'on'`);
      const copied = await tx.$executeRaw(Prisma.sql`
        INSERT INTO "WarehouseMovementArchive" ("id", "seq", "unitId", "archiveRef", "row")
        SELECT m."id", m."seq", m."unitId", ${archiveRef}, to_jsonb(m) FROM "WarehouseMovement" m WHERE m."unitId" IN (${Prisma.join(ids)})`);
      const deleted = await tx.$executeRaw(Prisma.sql`DELETE FROM "WarehouseMovement" WHERE "unitId" IN (${Prisma.join(ids)})`);
      if (copied !== deleted) throw new Error(`archive mismatch: copied ${copied}, deleted ${deleted}`);
      await tx.$executeRaw(Prisma.sql`SET LOCAL warehouse.archiving = 'off'`);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "WarehouseUnit" SET "historyArchivedAt" = now(), "historyArchiveRef" = ${archiveRef}, "updatedAt" = now()
        WHERE "id" IN (${Prisma.join(ids)})`);
      return { archiveRef, units: ids.length, movements: copied };
    },
    { timeoutMs: 120_000 }
  );
}

/** Archived history of one unit, oldest first (same shape as the live journal rows). */
export async function getArchivedMovements(conn: WarehouseConn, unitId: string): Promise<Record<string, unknown>[]> {
  const rows = await conn.$queryRaw<{ row: Record<string, unknown> }[]>(Prisma.sql`
    SELECT "row" FROM "WarehouseMovementArchive" WHERE "unitId" = ${unitId} ORDER BY "seq"`);
  return rows.map((r) => r.row);
}
