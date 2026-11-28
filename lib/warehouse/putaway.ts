import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { reservationTtlMinutes } from "./config";
import { withTx, type WarehouseConn, type WarehouseDb, type WarehouseTx } from "./db";
import { WarehouseError, conflict, invalid, notFound } from "./errors";
import { openExceptionTx } from "./exceptions";
import { assertWritesEnabled, runOperation, type OperationResult } from "./operations";
import type { ActorContext, LocationKind, UnitSummary } from "./types";
import {
  applyUnitChangeTx,
  assertExpectedVersion,
  getUnitSummary,
  lockUnitTx,
  moveOccupancyTx,
  releaseActiveTaskTx,
  type UnitRow,
} from "./units";

/**
 * Directed putaway.
 *
 * Receiving creates a task; the pair is already in stock at a known temporary position.
 * A proposed destination is a RESERVATION of capacity, not a movement: the pair stays at its
 * last confirmed position until the operator scans the level, then the pair.
 *
 * Capacity = occupied + reserved, checked by the database at reservation time and again at
 * confirmation time (conditional UPDATE), so two stations never overbook the last place.
 */

type TaskRow = {
  id: string;
  unitId: string;
  siteId: string;
  batchId: string | null;
  cartLocationId: string | null;
  fromLocationId: string;
  proposedLocationId: string | null;
  status: "PENDING" | "RESERVED" | "DONE" | "CANCELLED";
  holdReason: string | null;
};

async function getActiveTaskTx(tx: WarehouseTx, unitId: string): Promise<TaskRow | null> {
  const rows = await tx.$queryRaw<TaskRow[]>(Prisma.sql`
    SELECT "id", "unitId", "siteId", "batchId", "cartLocationId", "fromLocationId", "proposedLocationId", "status", "holdReason"
    FROM "WarehousePutawayTask" WHERE "unitId" = ${unitId} AND "status" IN ('PENDING', 'RESERVED') FOR UPDATE`);
  return rows[0] ?? null;
}

/** One active task per unit (partial unique index). Creates it PENDING when missing; updates the start point otherwise. */
export async function ensurePutawayTaskTx(
  tx: WarehouseTx,
  input: { unitId: string; siteId: string; batchId: string | null; fromLocationId: string; fromKind: LocationKind },
  ctx: ActorContext
): Promise<string> {
  const cartLocationId = input.fromKind === "CART" ? input.fromLocationId : null;
  const existing = await getActiveTaskTx(tx, input.unitId);
  if (existing) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehousePutawayTask" SET "fromLocationId" = ${input.fromLocationId}, "cartLocationId" = ${cartLocationId}, "updatedAt" = now()
      WHERE "id" = ${existing.id}`);
    return existing.id;
  }
  const id = randomUUID();
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "WarehousePutawayTask" ("id", "unitId", "siteId", "batchId", "cartLocationId", "fromLocationId", "operatorId")
    VALUES (${id}, ${input.unitId}, ${input.siteId}, ${input.batchId}, ${cartLocationId}, ${input.fromLocationId}, ${ctx.operatorId ?? null})`);
  return id;
}

type Slot = { id: string; code: string; shortCode: string };

/**
 * Atomically reserve one place on the first usable level in walk order (same variant first, so
 * identical models end up together). Returns null when the site has no compatible free level.
 */
async function reserveSlotTx(
  tx: WarehouseTx,
  input: { siteId: string; itemId: string; sizeProfile: string; excludeLocationIds: string[] }
): Promise<Slot | null> {
  const exclude = input.excludeLocationIds.length
    ? Prisma.sql`AND l."id" NOT IN (${Prisma.join(input.excludeLocationIds)})`
    : Prisma.empty;
  const free = Prisma.sql`
    l."siteId" = ${input.siteId} AND l."holdsUnits" = true AND l."status" = 'ACTIVE' AND l."kind" = 'LEVEL'
    AND l."capacity" IS NOT NULL AND l."occupiedCount" + l."reservedCount" < l."capacity"
    AND l."sizeProfile" IN (${input.sizeProfile}, 'ANY') ${exclude}`;
  const reserve = async (candidate: Prisma.Sql, skipLocked: boolean) =>
    tx.$queryRaw<Slot[]>(Prisma.sql`
      UPDATE "WarehouseLocation" SET "reservedCount" = "reservedCount" + 1, "updatedAt" = now()
      WHERE "id" = (${candidate} FOR UPDATE OF l ${skipLocked ? Prisma.sql`SKIP LOCKED` : Prisma.empty})
        AND "status" = 'ACTIVE' AND "occupiedCount" + "reservedCount" < "capacity"
      RETURNING "id", "code", "shortCode"`);

  const sameItem = Prisma.sql`
    SELECT l."id" FROM "WarehouseLocation" l
    WHERE ${free} AND l."id" IN (
      SELECT u."currentLocationId" FROM "WarehouseUnit" u
      WHERE u."itemId" = ${input.itemId} AND u."presence" = 'PRESENT' AND u."currentSiteId" = ${input.siteId})
    ORDER BY l."walkSequence", l."code" LIMIT 1`;
  const anyLevel = Prisma.sql`
    SELECT l."id" FROM "WarehouseLocation" l WHERE ${free} ORDER BY l."walkSequence", l."code" LIMIT 1`;

  for (const [candidate, skipLocked] of [
    [sameItem, true],
    [anyLevel, true],
    // Every free level may be momentarily locked by the other station: wait for the first one instead of giving up.
    [anyLevel, false],
  ] as const) {
    const rows = await reserve(candidate, skipLocked);
    if (rows[0]) return rows[0];
  }
  return null;
}

async function reserveForTaskTx(
  tx: WarehouseTx,
  task: Pick<TaskRow, "id" | "siteId" | "unitId">,
  itemId: string,
  opts: { sizeProfile?: string; excludeLocationIds?: string[] }
): Promise<Slot | null> {
  const slot = await reserveSlotTx(tx, {
    siteId: task.siteId,
    itemId,
    sizeProfile: (opts.sizeProfile ?? "STANDARD").toUpperCase(),
    excludeLocationIds: opts.excludeLocationIds ?? [],
  });
  if (!slot) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehousePutawayTask" SET "holdReason" = 'NO_SLOT', "updatedAt" = now() WHERE "id" = ${task.id}`);
    return null;
  }
  await tx.$executeRaw(Prisma.sql`
    UPDATE "WarehousePutawayTask"
    SET "status" = 'RESERVED', "proposedLocationId" = ${slot.id}, "reservedAt" = now(),
        "reservationExpiresAt" = now() + make_interval(mins => ${reservationTtlMinutes()}::int), "holdReason" = NULL, "updatedAt" = now()
    WHERE "id" = ${task.id}`);
  return slot;
}

/** Put a RESERVED task back to PENDING and free its place. */
async function unreserveTaskTx(tx: WarehouseTx, task: Pick<TaskRow, "id" | "proposedLocationId" | "status">, holdReason: string): Promise<void> {
  if (task.status !== "RESERVED") return;
  await tx.$executeRaw(Prisma.sql`
    UPDATE "WarehousePutawayTask"
    SET "status" = 'PENDING', "proposedLocationId" = NULL, "reservedAt" = NULL, "reservationExpiresAt" = NULL,
        "holdReason" = ${holdReason}, "updatedAt" = now()
    WHERE "id" = ${task.id}`);
  if (task.proposedLocationId) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseLocation" SET "reservedCount" = GREATEST("reservedCount" - 1, 0), "updatedAt" = now()
      WHERE "id" = ${task.proposedLocationId}`);
  }
}

/**
 * Abandoned reservations give their place back; the task returns to PENDING and the pair stays
 * exactly where it was last confirmed (an expired reservation never makes a pair disappear).
 */
export async function expireReservations(db: WarehouseDb, siteId?: string): Promise<{ expired: number }> {
  return withTx(db, async (tx) => {
    const tasks = await tx.$queryRaw<{ id: string; proposedLocationId: string | null; status: "RESERVED" }[]>(Prisma.sql`
      SELECT "id", "proposedLocationId", "status" FROM "WarehousePutawayTask"
      WHERE "status" = 'RESERVED' AND "reservationExpiresAt" < now() ${siteId ? Prisma.sql`AND "siteId" = ${siteId}` : Prisma.empty}
      ORDER BY "id" LIMIT 500 FOR UPDATE SKIP LOCKED`);
    for (const t of tasks) await unreserveTaskTx(tx, t, "RESERVATION_EXPIRED");
    return { expired: tasks.length };
  });
}

export type PutawayTaskView = {
  taskId: string;
  status: "PENDING" | "RESERVED";
  holdReason: string | null;
  batchId: string | null;
  batchReference: string | null;
  fromLocationCode: string;
  fromLocationKind: LocationKind;
  proposedLocationId: string | null;
  proposedLocationCode: string | null;
  proposedLocationShortCode: string | null;
  proposedWalkSequence: number | null;
  reservationExpiresAt: string | null;
  createdAt: string;
  unit: Pick<UnitSummary, "id" | "labelCode" | "shortRef" | "itemName" | "itemBrand" | "itemSizeLabel" | "itemStyleCode" | "itemImageUrl" | "ownerKind" | "ownerName" | "qcState">;
};

export type PutawayScope = { siteId: string; batchId?: string | null; cartLocationId?: string | null; fromLocationId?: string | null };

function scopeSql(scope: PutawayScope): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`t."siteId" = ${scope.siteId}`, Prisma.sql`t."status" IN ('PENDING', 'RESERVED')`];
  if (scope.batchId) parts.push(Prisma.sql`t."batchId" = ${scope.batchId}`);
  if (scope.cartLocationId) parts.push(Prisma.sql`t."cartLocationId" = ${scope.cartLocationId}`);
  if (scope.fromLocationId) parts.push(Prisma.sql`t."fromLocationId" = ${scope.fromLocationId}`);
  return Prisma.join(parts, " AND ");
}

/**
 * Putaway queue for a site / batch / cart, grouped by destination in walk order (row → rack →
 * level); tasks still waiting for a proposal come last.
 */
export async function listPutawayQueue(
  conn: WarehouseConn,
  scope: PutawayScope & { limit?: number }
): Promise<{ tasks: PutawayTaskView[]; counts: { total: number; reserved: number; pending: number; blocked: number } }> {
  const limit = Math.min(500, Math.max(1, scope.limit ?? 200));
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`
    SELECT t."id" AS "taskId", t."status", t."holdReason", t."batchId", b."reference" AS "batchReference",
           fl."code" AS "fromLocationCode", fl."kind" AS "fromLocationKind",
           t."proposedLocationId", pl."code" AS "proposedLocationCode", pl."shortCode" AS "proposedLocationShortCode",
           pl."walkSequence" AS "proposedWalkSequence", t."reservationExpiresAt", t."createdAt",
           u."id", u."labelCode", i."name" AS "itemName", i."brand" AS "itemBrand", i."sizeLabel" AS "itemSizeLabel",
           i."styleCode" AS "itemStyleCode", i."imageUrl" AS "itemImageUrl", u."ownerKind", p."name" AS "ownerName", u."qcState"
    FROM "WarehousePutawayTask" t
    JOIN "WarehouseUnit" u ON u."id" = t."unitId"
    JOIN "WarehouseItem" i ON i."id" = u."itemId"
    JOIN "WarehouseLocation" fl ON fl."id" = t."fromLocationId"
    LEFT JOIN "WarehouseLocation" pl ON pl."id" = t."proposedLocationId"
    LEFT JOIN "WarehouseBatch" b ON b."id" = t."batchId"
    LEFT JOIN "Partner" p ON p."id" = u."ownerPartnerId"
    WHERE ${scopeSql(scope)}
    ORDER BY (t."proposedLocationId" IS NULL), pl."walkSequence", pl."code", t."createdAt", t."id"
    LIMIT ${limit}`);
  const counts = await conn.$queryRaw<{ total: number; reserved: number; pending: number; blocked: number }[]>(Prisma.sql`
    SELECT count(*)::int AS "total",
           count(*) FILTER (WHERE t."status" = 'RESERVED')::int AS "reserved",
           count(*) FILTER (WHERE t."status" = 'PENDING')::int AS "pending",
           count(*) FILTER (WHERE t."status" = 'PENDING' AND t."holdReason" IS NOT NULL)::int AS "blocked"
    FROM "WarehousePutawayTask" t WHERE ${scopeSql(scope)}`);
  return {
    tasks: rows.map((r) => ({
      taskId: r.taskId,
      status: r.status,
      holdReason: r.holdReason,
      batchId: r.batchId,
      batchReference: r.batchReference,
      fromLocationCode: r.fromLocationCode,
      fromLocationKind: r.fromLocationKind,
      proposedLocationId: r.proposedLocationId,
      proposedLocationCode: r.proposedLocationCode,
      proposedLocationShortCode: r.proposedLocationShortCode,
      proposedWalkSequence: r.proposedWalkSequence,
      reservationExpiresAt: r.reservationExpiresAt ? new Date(r.reservationExpiresAt).toISOString() : null,
      createdAt: new Date(r.createdAt).toISOString(),
      unit: {
        id: r.id,
        labelCode: r.labelCode,
        shortRef: `${r.id.slice(0, 4)}-${r.id.slice(4, 8)}`.toUpperCase(),
        itemName: r.itemName,
        itemBrand: r.itemBrand,
        itemSizeLabel: r.itemSizeLabel,
        itemStyleCode: r.itemStyleCode,
        itemImageUrl: r.itemImageUrl,
        ownerKind: r.ownerKind,
        ownerName: r.ownerName,
        qcState: r.qcState,
      },
    })),
    counts: counts[0],
  };
}

/**
 * "Lancer le rangement": propose (reserve) a destination for the pending tasks of the scope.
 * Safe to call again — already reserved tasks are untouched, expired ones are refreshed.
 * Each task is reserved in its own short transaction (no long lock across the whole cart).
 */
export async function proposeDestinations(
  db: WarehouseDb,
  input: PutawayScope & { unitIds?: string[]; sizeProfile?: string; limit?: number },
  _ctx: ActorContext
): Promise<{ reserved: number; noSlot: number; remainingPending: number }> {
  assertWritesEnabled();
  await expireReservations(db, input.siteId);
  const limit = Math.min(500, Math.max(1, input.limit ?? 200));
  const pending = await db.$queryRaw<{ id: string; unitId: string }[]>(Prisma.sql`
    SELECT t."id", t."unitId" FROM "WarehousePutawayTask" t
    WHERE ${scopeSql(input)} AND t."status" = 'PENDING'
      ${input.unitIds?.length ? Prisma.sql`AND t."unitId" IN (${Prisma.join(input.unitIds)})` : Prisma.empty}
    ORDER BY t."createdAt", t."id" LIMIT ${limit}`);
  let reserved = 0;
  let noSlot = 0;
  for (const p of pending) {
    const slot = await withTx(db, async (tx) => {
      const unit = await lockUnitTx(tx, p.unitId);
      const task = await getActiveTaskTx(tx, p.unitId);
      if (!task || task.id !== p.id || task.status !== "PENDING") return "SKIP" as const;
      if (unit.presence !== "PRESENT" || unit.qcState === "QUARANTINE") return "SKIP" as const;
      return reserveForTaskTx(tx, task, unit.itemId, { sizeProfile: input.sizeProfile ?? unit.boxProfile });
    });
    if (slot === "SKIP") continue;
    if (slot) reserved += 1;
    else {
      noSlot += 1;
      // No compatible free level anywhere on the site: no point trying the rest of the queue.
      break;
    }
  }
  const remaining = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT count(*)::int AS n FROM "WarehousePutawayTask" t WHERE ${scopeSql(input)} AND t."status" = 'PENDING'`);
  return { reserved, noSlot, remainingPending: remaining[0].n };
}

type LocRow = { id: string; siteId: string; code: string; shortCode: string; kind: LocationKind; holdsUnits: boolean; status: string; sizeProfile: string };

async function getLocTx(tx: WarehouseTx, locationId: string): Promise<LocRow> {
  const rows = await tx.$queryRaw<LocRow[]>(Prisma.sql`
    SELECT "id", "siteId", "code", "shortCode", "kind", "holdsUnits", "status", "sizeProfile" FROM "WarehouseLocation" WHERE "id" = ${locationId}`);
  if (!rows[0]) throw notFound("Emplacement", { locationId });
  return rows[0];
}

/**
 * A37 — a level takes the box formats of its profile (ANY takes all). Putting a big carton on a
 * small-box level is not forbidden (the shelf is what it is) but it is never silent: explicit
 * confirmation, recorded on the movement.
 */
const BOX_PROFILE_FR: Record<string, string> = { STANDARD: "standard", LARGE: "grande boîte" };

function assertBoxFits(unit: UnitRow, loc: LocRow, accepted: boolean | undefined): boolean {
  if (loc.kind !== "LEVEL" || loc.sizeProfile === "ANY" || loc.sizeProfile === unit.boxProfile) return false;
  if (!accepted) {
    throw conflict(
      "SIZE_PROFILE_MISMATCH",
      `${loc.shortCode} est prévu pour le format « ${BOX_PROFILE_FR[loc.sizeProfile] ?? loc.sizeProfile} », cette boîte est au format « ${BOX_PROFILE_FR[unit.boxProfile] ?? unit.boxProfile} ». Confirmer pour la ranger ici quand même.`,
      { confirm: "acceptProfileMismatch", levelProfile: loc.sizeProfile, boxProfile: unit.boxProfile, locationCode: loc.code }
    );
  }
  return true;
}

export type ConfirmPutawayResult = {
  result: "MOVED" | "ALREADY_THERE";
  unit: UnitSummary;
  locationCode: string;
  /** True when the pair was planned elsewhere and the operator confirmed the deviation. */
  deviated: boolean;
  remainingInScope: number;
};

/**
 * The operator stands at a level (already scanned) and scans a pair placed there.
 *
 *  - pair already recorded at this level → ALREADY_THERE, no movement (scanning twice is harmless);
 *  - pair reserved for this level → reservation becomes occupation;
 *  - pair reserved for ANOTHER level → DESTINATION_MISMATCH unless `acceptMismatch` (the old
 *    place is released, the real level is checked for capacity);
 *  - level full or blocked → LEVEL_FULL / LOCATION_NOT_USABLE: nothing moves, the pair stays at
 *    its last real position and the task can be reassigned.
 */
export async function confirmPutaway(
  db: WarehouseDb,
  input: { opKey: string; unitId: string; locationId: string; acceptMismatch?: boolean; acceptProfileMismatch?: boolean; expectedVersion?: number | null; note?: string | null },
  ctx: ActorContext
): Promise<OperationResult<ConfirmPutawayResult>> {
  return runOperation(db, { opKey: input.opKey, kind: "PUTAWAY_CONFIRM", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    assertExpectedVersion(unit, input.expectedVersion);
    const loc = await getLocTx(tx, input.locationId);
    const task = await getActiveTaskTx(tx, unit.id);
    const remaining = async () => {
      const r = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT count(*)::int AS n FROM "WarehousePutawayTask"
        WHERE "siteId" = ${loc.siteId} AND "status" IN ('PENDING', 'RESERVED')
          ${task?.batchId ? Prisma.sql`AND "batchId" = ${task.batchId}` : Prisma.empty}`);
      return r[0].n;
    };

    if (unit.presence === "PRESENT" && unit.currentLocationId === loc.id) {
      return { result: "ALREADY_THERE" as const, unit: await getUnitSummary(tx, unit.id), locationCode: loc.code, deviated: false, remainingInScope: await remaining() };
    }
    if (unit.presence !== "PRESENT") {
      throw conflict("UNIT_NOT_PRESENT", presenceMessage(unit), { presence: unit.presence });
    }
    if (unit.currentSiteId !== loc.siteId) {
      throw conflict("SITE_MISMATCH", "Cette paire est enregistrée sur un autre site : passer par un transfert entre sites.", {
        unitSiteId: unit.currentSiteId,
      });
    }
    if (loc.kind !== "LEVEL") {
      throw conflict("WRONG_CODE_TYPE", `${loc.code} n'est pas un niveau de rayonnage. Pour un chariot ou une zone, utiliser « Déplacer ».`);
    }
    if (unit.qcState === "QUARANTINE") {
      throw conflict("UNIT_STATE_CONFLICT", "Paire en quarantaine : elle ne se range pas en rayon avant décision.");
    }
    const profileMismatch = assertBoxFits(unit, loc, input.acceptProfileMismatch);

    let consume = false;
    let deviated = false;
    if (task?.status === "RESERVED" && task.proposedLocationId === loc.id) {
      consume = true;
    } else if (task?.status === "RESERVED" && task.proposedLocationId) {
      if (!input.acceptMismatch) {
        const planned = await getLocTx(tx, task.proposedLocationId);
        throw conflict(
          "DESTINATION_MISMATCH",
          `Cette paire est prévue en ${planned.shortCode} (${planned.code}). Confirmer l'écart pour la ranger en ${loc.shortCode}.`,
          { plannedLocationId: planned.id, plannedCode: planned.code, plannedShortCode: planned.shortCode, scannedCode: loc.code }
        );
      }
      await unreserveTaskTx(tx, task, "DEVIATED");
      deviated = true;
    }

    await moveOccupancyTx(tx, { fromId: unit.currentLocationId, toId: loc.id, consumeReservation: consume });
    if (task) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "WarehousePutawayTask"
        SET "status" = 'DONE', "confirmedLocationId" = ${loc.id}, "confirmedAt" = now(), "operatorId" = ${ctx.operatorId ?? null},
            "holdReason" = NULL, "updatedAt" = now()
        WHERE "id" = ${task.id}`);
    }
    await applyUnitChangeTx(
      tx,
      unit,
      { currentLocationId: loc.id, currentSiteId: loc.siteId },
      {
        type: "PUTAWAY",
        taskId: task?.id ?? null,
        batchId: task?.batchId ?? null,
        note: input.note,
        changes:
          deviated || profileMismatch
            ? { ...(deviated ? { deviatedFrom: task?.proposedLocationId } : {}), ...(profileMismatch ? { profileMismatch: { level: loc.sizeProfile, box: unit.boxProfile } } : {}) }
            : null,
      },
      ctx,
      input.opKey
    );
    return { result: "MOVED" as const, unit: await getUnitSummary(tx, unit.id), locationCode: loc.code, deviated, remainingInScope: await remaining() };
  });
}

function presenceMessage(unit: UnitRow): string {
  switch (unit.presence) {
    case "IN_TRANSIT":
      return "Paire en transit entre sites : la réceptionner sur le transfert avant de la ranger.";
    case "MISSING":
      return "Paire déclarée introuvable : utiliser « Paire retrouvée » pour la remettre à une adresse.";
    case "OUT":
      return "Paire sortie du stock : une rentrée passe par un retour ou une entrée validée, pas par un rangement.";
    default:
      return "Paire détenue par un tiers : confirmer son retour avant de la ranger.";
  }
}

export type RelocateResult = { result: "MOVED" | "ALREADY_THERE"; unit: UnitSummary; taskId: string | null; overCapacity: boolean };

/**
 * Explicit move of a known pair to any position (cart, receiving, level, quarantine, returns,
 * packing) — also the "pair found again" gesture for a MISSING pair.
 *
 *  - to a cart / receiving zone: the putaway task follows the pair (start point updated);
 *  - to a level by hand: the pending task is cancelled and its reserved place released (A34);
 *  - to quarantine: control state → QUARANTINE, sale blocked;
 *  - leaving a level, or `force` (record reality on a full / blocked position), needs a reason.
 */
export async function relocateUnit(
  db: WarehouseDb,
  input: { opKey: string; unitId: string; toLocationId: string; reason?: string | null; force?: boolean; acceptProfileMismatch?: boolean; expectedVersion?: number | null; note?: string | null },
  ctx: ActorContext
): Promise<OperationResult<RelocateResult>> {
  return runOperation(db, { opKey: input.opKey, kind: "UNIT_RELOCATE", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    assertExpectedVersion(unit, input.expectedVersion);
    const loc = await getLocTx(tx, input.toLocationId);
    if (unit.presence === "PRESENT" && unit.currentLocationId === loc.id) {
      return { result: "ALREADY_THERE" as const, unit: await getUnitSummary(tx, unit.id), taskId: null, overCapacity: false };
    }
    const found = unit.presence === "MISSING";
    if (unit.presence !== "PRESENT" && !found) throw conflict("UNIT_NOT_PRESENT", presenceMessage(unit), { presence: unit.presence });
    if (unit.currentSiteId && unit.currentSiteId !== loc.siteId) {
      throw conflict("SITE_MISMATCH", "Changement de site : passer par un transfert entre sites.");
    }
    if (!loc.holdsUnits) throw conflict("LOCATION_NOT_USABLE", `${loc.code} est un repère de structure, pas un emplacement de paires.`);

    const fromKind = unit.currentLocationId ? (await getLocTx(tx, unit.currentLocationId)).kind : null;
    const reason = String(input.reason ?? "").trim();
    if ((fromKind === "LEVEL" || input.force || found) && reason.length < 3) {
      throw invalid(found ? "Motif requis : où et comment la paire a été retrouvée." : "Motif requis pour sortir une paire de son niveau ou forcer une position.");
    }
    if (input.force && ctx.role !== "admin" && ctx.role !== "system") {
      throw new WarehouseError("FORBIDDEN", "Forcer une position pleine ou bloquée est réservé au gestionnaire.", 403);
    }
    const profileMismatch = assertBoxFits(unit, loc, input.acceptProfileMismatch);

    const temporary = loc.kind === "RECEIVING" || loc.kind === "CART";
    let taskId: string | null = null;
    if (!temporary) await releaseActiveTaskTx(tx, unit.id, loc.kind === "LEVEL" ? "MANUAL_MOVE" : `MOVED_TO_${loc.kind}`);

    const { overCapacity } = await moveOccupancyTx(tx, { fromId: unit.currentLocationId, toId: loc.id, force: Boolean(input.force) });
    const quarantine = loc.kind === "QUARANTINE";
    await applyUnitChangeTx(
      tx,
      unit,
      {
        presence: "PRESENT",
        currentLocationId: loc.id,
        currentSiteId: loc.siteId,
        ...(quarantine ? { qcState: "QUARANTINE" as const, saleState: "BLOCKED" as const } : {}),
      },
      {
        type: found ? "FOUND" : "RELOCATE",
        reason: reason || null,
        note: input.note,
        changes:
          input.force || profileMismatch
            ? { ...(input.force ? { forced: true, overCapacity } : {}), ...(profileMismatch ? { profileMismatch: { level: loc.sizeProfile, box: unit.boxProfile } } : {}) }
            : null,
      },
      ctx,
      input.opKey
    );
    if (temporary && !quarantine && unit.qcState !== "QUARANTINE") {
      taskId = await ensurePutawayTaskTx(tx, { unitId: unit.id, siteId: loc.siteId, batchId: unit.originBatchId, fromLocationId: loc.id, fromKind: loc.kind }, ctx);
    }
    if (overCapacity) {
      await openExceptionTx(tx, { siteId: loc.siteId, type: "CAPACITY_MISMATCH", unitId: unit.id, locationId: loc.id, details: { forced: true }, opKey: `${input.opKey}:cap` }, ctx);
    }
    return { result: "MOVED" as const, unit: await getUnitSummary(tx, unit.id), taskId, overCapacity };
  });
}

/**
 * Release the proposed place of a pair and propose the next usable level (the previous one is
 * excluded). The pair itself does not move.
 */
export async function reassignPutaway(
  db: WarehouseDb,
  input: { opKey: string; unitId: string; reason: string; sizeProfile?: string },
  ctx: ActorContext
): Promise<OperationResult<{ unitId: string; proposedLocationCode: string | null; proposedLocationShortCode: string | null; noSlot: boolean }>> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3) throw invalid("Motif requis pour réaffecter une place.");
  return runOperation(db, { opKey: input.opKey, kind: "PUTAWAY_REASSIGN", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    const task = await getActiveTaskTx(tx, unit.id);
    if (!task) throw conflict("UNIT_STATE_CONFLICT", "Aucune tâche de rangement active pour cette paire.");
    const previous = task.proposedLocationId;
    await unreserveTaskTx(tx, task, reason.slice(0, 120));
    const slot = await reserveForTaskTx(tx, task, unit.itemId, { sizeProfile: input.sizeProfile ?? unit.boxProfile, excludeLocationIds: previous ? [previous] : [] });
    return { unitId: unit.id, proposedLocationCode: slot?.code ?? null, proposedLocationShortCode: slot?.shortCode ?? null, noSlot: !slot };
  });
}

/** Cancel the putaway of a pair (it stays at its last confirmed position, no place reserved). */
export async function cancelPutawayTask(
  db: WarehouseDb,
  input: { opKey: string; unitId: string; reason: string },
  ctx: ActorContext
): Promise<OperationResult<{ unitId: string; cancelledTaskId: string | null }>> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3) throw invalid("Motif requis pour annuler un rangement.");
  return runOperation(db, { opKey: input.opKey, kind: "PUTAWAY_CANCEL", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    return { unitId: unit.id, cancelledTaskId: await releaseActiveTaskTx(tx, unit.id, reason.slice(0, 200)) };
  });
}

/**
 * "Emplacement plein" raised at the shelf (A36): the level is blocked for new assignments, the
 * places reserved on it are released (their tasks go back to PENDING and get re-proposed), and
 * a discrepancy is opened so capacity is reviewed. Pairs already there are not touched.
 */
export async function reportLevelFull(
  db: WarehouseDb,
  input: { opKey: string; locationId: string; note?: string | null },
  ctx: ActorContext
): Promise<OperationResult<{ locationCode: string; releasedReservations: number; exceptionId: string }>> {
  return runOperation(db, { opKey: input.opKey, kind: "LEVEL_FULL", request: input, ctx }, async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; siteId: string; code: string; kind: string; status: string; capacity: number | null; occupiedCount: number; reservedCount: number }[]>(
      Prisma.sql`SELECT "id", "siteId", "code", "kind", "status", "capacity", "occupiedCount", "reservedCount" FROM "WarehouseLocation" WHERE "id" = ${input.locationId} FOR UPDATE`
    );
    const loc = rows[0];
    if (!loc) throw notFound("Emplacement");
    if (loc.kind !== "LEVEL") throw conflict("WRONG_CODE_TYPE", "Seul un niveau de rayonnage peut être signalé plein.");
    const released = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE "WarehousePutawayTask"
      SET "status" = 'PENDING', "proposedLocationId" = NULL, "reservedAt" = NULL, "reservationExpiresAt" = NULL,
          "holdReason" = 'LEVEL_FULL', "updatedAt" = now()
      WHERE "proposedLocationId" = ${loc.id} AND "status" = 'RESERVED' RETURNING "id"`);
    if (loc.status === "ACTIVE") {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "WarehouseLocation" SET "status" = 'BLOCKED', "statusReason" = 'Signalé plein sur place', "reservedCount" = 0, "updatedAt" = now()
        WHERE "id" = ${loc.id}`);
    } else {
      await tx.$executeRaw(Prisma.sql`UPDATE "WarehouseLocation" SET "reservedCount" = 0, "updatedAt" = now() WHERE "id" = ${loc.id}`);
    }
    const exceptionId = await openExceptionTx(
      tx,
      {
        siteId: loc.siteId,
        type: "LEVEL_FULL",
        locationId: loc.id,
        details: { capacity: loc.capacity, occupiedCount: loc.occupiedCount, reservedCount: loc.reservedCount, note: input.note ?? null, releasedTasks: released.length },
        opKey: `${input.opKey}:exc`,
      },
      ctx
    );
    return { locationCode: loc.code, releasedReservations: released.length, exceptionId };
  });
}
