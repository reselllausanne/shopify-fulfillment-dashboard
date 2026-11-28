import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { WarehouseDb } from "./db";
import { conflict, invalid, isUniqueViolation, notFound } from "./errors";
import { runOperation, type OperationResult } from "./operations";
import type { ActorContext } from "./types";
import { applyUnitChangeTx, lockUnitTx } from "./units";

/**
 * Sale allocation — the lot-2 seam, delivered as an INTERNAL service only.
 *
 * It reserves one physical unit for one order line, with the sale terms frozen at that moment.
 * At most one ACTIVE allocation per unit (partial unique index), checked inside the transaction.
 * Nothing here talks to Shopify, Galaxus or any connector, and no screen or job calls it in
 * lot 1: the reservation trigger per channel is a lot-2 decision.
 */

export async function allocateUnit(
  db: WarehouseDb,
  input: { opKey: string; unitId: string; channel: string; orderRef: string; lineRef?: string | null; terms?: Record<string, unknown> | null },
  ctx: ActorContext
): Promise<OperationResult<{ allocationId: string; unitId: string }>> {
  const channel = String(input.channel ?? "").trim().toUpperCase();
  const orderRef = String(input.orderRef ?? "").trim();
  if (!channel || !orderRef) throw invalid("Canal et référence de commande requis.");
  return runOperation(db, { opKey: input.opKey, kind: "SALE_ALLOCATE", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    const blockers: string[] = [];
    if (unit.presence !== "PRESENT") blockers.push("paire non présente");
    if (unit.qcState !== "PASSED") blockers.push(unit.qcState === "QUARANTINE" ? "en quarantaine" : "contrôle non validé");
    if (unit.saleState !== "SALE_AUTHORIZED") blockers.push(unit.saleState === "STORAGE_ONLY" ? "stockage seul" : "vente bloquée");
    if (blockers.length) throw conflict("UNIT_STATE_CONFLICT", `Paire non réservable : ${blockers.join(", ")}.`, { blockers });
    const price = await tx.$queryRaw<any[]>(Prisma.sql`
      SELECT "id", "currency", "publicPrice"::text AS "publicPrice", "sellerNet"::text AS "sellerNet", "fees"::text AS "fees", "agreementId"
      FROM "WarehouseUnitPrice" WHERE "unitId" = ${unit.id} AND "status" = 'VALIDATED'`);
    const id = randomUUID();
    try {
      // Savepoint semantics are not needed: a unique violation aborts the whole operation.
      const inserted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO "WarehouseSaleAllocation" ("id", "unitId", "channel", "orderRef", "lineRef", "terms", "opKey")
        SELECT ${id}, ${unit.id}, ${channel}, ${orderRef}, ${input.lineRef ?? null},
               ${JSON.stringify({ ...(input.terms ?? {}), priceAtAllocation: price[0] ?? null, ownerKind: unit.ownerKind, ownerPartnerId: unit.ownerPartnerId })}::jsonb,
               ${input.opKey}
        WHERE NOT EXISTS (SELECT 1 FROM "WarehouseSaleAllocation" WHERE "unitId" = ${unit.id} AND "status" = 'ACTIVE')
        RETURNING "id"`);
      if (!inserted[0]) throw conflict("ALREADY_ALLOCATED", "Cette paire est déjà réservée pour une autre ligne de commande.");
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("ALREADY_ALLOCATED", "Cette paire est déjà réservée pour une autre ligne de commande.");
      throw err;
    }
    await applyUnitChangeTx(tx, unit, {}, { type: "ALLOCATE", changes: { channel, orderRef, allocationId: id } }, ctx, input.opKey);
    return { allocationId: id, unitId: unit.id };
  });
}

export async function releaseAllocation(
  db: WarehouseDb,
  input: { opKey: string; allocationId: string; reason: string },
  ctx: ActorContext
): Promise<OperationResult<{ allocationId: string; status: string }>> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3) throw invalid("Motif requis pour libérer une réservation.");
  return runOperation(db, { opKey: input.opKey, kind: "SALE_RELEASE", request: input, ctx }, async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; unitId: string; status: string }[]>(Prisma.sql`
      SELECT "id", "unitId", "status" FROM "WarehouseSaleAllocation" WHERE "id" = ${input.allocationId}`);
    if (!rows[0]) throw notFound("Réservation");
    const unit = await lockUnitTx(tx, rows[0].unitId);
    const updated = await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseSaleAllocation" SET "status" = 'RELEASED', "releasedAt" = now(), "updatedAt" = now()
      WHERE "id" = ${input.allocationId} AND "status" = 'ACTIVE'`);
    if (updated === 1) {
      await applyUnitChangeTx(tx, unit, {}, { type: "RELEASE", reason, changes: { allocationId: input.allocationId } }, ctx, input.opKey);
    }
    return { allocationId: input.allocationId, status: updated === 1 ? "RELEASED" : rows[0].status };
  });
}
