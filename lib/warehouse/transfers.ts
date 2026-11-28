import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withTx, type WarehouseConn, type WarehouseDb, type WarehouseTx } from "./db";
import { conflict, invalid, notFound } from "./errors";
import { openExceptionTx } from "./exceptions";
import { assertWritesEnabled, runOperation, type OperationResult } from "./operations";
import { ensurePutawayTaskTx } from "./putaway";
import type { ActorContext, LocationKind, UnitSummary } from "./types";
import { applyUnitChangeTx, getUnitSummary, lockUnitTx, moveOccupancyTx, releaseActiveTaskTx } from "./units";

/**
 * Transfers between sites (CH01 → DE01). An operation on EXISTING units: same UUID, same QR,
 * the issuing site never changes.
 *
 *   departure scan → presence IN_TRANSIT (no address, excluded from availability)
 *   arrival scan   → PRESENT at a location of the destination site
 *
 * A unit has a single current logistic state: one IN_TRANSIT row per unit (partial unique
 * index), and only units actually scanned on arrival reach the destination (A49).
 * Service-level in lot 1 (the transfer screen comes later).
 */

export type TransferRow = {
  id: string;
  reference: string;
  fromSiteId: string;
  fromSiteCode: string;
  toSiteId: string;
  toSiteCode: string;
  status: "OPEN" | "IN_TRANSIT" | "RECEIVED" | "PARTIAL" | "CLOSED";
  note: string | null;
  shippedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  inTransit: number;
  received: number;
  missing: number;
};

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function getTransfer(conn: WarehouseConn, idOrReference: string): Promise<TransferRow> {
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`
    SELECT t."id", t."reference", t."fromSiteId", fs."code" AS "fromSiteCode", t."toSiteId", ts."code" AS "toSiteCode", t."status",
           t."note", t."shippedAt", t."closedAt", t."createdAt",
           (SELECT count(*)::int FROM "WarehouseTransferUnit" x WHERE x."transferId" = t."id" AND x."status" = 'IN_TRANSIT') AS "inTransit",
           (SELECT count(*)::int FROM "WarehouseTransferUnit" x WHERE x."transferId" = t."id" AND x."status" = 'RECEIVED') AS "received",
           (SELECT count(*)::int FROM "WarehouseTransferUnit" x WHERE x."transferId" = t."id" AND x."status" = 'MISSING') AS "missing"
    FROM "WarehouseTransfer" t
    JOIN "WarehouseSite" fs ON fs."id" = t."fromSiteId"
    JOIN "WarehouseSite" ts ON ts."id" = t."toSiteId"
    WHERE t."id" = ${idOrReference} OR t."reference" = ${idOrReference}`);
  if (!rows[0]) throw notFound("Transfert");
  const t = rows[0];
  return { ...t, shippedAt: iso(t.shippedAt), closedAt: iso(t.closedAt), createdAt: iso(t.createdAt) };
}

export async function listTransfers(conn: WarehouseConn, input: { siteId?: string; limit?: number } = {}): Promise<TransferRow[]> {
  const ids = await conn.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "WarehouseTransfer"
    ${input.siteId ? Prisma.sql`WHERE "fromSiteId" = ${input.siteId} OR "toSiteId" = ${input.siteId}` : Prisma.empty}
    ORDER BY "createdAt" DESC LIMIT ${Math.min(100, Math.max(1, input.limit ?? 30))}`);
  return Promise.all(ids.map((r) => getTransfer(conn, r.id)));
}

export async function createTransfer(db: WarehouseDb, input: { fromSiteId: string; toSiteId: string; note?: string | null }): Promise<TransferRow> {
  assertWritesEnabled();
  if (input.fromSiteId === input.toSiteId) throw invalid("Un transfert relie deux sites différents.");
  const id = await withTx(db, async (tx) => {
    const sites = await tx.$queryRaw<{ id: string; code: string; status: string }[]>(Prisma.sql`
      SELECT "id", "code", "status" FROM "WarehouseSite" WHERE "id" IN (${input.fromSiteId}, ${input.toSiteId})`);
    const from = sites.find((s) => s.id === input.fromSiteId);
    const to = sites.find((s) => s.id === input.toSiteId);
    if (!from || !to) throw notFound("Site");
    if (to.status !== "ACTIVE") throw conflict("LOCATION_NOT_USABLE", `Le site ${to.code} est retiré : aucun transfert entrant.`);
    const prefix = `TRF-${from.code}-${to.code}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const n = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM "WarehouseTransfer" WHERE "reference" LIKE ${`${prefix}-%`}`);
      const newId = randomUUID();
      const inserted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO "WarehouseTransfer" ("id", "reference", "fromSiteId", "toSiteId", "note")
        VALUES (${newId}, ${`${prefix}-${String(n[0].n + 1 + attempt).padStart(2, "0")}`}, ${from.id}, ${to.id}, ${input.note?.trim().slice(0, 500) || null})
        ON CONFLICT ("reference") DO NOTHING RETURNING "id"`);
      if (inserted[0]) return newId;
    }
    throw conflict("CONFLICT", "Référence de transfert déjà prise : réessayer.");
  });
  return getTransfer(db, id);
}

async function refreshTransferStatusTx(tx: WarehouseTx, transferId: string): Promise<void> {
  const c = await tx.$queryRaw<{ transit: number; received: number; missing: number }[]>(Prisma.sql`
    SELECT count(*) FILTER (WHERE "status" = 'IN_TRANSIT')::int AS "transit",
           count(*) FILTER (WHERE "status" = 'RECEIVED')::int AS "received",
           count(*) FILTER (WHERE "status" = 'MISSING')::int AS "missing"
    FROM "WarehouseTransferUnit" WHERE "transferId" = ${transferId}`);
  const { transit, received, missing } = c[0];
  const status = transit > 0 ? "IN_TRANSIT" : received + missing === 0 ? "OPEN" : missing > 0 ? "PARTIAL" : "RECEIVED";
  await tx.$executeRaw(Prisma.sql`
    UPDATE "WarehouseTransfer" SET "status" = ${status},
      "shippedAt" = CASE WHEN "shippedAt" IS NULL AND ${transit + received + missing} > 0 THEN now() ELSE "shippedAt" END,
      "closedAt" = CASE WHEN ${status} IN ('RECEIVED', 'PARTIAL') THEN now() ELSE NULL END, "updatedAt" = now()
    WHERE "id" = ${transferId}`);
}

/** Departure scan: the pair leaves its address and its site's availability, and travels with its own QR. */
export async function shipTransferUnit(
  db: WarehouseDb,
  input: { opKey: string; transferId: string; unitId: string },
  ctx: ActorContext
): Promise<OperationResult<{ unit: UnitSummary; transferReference: string }>> {
  return runOperation(db, { opKey: input.opKey, kind: "TRANSFER_SHIP", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    const tr = await tx.$queryRaw<{ id: string; reference: string; fromSiteId: string; toSiteId: string; status: string }[]>(Prisma.sql`
      SELECT "id", "reference", "fromSiteId", "toSiteId", "status" FROM "WarehouseTransfer" WHERE "id" = ${input.transferId} FOR UPDATE`);
    const t = tr[0];
    if (!t) throw notFound("Transfert");
    if (t.status === "RECEIVED" || t.status === "PARTIAL" || t.status === "CLOSED") throw conflict("CONFLICT", "Transfert clos : en créer un nouveau.");
    if (unit.presence !== "PRESENT") throw conflict("UNIT_NOT_PRESENT", "Seule une paire présente et localisée peut partir en transfert.", { presence: unit.presence });
    if (unit.currentSiteId !== t.fromSiteId) throw conflict("SITE_MISMATCH", "Cette paire n'est pas sur le site de départ du transfert.");
    const allocated = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "WarehouseSaleAllocation" WHERE "unitId" = ${unit.id} AND "status" = 'ACTIVE'`);
    if (allocated[0]) throw conflict("ALREADY_ALLOCATED", "Paire engagée sur une vente : traiter la réservation avant un transfert.");

    await releaseActiveTaskTx(tx, unit.id, "TRANSFER");
    await moveOccupancyTx(tx, { fromId: unit.currentLocationId, toId: null });
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WarehouseTransferUnit" ("id", "transferId", "unitId") VALUES (${randomUUID()}, ${t.id}, ${unit.id})
      ON CONFLICT ("transferId", "unitId") DO UPDATE SET "status" = 'IN_TRANSIT', "receivedAt" = NULL, "receivedLocationId" = NULL, "updatedAt" = now()`);
    await applyUnitChangeTx(tx, unit, { presence: "IN_TRANSIT", currentLocationId: null }, { type: "TRANSFER_OUT", transferId: t.id }, ctx, input.opKey);
    await refreshTransferStatusTx(tx, t.id);
    return { unit: await getUnitSummary(tx, unit.id), transferReference: t.reference };
  });
}

/**
 * Arrival scan at the destination: the ORIGINAL QR finds the same unit; it becomes PRESENT at a
 * location of the site where it is really scanned. Arriving at another site than planned is
 * recorded as observed (with a discrepancy) only when `acceptOtherSite` is explicit (A24).
 */
export async function receiveTransferUnit(
  db: WarehouseDb,
  input: { opKey: string; unitId: string; toLocationId: string; acceptOtherSite?: boolean },
  ctx: ActorContext
): Promise<OperationResult<{ unit: UnitSummary; transferReference: string; taskId: string | null }>> {
  return runOperation(db, { opKey: input.opKey, kind: "TRANSFER_RECEIVE", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    if (unit.presence !== "IN_TRANSIT") {
      throw conflict("UNIT_STATE_CONFLICT", "Cette paire n'est pas en transit. Si elle est déjà sur site, sa fiche indique son adresse.", { presence: unit.presence });
    }
    const rows = await tx.$queryRaw<{ id: string; transferId: string; reference: string; toSiteId: string }[]>(Prisma.sql`
      SELECT x."id", x."transferId", t."reference", t."toSiteId"
      FROM "WarehouseTransferUnit" x JOIN "WarehouseTransfer" t ON t."id" = x."transferId"
      WHERE x."unitId" = ${unit.id} AND x."status" = 'IN_TRANSIT' FOR UPDATE OF x`);
    const line = rows[0];
    if (!line) throw conflict("UNIT_STATE_CONFLICT", "Aucun transfert en cours pour cette paire : ouvrir un écart.");
    const locs = await tx.$queryRaw<{ id: string; siteId: string; kind: LocationKind; code: string; holdsUnits: boolean }[]>(Prisma.sql`
      SELECT "id", "siteId", "kind", "code", "holdsUnits" FROM "WarehouseLocation" WHERE "id" = ${input.toLocationId}`);
    const loc = locs[0];
    if (!loc) throw notFound("Emplacement");
    if (!loc.holdsUnits) throw conflict("LOCATION_NOT_USABLE", `${loc.code} est un repère de structure.`);
    const otherSite = loc.siteId !== line.toSiteId;
    if (otherSite && !input.acceptOtherSite) {
      throw conflict("SITE_MISMATCH", "Cet emplacement n'est pas sur le site de destination du transfert. Confirmer pour enregistrer le site réel.", { confirm: "acceptOtherSite" });
    }
    await moveOccupancyTx(tx, { fromId: null, toId: loc.id });
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseTransferUnit" SET "status" = 'RECEIVED', "receivedAt" = now(), "receivedLocationId" = ${loc.id}, "updatedAt" = now() WHERE "id" = ${line.id}`);
    await applyUnitChangeTx(
      tx,
      unit,
      { presence: "PRESENT", currentSiteId: loc.siteId, currentLocationId: loc.id },
      { type: "TRANSFER_IN", transferId: line.transferId, changes: otherSite ? { receivedAtOtherSite: true } : null },
      ctx,
      input.opKey
    );
    if (otherSite) {
      await openExceptionTx(tx, { siteId: loc.siteId, type: "WRONG_LOCATION", unitId: unit.id, locationId: loc.id, details: { transfer: line.reference, plannedSiteId: line.toSiteId }, opKey: `${input.opKey}:site` }, ctx);
    }
    const taskId =
      (loc.kind === "RECEIVING" || loc.kind === "CART") && unit.qcState !== "QUARANTINE"
        ? await ensurePutawayTaskTx(tx, { unitId: unit.id, siteId: loc.siteId, batchId: null, fromLocationId: loc.id, fromKind: loc.kind }, ctx)
        : null;
    await refreshTransferStatusTx(tx, line.transferId);
    return { unit: await getUnitSummary(tx, unit.id), transferReference: line.reference, taskId };
  });
}

/** A shipped pair that never arrived: stays out of availability (MISSING), with a discrepancy. */
export async function markTransferUnitMissing(
  db: WarehouseDb,
  input: { opKey: string; unitId: string; reason: string },
  ctx: ActorContext
): Promise<OperationResult<{ unit: UnitSummary; exceptionId: string }>> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3) throw invalid("Motif requis.");
  return runOperation(db, { opKey: input.opKey, kind: "TRANSFER_MISSING", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    const rows = await tx.$queryRaw<{ id: string; transferId: string; reference: string; toSiteId: string }[]>(Prisma.sql`
      SELECT x."id", x."transferId", t."reference", t."toSiteId"
      FROM "WarehouseTransferUnit" x JOIN "WarehouseTransfer" t ON t."id" = x."transferId"
      WHERE x."unitId" = ${unit.id} AND x."status" = 'IN_TRANSIT' FOR UPDATE OF x`);
    if (unit.presence !== "IN_TRANSIT" || !rows[0]) throw conflict("UNIT_STATE_CONFLICT", "Cette paire n'est pas en transit.");
    await tx.$executeRaw(Prisma.sql`UPDATE "WarehouseTransferUnit" SET "status" = 'MISSING', "updatedAt" = now() WHERE "id" = ${rows[0].id}`);
    await applyUnitChangeTx(tx, unit, { presence: "MISSING" }, { type: "MARK_MISSING", reason, transferId: rows[0].transferId }, ctx, input.opKey);
    const exceptionId = await openExceptionTx(
      tx,
      { siteId: rows[0].toSiteId, type: "UNIT_NOT_FOUND", unitId: unit.id, details: { transfer: rows[0].reference, reason }, opKey: `${input.opKey}:exc` },
      ctx
    );
    await refreshTransferStatusTx(tx, rows[0].transferId);
    return { unit: await getUnitSummary(tx, unit.id), exceptionId };
  });
}
