import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withTx, type WarehouseConn, type WarehouseDb, type WarehouseTx } from "./db";
import { WarehouseError, invalid, notFound } from "./errors";
import { assertWritesEnabled } from "./operations";
import type { ActorContext, ExceptionStatus, ExceptionType } from "./types";

/**
 * Discrepancies ("Écarts et contrôles"). An exception records a fact to arbitrate; it never
 * changes stock by itself. Resolution requires a reason (and a proof reference when relevant).
 */

export const EXCEPTION_TYPES: ExceptionType[] = [
  "UNKNOWN_GTIN",
  "AMBIGUOUS_GTIN",
  "UNKNOWN_CODE",
  "WRONG_CODE_TYPE",
  "SURPLUS",
  "MISSING",
  "WRONG_VARIANT",
  "OWNER_SUSPECT",
  "DUPLICATE_SCAN",
  "DUPLICATE_LABEL",
  "LABEL_LOST",
  "LEVEL_FULL",
  "CAPACITY_MISMATCH",
  "WRONG_LOCATION",
  "UNIT_NOT_FOUND",
  "PRINT_UNCERTAIN",
  "RECOVERY_RECONCILE",
  "COUNT_MISMATCH",
  "OTHER",
];

export const EXCEPTION_LABELS: Record<ExceptionType, string> = {
  UNKNOWN_GTIN: "GTIN inconnu",
  AMBIGUOUS_GTIN: "GTIN ambigu",
  UNKNOWN_CODE: "Code inconnu",
  WRONG_CODE_TYPE: "Mauvais type de code",
  SURPLUS: "Excédent",
  MISSING: "Manquant",
  WRONG_VARIANT: "Mauvaise variante",
  OWNER_SUSPECT: "Propriétaire à confirmer",
  DUPLICATE_SCAN: "Double scan",
  DUPLICATE_LABEL: "Étiquette en double",
  LABEL_LOST: "Étiquette perdue",
  LEVEL_FULL: "Niveau plein",
  CAPACITY_MISMATCH: "Capacité dépassée",
  WRONG_LOCATION: "Mauvais emplacement",
  UNIT_NOT_FOUND: "Paire introuvable",
  PRINT_UNCERTAIN: "Impression incertaine",
  RECOVERY_RECONCILE: "Rapprochement après reprise",
  COUNT_MISMATCH: "Écart de comptage",
  OTHER: "Autre",
};

export type OpenExceptionInput = {
  siteId?: string | null;
  type: ExceptionType;
  unitId?: string | null;
  locationId?: string | null;
  batchId?: string | null;
  rawCode?: string | null;
  details?: Record<string, unknown> | null;
  /** Idempotency: the same key never opens two exceptions. */
  opKey?: string | null;
};

export async function openExceptionTx(tx: WarehouseTx, input: OpenExceptionInput, ctx: ActorContext): Promise<string> {
  const id = randomUUID();
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO "WarehouseException"
      ("id", "siteId", "type", "unitId", "locationId", "batchId", "rawCode", "details", "createdByRole", "createdByOperatorId", "opKey")
    VALUES
      (${id}, ${input.siteId ?? null}, ${input.type}, ${input.unitId ?? null}, ${input.locationId ?? null}, ${input.batchId ?? null},
       ${input.rawCode ? String(input.rawCode).slice(0, 200) : null}, ${input.details ? JSON.stringify(input.details) : null}::jsonb,
       ${ctx.role}, ${ctx.operatorId ?? null}, ${input.opKey ?? null})
    ON CONFLICT ("opKey") DO NOTHING
    RETURNING "id"`);
  if (rows[0]) return rows[0].id;
  const existing = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "WarehouseException" WHERE "opKey" = ${input.opKey}`);
  return existing[0].id;
}

/** Operator-raised discrepancy (unknown code, surplus box, lost label…). */
export async function openException(db: WarehouseDb, input: OpenExceptionInput, ctx: ActorContext): Promise<{ id: string }> {
  assertWritesEnabled();
  if (!EXCEPTION_TYPES.includes(input.type)) throw invalid("Type d'écart invalide.");
  return { id: await withTx(db, (tx) => openExceptionTx(tx, input, ctx)) };
}

export type ExceptionRow = {
  id: string;
  siteId: string | null;
  type: ExceptionType;
  typeLabel: string;
  status: ExceptionStatus;
  unitId: string | null;
  unitLabelCode: string | null;
  itemName: string | null;
  itemSizeLabel: string | null;
  locationCode: string | null;
  batchId: string | null;
  batchReference: string | null;
  rawCode: string | null;
  details: unknown;
  resolution: string | null;
  resolutionReason: string | null;
  proofRef: string | null;
  createdByOperatorName: string | null;
  resolvedByOperatorName: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export async function listExceptions(
  conn: WarehouseConn,
  input: { siteId?: string; status?: ExceptionStatus; type?: ExceptionType; batchId?: string; unitId?: string; limit?: number; cursor?: string | null }
): Promise<{ items: ExceptionRow[]; nextCursor: string | null; openByType: Record<string, number> }> {
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (input.siteId) where.push(Prisma.sql`(e."siteId" = ${input.siteId} OR e."siteId" IS NULL)`);
  if (input.status) where.push(Prisma.sql`e."status" = ${input.status}`);
  if (input.type) where.push(Prisma.sql`e."type" = ${input.type}`);
  if (input.batchId) where.push(Prisma.sql`e."batchId" = ${input.batchId}`);
  if (input.unitId) where.push(Prisma.sql`e."unitId" = ${input.unitId}`);
  if (input.cursor) {
    const [at, id] = input.cursor.split("|");
    const date = new Date(at);
    if (!Number.isNaN(date.getTime()) && id) where.push(Prisma.sql`(e."createdAt", e."id") < (${date}, ${id})`);
  }
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`
    SELECT e."id", e."siteId", e."type", e."status", e."unitId", u."labelCode" AS "unitLabelCode", i."name" AS "itemName",
           i."sizeLabel" AS "itemSizeLabel", l."code" AS "locationCode", e."batchId", b."reference" AS "batchReference",
           e."rawCode", e."details", e."resolution", e."resolutionReason", e."proofRef",
           co."name" AS "createdByOperatorName", ro."name" AS "resolvedByOperatorName", e."resolvedAt", e."createdAt"
    FROM "WarehouseException" e
    LEFT JOIN "WarehouseUnit" u ON u."id" = e."unitId"
    LEFT JOIN "WarehouseItem" i ON i."id" = u."itemId"
    LEFT JOIN "WarehouseLocation" l ON l."id" = e."locationId"
    LEFT JOIN "WarehouseBatch" b ON b."id" = e."batchId"
    LEFT JOIN "WarehouseOperator" co ON co."id" = e."createdByOperatorId"
    LEFT JOIN "WarehouseOperator" ro ON ro."id" = e."resolvedByOperatorId"
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY e."createdAt" DESC, e."id" DESC LIMIT ${limit + 1}`);
  const counts = await conn.$queryRaw<{ type: string; n: number }[]>(Prisma.sql`
    SELECT "type", count(*)::int AS n FROM "WarehouseException"
    WHERE "status" = 'OPEN' ${input.siteId ? Prisma.sql`AND ("siteId" = ${input.siteId} OR "siteId" IS NULL)` : Prisma.empty}
    GROUP BY "type"`);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      ...r,
      typeLabel: EXCEPTION_LABELS[r.type as ExceptionType] ?? r.type,
      resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
      createdAt: new Date(r.createdAt).toISOString(),
    })),
    nextCursor: rows.length > limit && last ? `${new Date(last.createdAt).toISOString()}|${last.id}` : null,
    openByType: Object.fromEntries(counts.map((c) => [c.type, c.n])),
  };
}

/**
 * Close a discrepancy with the decision taken. The stock correction itself (move, owner change,
 * variant correction, missing…) is a separate audited gesture — resolving only documents it.
 */
export async function resolveException(
  db: WarehouseDb,
  input: { id: string; status: "RESOLVED" | "DISMISSED"; resolution: string; reason: string; proofRef?: string | null },
  ctx: ActorContext
): Promise<{ id: string; status: ExceptionStatus }> {
  assertWritesEnabled();
  if (!["RESOLVED", "DISMISSED"].includes(input.status)) throw invalid("Statut invalide.");
  const reason = String(input.reason ?? "").trim();
  const resolution = String(input.resolution ?? "").trim();
  if (reason.length < 3) throw invalid("Motif requis pour clore un écart.");
  if (!resolution) throw invalid("Décision requise pour clore un écart.");
  const rows = await db.$queryRaw<{ id: string; status: ExceptionStatus }[]>(Prisma.sql`
    UPDATE "WarehouseException"
    SET "status" = ${input.status}, "resolution" = ${resolution.slice(0, 200)}, "resolutionReason" = ${reason.slice(0, 2000)},
        "proofRef" = ${input.proofRef?.trim().slice(0, 500) || null}, "resolvedByOperatorId" = ${ctx.operatorId ?? null},
        "resolvedAt" = now(), "updatedAt" = now()
    WHERE "id" = ${input.id} AND "status" = 'OPEN'
    RETURNING "id", "status"`);
  if (rows[0]) return rows[0];
  const existing = await db.$queryRaw<{ id: string; status: ExceptionStatus }[]>(Prisma.sql`
    SELECT "id", "status" FROM "WarehouseException" WHERE "id" = ${input.id}`);
  if (!existing[0]) throw notFound("Écart");
  if (existing[0].status === input.status) return existing[0];
  throw new WarehouseError("CONFLICT", "Cet écart est déjà clos.", 409);
}
