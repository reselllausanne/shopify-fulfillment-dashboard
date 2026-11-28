import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { normalizeGtin } from "./codes";
import { withTx, type WarehouseConn, type WarehouseDb, type WarehouseTx } from "./db";
import { WarehouseError, conflict, invalid, isUniqueViolation, notFound } from "./errors";
import { openExceptionTx } from "./exceptions";
import { assertSiteInPilot, assertWritesEnabled, runOperation, type OperationResult } from "./operations";
import { buildPairLabelPayload, enqueuePrintJobTx, type PrintOutcome } from "./printing";
import { ensurePutawayTaskTx } from "./putaway";
import type {
  ActorContext,
  BatchFlow,
  BatchKind,
  BatchStatus,
  BoxCondition,
  LocationKind,
  OwnerKind,
  UnitCondition,
  UnitOrigin,
  UnitSummary,
} from "./types";
import {
  applyUnitChangeTx,
  createUnitTx,
  getUnitSummary,
  lockUnitTx,
  moveOccupancyTx,
  releaseActiveTaskTx,
} from "./units";

/**
 * Batches: a stock-take ("reprise" of pairs already on the shelves, with a counting date) or a
 * receiving (new boxes at the table → cart → putaway). Units are born from an observed box —
 * never generated from a theoretical quantity.
 */

const FLOW_ORIGIN: Record<BatchFlow, UnitOrigin> = {
  CONSIGNMENT: "CONSIGNMENT",
  OWN_STOCK: "OWN_STOCK",
  SUPPLIER: "SUPPLIER",
  ORDER_TRANSIT: "ORDER_TRANSIT",
  CUSTOMER_RETURN: "CUSTOMER_RETURN",
};

export type BatchRow = {
  id: string;
  siteId: string;
  siteCode: string;
  reference: string;
  kind: BatchKind;
  flow: BatchFlow;
  title: string | null;
  ownerKind: OwnerKind;
  ownerPartnerId: string | null;
  ownerName: string | null;
  agreementId: string | null;
  supplierName: string | null;
  sourceDocType: string | null;
  sourceDocRef: string | null;
  receivingLocationId: string | null;
  receivingLocationCode: string | null;
  activeLocationId: string | null;
  activeLocationCode: string | null;
  status: BatchStatus;
  countedAt: string | null;
  expectedKnown: boolean;
  notes: string | null;
  closedAt: string | null;
  closeSummary: unknown;
  createdAt: string;
  unitCount: number;
  toPutAwayCount: number;
  openExceptionCount: number;
};

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

const BATCH_SELECT = Prisma.sql`
  SELECT b."id", b."siteId", s."code" AS "siteCode", b."reference", b."kind", b."flow", b."title", b."ownerKind", b."ownerPartnerId",
         p."name" AS "ownerName", b."agreementId", b."supplierName", b."sourceDocType", b."sourceDocRef",
         b."receivingLocationId", rl."code" AS "receivingLocationCode", b."activeLocationId", al."code" AS "activeLocationCode",
         b."status", b."countedAt", b."expectedKnown", b."notes", b."closedAt", b."closeSummary", b."createdAt",
         (SELECT count(*)::int FROM "WarehouseUnit" u WHERE u."originBatchId" = b."id") AS "unitCount",
         (SELECT count(*)::int FROM "WarehousePutawayTask" t WHERE t."batchId" = b."id" AND t."status" IN ('PENDING', 'RESERVED')) AS "toPutAwayCount",
         (SELECT count(*)::int FROM "WarehouseException" e WHERE e."batchId" = b."id" AND e."status" = 'OPEN') AS "openExceptionCount"
  FROM "WarehouseBatch" b
  JOIN "WarehouseSite" s ON s."id" = b."siteId"
  LEFT JOIN "Partner" p ON p."id" = b."ownerPartnerId"
  LEFT JOIN "WarehouseLocation" rl ON rl."id" = b."receivingLocationId"
  LEFT JOIN "WarehouseLocation" al ON al."id" = b."activeLocationId"`;

const toBatch = (b: any): BatchRow => ({ ...b, countedAt: iso(b.countedAt), closedAt: iso(b.closedAt), createdAt: iso(b.createdAt) });

export async function getBatch(conn: WarehouseConn, batchId: string): Promise<BatchRow> {
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`${BATCH_SELECT} WHERE b."id" = ${batchId}`);
  if (!rows[0]) throw notFound("Lot", { batchId });
  return toBatch(rows[0]);
}

export async function listBatches(
  conn: WarehouseConn,
  input: { siteId?: string; status?: BatchStatus | BatchStatus[]; kind?: BatchKind; ownerPartnerId?: string; limit?: number }
): Promise<BatchRow[]> {
  const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (input.siteId) where.push(Prisma.sql`b."siteId" = ${input.siteId}`);
  if (input.kind) where.push(Prisma.sql`b."kind" = ${input.kind}`);
  if (input.ownerPartnerId) where.push(Prisma.sql`b."ownerPartnerId" = ${input.ownerPartnerId}`);
  if (input.status) {
    const list = Array.isArray(input.status) ? input.status : [input.status];
    if (list.length) where.push(Prisma.sql`b."status" IN (${Prisma.join(list)})`);
  }
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`
    ${BATCH_SELECT} WHERE ${Prisma.join(where, " AND ")} ORDER BY b."createdAt" DESC LIMIT ${Math.min(200, Math.max(1, input.limit ?? 50))}`);
  return rows.map(toBatch);
}

export type CreateBatchInput = {
  siteId: string;
  kind: BatchKind;
  flow: BatchFlow;
  title?: string | null;
  ownerKind: OwnerKind;
  ownerPartnerId?: string | null;
  supplierName?: string | null;
  sourceDocType?: string | null;
  sourceDocRef?: string | null;
  /** Temporary position where received boxes wait (receiving zone or cart). Required for RECEIVING. */
  receivingLocationId?: string | null;
  /** Counting date of a stock-take. */
  countedAt?: string | Date | null;
  notes?: string | null;
};

export async function createBatch(db: WarehouseDb, input: CreateBatchInput, ctx: ActorContext): Promise<BatchRow> {
  assertWritesEnabled();
  if (!["STOCK_TAKE", "RECEIVING"].includes(input.kind)) throw invalid("Type de lot : reprise (STOCK_TAKE) ou réception (RECEIVING).");
  if (!(input.flow in FLOW_ORIGIN)) throw invalid("Flux d'entrée invalide.");
  if (input.flow === "ORDER_TRANSIT" || input.flow === "CUSTOMER_RETURN") {
    // Explicit, not a silent success: these entries need the order / return link delivered in lots 2–3.
    throw new WarehouseError(
      "INVALID_INPUT",
      "Les arrivages liés à une commande et les retours client se branchent aux lots 2 et 3 (lien commande / dossier de retour). Utiliser Dépôt, Stock propre ou Fournisseur.",
      400
    );
  }
  if (!["OWN", "PARTNER", "UNKNOWN"].includes(input.ownerKind)) throw invalid("Propriétaire invalide.");
  if (input.ownerKind === "PARTNER" && !input.ownerPartnerId) throw invalid("Choisir le déposant.");
  if (input.flow === "CONSIGNMENT" && input.ownerKind !== "PARTNER") throw invalid("Un dépôt appartient à un déposant : choisir le partenaire.");
  if (input.flow === "OWN_STOCK" && input.ownerKind !== "OWN") throw invalid("Stock propre : le propriétaire est Resell Lausanne.");
  if (input.kind === "STOCK_TAKE" && input.ownerKind === "UNKNOWN") {
    throw invalid("Reprise : choisir le propriétaire du lot. Une boîte au propriétaire incertain se signale boîte par boîte.");
  }
  const ownerPartnerId = input.ownerKind === "PARTNER" ? (input.ownerPartnerId as string) : null;
  const countedAt = input.countedAt ? new Date(input.countedAt) : input.kind === "STOCK_TAKE" ? new Date() : null;
  if (countedAt && Number.isNaN(countedAt.getTime())) throw invalid("Date de comptage invalide.");

  return withTx(db, async (tx) => {
    const site = await tx.$queryRaw<{ id: string; code: string; status: string }[]>(Prisma.sql`
      SELECT "id", "code", "status" FROM "WarehouseSite" WHERE "id" = ${input.siteId}`);
    if (!site[0]) throw notFound("Site");
    assertSiteInPilot(site[0].code);
    if (site[0].status !== "ACTIVE") throw conflict("LOCATION_NOT_USABLE", "Site retiré : aucune nouvelle opération.");
    let agreementId: string | null = null;
    if (ownerPartnerId) {
      const partner = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Partner" WHERE "id" = ${ownerPartnerId}`);
      if (!partner[0]) throw notFound("Partenaire");
      const agreement = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "WarehouseDepositAgreement" WHERE "partnerId" = ${ownerPartnerId} AND "status" = 'ACTIVE' LIMIT 1`);
      agreementId = agreement[0]?.id ?? null;
    }
    let receivingLocationId: string | null = null;
    if (input.kind === "RECEIVING") {
      if (!input.receivingLocationId) throw invalid("Choisir la zone de réception ou le chariot où attendent les boîtes.");
      const loc = await tx.$queryRaw<{ id: string; siteId: string; kind: string; status: string; code: string }[]>(Prisma.sql`
        SELECT "id", "siteId", "kind", "status", "code" FROM "WarehouseLocation" WHERE "id" = ${input.receivingLocationId}`);
      if (!loc[0]) throw notFound("Emplacement");
      if (loc[0].siteId !== site[0].id) throw conflict("SITE_MISMATCH", "La zone de réception appartient à un autre site.");
      if (!["RECEIVING", "CART"].includes(loc[0].kind) || loc[0].status !== "ACTIVE") {
        throw conflict("LOCATION_NOT_USABLE", `${loc[0].code} n'est pas une zone de réception ou un chariot actif.`);
      }
      receivingLocationId = loc[0].id;
    }
    const prefix = `${input.kind === "STOCK_TAKE" ? "REP" : "REC"}-${site[0].code}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const n = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT count(*)::int AS n FROM "WarehouseBatch" WHERE "reference" LIKE ${`${prefix}-%`}`);
      const reference = `${prefix}-${String(n[0].n + 1 + attempt).padStart(3, "0")}`;
      const id = randomUUID();
      const inserted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO "WarehouseBatch"
          ("id", "siteId", "reference", "kind", "flow", "title", "ownerKind", "ownerPartnerId", "agreementId", "supplierName",
           "sourceDocType", "sourceDocRef", "receivingLocationId", "countedAt", "notes", "createdByOperatorId")
        VALUES
          (${id}, ${site[0].id}, ${reference}, ${input.kind}, ${input.flow}, ${input.title?.trim() || null}, ${input.ownerKind},
           ${ownerPartnerId}, ${agreementId}, ${input.supplierName?.trim() || null}, ${input.sourceDocType?.trim() || null},
           ${input.sourceDocRef?.trim() || null}, ${receivingLocationId}, ${countedAt}, ${input.notes?.trim() || null}, ${ctx.operatorId ?? null})
        ON CONFLICT ("reference") DO NOTHING RETURNING "id"`);
      if (inserted[0]) return getBatch(tx, id);
    }
    throw conflict("CONFLICT", "Référence de lot déjà prise : réessayer.");
  });
}

export type BatchLineRow = {
  id: string;
  lineNo: number;
  itemId: string | null;
  itemName: string | null;
  gtin: string | null;
  description: string | null;
  sizeLabel: string | null;
  expectedQty: number | null;
  receivedQty: number;
  externalRef: string | null;
  status: string;
  closeReason: string | null;
};

export async function listBatchLines(conn: WarehouseConn, batchId: string): Promise<BatchLineRow[]> {
  return conn.$queryRaw<BatchLineRow[]>(Prisma.sql`
    SELECT l."id", l."lineNo", l."itemId", i."name" AS "itemName", l."gtin", l."description", l."sizeLabel", l."expectedQty",
           l."receivedQty", l."externalRef", l."status", l."closeReason"
    FROM "WarehouseBatchLine" l LEFT JOIN "WarehouseItem" i ON i."id" = l."itemId"
    WHERE l."batchId" = ${batchId} ORDER BY l."lineNo"`);
}

export type ExpectedLineInput = {
  gtin?: string | null;
  itemId?: string | null;
  description?: string | null;
  sizeLabel?: string | null;
  expectedQty?: number | null;
  externalRef?: string | null;
  importRowId?: string | null;
};

/** Add expected lines (depositor slip, supplier document). GTIN kept as text; quantities may stay unknown. */
export async function addBatchLinesTx(tx: WarehouseTx, batchId: string, lines: ExpectedLineInput[]): Promise<string[]> {
  const batch = await tx.$queryRaw<{ id: string; status: string }[]>(Prisma.sql`
    SELECT "id", "status" FROM "WarehouseBatch" WHERE "id" = ${batchId} FOR UPDATE`);
  if (!batch[0]) throw notFound("Lot");
  if (batch[0].status === "CLOSED" || batch[0].status === "CANCELLED") throw conflict("BATCH_NOT_OPEN", "Lot clos : plus de ligne attendue.");
  const max = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT coalesce(max("lineNo"), 0)::int AS n FROM "WarehouseBatchLine" WHERE "batchId" = ${batchId}`);
  let lineNo = max[0].n;
  const ids: string[] = [];
  for (const line of lines) {
    const gtin = line.gtin ? normalizeGtin(String(line.gtin)) : null;
    if (line.gtin && !gtin) throw invalid(`GTIN invalide (8 à 14 chiffres, lu comme texte) : ${String(line.gtin).slice(0, 40)}`);
    if (line.expectedQty !== undefined && line.expectedQty !== null && (!Number.isInteger(line.expectedQty) || line.expectedQty < 0 || line.expectedQty > 100_000)) {
      throw invalid("Quantité attendue : entier positif.");
    }
    if (!gtin && !line.itemId && !line.description?.trim()) throw invalid("Une ligne attendue a besoin d'un GTIN, d'un article ou d'une description.");
    lineNo += 1;
    const id = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WarehouseBatchLine" ("id", "batchId", "lineNo", "itemId", "gtin", "description", "sizeLabel", "expectedQty", "externalRef", "importRowId")
      VALUES (${id}, ${batchId}, ${lineNo}, ${line.itemId ?? null}, ${gtin}, ${line.description?.trim().slice(0, 300) || null},
              ${line.sizeLabel?.trim().slice(0, 40) || null}, ${line.expectedQty ?? null}, ${line.externalRef?.trim().slice(0, 120) || null}, ${line.importRowId ?? null})`);
    ids.push(id);
  }
  if (ids.length) {
    await tx.$executeRaw(Prisma.sql`UPDATE "WarehouseBatch" SET "expectedKnown" = true, "updatedAt" = now() WHERE "id" = ${batchId}`);
  }
  return ids;
}

export async function addBatchLines(db: WarehouseDb, batchId: string, lines: ExpectedLineInput[]): Promise<BatchLineRow[]> {
  assertWritesEnabled();
  if (!Array.isArray(lines) || lines.length === 0) throw invalid("Aucune ligne.");
  if (lines.length > 2000) throw invalid("2000 lignes au maximum par ajout.");
  await withTx(db, (tx) => addBatchLinesTx(tx, batchId, lines));
  return listBatchLines(db, batchId);
}

/** Pause / resume / cancel. A paused batch keeps everything; scanning is refused until resumed. */
export async function setBatchStatus(db: WarehouseDb, input: { batchId: string; action: "PAUSE" | "RESUME" | "CANCEL" }): Promise<BatchRow> {
  assertWritesEnabled();
  await withTx(db, async (tx) => {
    const rows = await tx.$queryRaw<{ status: BatchStatus }[]>(Prisma.sql`SELECT "status" FROM "WarehouseBatch" WHERE "id" = ${input.batchId} FOR UPDATE`);
    if (!rows[0]) throw notFound("Lot");
    const status = rows[0].status;
    let next: BatchStatus;
    if (input.action === "PAUSE") {
      if (status === "PAUSED") return;
      if (status !== "OPEN") throw conflict("BATCH_NOT_OPEN", `Lot ${status} : pause impossible.`);
      next = "PAUSED";
    } else if (input.action === "RESUME") {
      if (status === "OPEN") return;
      if (status !== "PAUSED") throw conflict("BATCH_NOT_OPEN", `Lot ${status} : reprise impossible.`);
      next = "OPEN";
    } else if (input.action === "CANCEL") {
      if (status === "CANCELLED") return;
      const units = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM "WarehouseUnit" WHERE "originBatchId" = ${input.batchId}`);
      if (units[0].n > 0) throw conflict("CONFLICT", "Ce lot a déjà des paires identifiées : il se clôture, il ne s'annule pas.");
      if (status === "CLOSED") throw conflict("BATCH_NOT_OPEN", "Lot déjà clos.");
      next = "CANCELLED";
    } else throw invalid("Action inconnue.");
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseBatch" SET "status" = ${next}, "updatedAt" = now(),
        "closedAt" = CASE WHEN ${next} = 'CANCELLED' THEN now() ELSE "closedAt" END
      WHERE "id" = ${input.batchId}`);
  });
  return getBatch(db, input.batchId);
}

type OpenBatch = {
  id: string;
  siteId: string;
  siteCode: string;
  kind: BatchKind;
  flow: BatchFlow;
  status: BatchStatus;
  ownerKind: OwnerKind;
  ownerPartnerId: string | null;
  agreementId: string | null;
  receivingLocationId: string | null;
  expectedKnown: boolean;
};

async function requireOpenBatchTx(tx: WarehouseTx, batchId: string, kind: BatchKind): Promise<OpenBatch> {
  // FOR SHARE: scans of the same batch run in parallel, but never across a close.
  const rows = await tx.$queryRaw<OpenBatch[]>(Prisma.sql`
    SELECT b."id", b."siteId", s."code" AS "siteCode", b."kind", b."flow", b."status", b."ownerKind", b."ownerPartnerId",
           b."agreementId", b."receivingLocationId", b."expectedKnown"
    FROM "WarehouseBatch" b JOIN "WarehouseSite" s ON s."id" = b."siteId" WHERE b."id" = ${batchId} FOR SHARE OF b`);
  const b = rows[0];
  if (!b) throw notFound("Lot", { batchId });
  if (b.kind !== kind) {
    throw conflict("BATCH_NOT_OPEN", kind === "RECEIVING" ? "Ce lot est une reprise : scanner d'abord le niveau." : "Ce lot est une réception, pas une reprise.");
  }
  if (b.status !== "OPEN") {
    throw conflict("BATCH_NOT_OPEN", b.status === "PAUSED" ? "Lot en pause : le reprendre avant de scanner." : "Lot clos : aucune nouvelle boîte.", { status: b.status });
  }
  return b;
}

// ───────────────────────────── Receiving ─────────────────────────────

export type ReceiveUnitInput = {
  opKey: string;
  batchId: string;
  itemId: string;
  /** Expected line confirmed by the operator (otherwise matched on the variant). */
  lineId?: string | null;
  /** Override of the batch's temporary position (another cart). */
  locationId?: string | null;
  condition?: UnitCondition;
  boxCondition?: BoxCondition;
  conditionNote?: string | null;
  /** Doubt on the content / state: the pair is created in quarantine state and gets no putaway task. */
  hold?: boolean;
  /** Ask for the pair label on the active station (default true). */
  print?: boolean;
};

export type ReceiveUnitResult = {
  unit: UnitSummary;
  print: PrintOutcome;
  taskId: string | null;
  line: { id: string; lineNo: number; expectedQty: number | null; receivedQty: number } | null;
  /** SURPLUS when the box matches no expected line of a batch with a known content. */
  exception: { id: string; type: string } | null;
};

/**
 * One confirmed box = one new permanent identity. The same GTIN scanned for ten boxes gives ten
 * action keys and ten UUIDs; re-sending one key returns the same unit (no duplicate, no second
 * print job).
 */
export async function receiveUnit(db: WarehouseDb, input: ReceiveUnitInput, ctx: ActorContext): Promise<OperationResult<ReceiveUnitResult>> {
  return runOperation(db, { opKey: input.opKey, kind: "RECEIVE_UNIT", request: input, ctx }, async (tx) => {
    const batch = await requireOpenBatchTx(tx, input.batchId, "RECEIVING");
    const locationId = input.locationId ?? batch.receivingLocationId;
    if (!locationId) throw invalid("Zone de réception manquante sur le lot.");
    const locRows = await tx.$queryRaw<{ id: string; siteId: string; kind: LocationKind; code: string }[]>(Prisma.sql`
      SELECT "id", "siteId", "kind", "code" FROM "WarehouseLocation" WHERE "id" = ${locationId}`);
    const loc = locRows[0];
    if (!loc) throw notFound("Emplacement");
    if (loc.siteId !== batch.siteId) throw conflict("SITE_MISMATCH", "Cet emplacement appartient à un autre site que le lot.");
    if (!["RECEIVING", "CART", "QUARANTINE"].includes(loc.kind)) {
      throw conflict("WRONG_CODE_TYPE", `${loc.code} : une réception se pose en zone de réception, sur un chariot ou en quarantaine. Le rayon vient au rangement.`);
    }
    const item = await tx.$queryRaw<{ id: string; gtin: string | null; status: string }[]>(Prisma.sql`
      SELECT "id", "gtin", "status" FROM "WarehouseItem" WHERE "id" = ${input.itemId}`);
    if (!item[0] || item[0].status === "MERGED") throw notFound("Article");

    // Expected line: explicit, else first open line of this variant with room left.
    let line: { id: string; lineNo: number; expectedQty: number | null; receivedQty: number } | null = null;
    if (input.lineId) {
      const rows = await tx.$queryRaw<any[]>(Prisma.sql`
        SELECT "id", "lineNo", "expectedQty", "receivedQty" FROM "WarehouseBatchLine"
        WHERE "id" = ${input.lineId} AND "batchId" = ${batch.id} FOR UPDATE`);
      if (!rows[0]) throw notFound("Ligne attendue");
      line = rows[0];
    } else if (batch.expectedKnown) {
      const rows = await tx.$queryRaw<any[]>(Prisma.sql`
        SELECT "id", "lineNo", "expectedQty", "receivedQty" FROM "WarehouseBatchLine"
        WHERE "batchId" = ${batch.id} AND "status" = 'OPEN'
          AND ("itemId" = ${item[0].id} OR ("itemId" IS NULL AND "gtin" IS NOT NULL AND "gtin" IN (
                SELECT "value" FROM "WarehouseItemAlias" WHERE "itemId" = ${item[0].id} AND "namespace" = 'GTIN')))
          AND ("expectedQty" IS NULL OR "receivedQty" < "expectedQty")
        ORDER BY "lineNo" LIMIT 1 FOR UPDATE`);
      line = rows[0] ?? null;
    }
    const surplus = batch.expectedKnown && !line;
    const hold = Boolean(input.hold) || loc.kind === "QUARANTINE";

    const { unit } = await createUnitTx(
      tx,
      {
        siteId: batch.siteId,
        siteCode: batch.siteCode,
        itemId: item[0].id,
        // A23: an unexpected box inherits no supposed owner, price or right.
        ownerKind: surplus ? "UNKNOWN" : batch.ownerKind,
        ownerPartnerId: surplus ? null : batch.ownerPartnerId,
        agreementId: surplus ? null : batch.agreementId,
        originType: FLOW_ORIGIN[batch.flow],
        originBatchId: batch.id,
        originLineId: line?.id ?? null,
        locationId: loc.id,
        condition: input.condition,
        boxCondition: input.boxCondition,
        conditionNote: input.conditionNote?.trim() || null,
        qcState: hold ? "QUARANTINE" : "PENDING",
        saleState: hold || surplus ? "BLOCKED" : "STORAGE_ONLY",
        movementType: "RECEIVE",
      },
      ctx,
      input.opKey
    );

    if (line) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "WarehouseBatchLine" SET "receivedQty" = "receivedQty" + 1, "updatedAt" = now() WHERE "id" = ${line.id}`);
      line = { ...line, receivedQty: line.receivedQty + 1 };
    }
    let exception: ReceiveUnitResult["exception"] = null;
    if (surplus) {
      const id = await openExceptionTx(
        tx,
        { siteId: batch.siteId, type: "SURPLUS", unitId: unit.id, batchId: batch.id, locationId: loc.id, details: { itemId: item[0].id, gtin: item[0].gtin }, opKey: `${input.opKey}:surplus` },
        ctx
      );
      exception = { id, type: "SURPLUS" };
    }
    const taskId = hold
      ? null
      : await ensurePutawayTaskTx(tx, { unitId: unit.id, siteId: batch.siteId, batchId: batch.id, fromLocationId: loc.id, fromKind: loc.kind }, ctx);

    const print: PrintOutcome =
      input.print === false
        ? { status: "NOT_QUEUED", reason: "NO_STATION", message: "Impression non demandée." }
        : await enqueuePrintJobTx(
            tx,
            {
              siteId: batch.siteId,
              stationId: ctx.stationId,
              labelKind: "PAIR",
              objectType: "UNIT",
              objectId: unit.id,
              labelCode: unit.labelCode,
              payload: await buildPairLabelPayload(tx, unit.id),
              opKey: `${input.opKey}:print`,
            },
            ctx
          );
    return { unit: await getUnitSummary(tx, unit.id), print, taskId, line, exception };
  });
}

// ───────────────────────────── Stock-take (reprise) ─────────────────────────────

export type CountSessionView = {
  id: string;
  batchId: string;
  locationId: string;
  locationCode: string;
  locationShortCode: string;
  round: number;
  status: "OPEN" | "CLOSED";
  stationId: string | null;
  stationCode: string | null;
  operatorName: string | null;
  countedUnits: number;
  openedAt: string;
  closedAt: string | null;
  /** Pairs counted in this session. */
  scans: { unitId: string; result: "CREATED" | "FOUND_HERE" | "MOVED_HERE"; scannedAt: string; unit: UnitSummary }[];
  /** Pairs the system places on this level that have not been scanned in this session yet. */
  notYetScanned: UnitSummary[];
};

export async function getCountSession(conn: WarehouseConn, sessionId: string): Promise<CountSessionView> {
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`
    SELECT cs."id", cs."batchId", cs."locationId", l."code" AS "locationCode", l."shortCode" AS "locationShortCode", cs."round",
           cs."status", cs."stationId", st."code" AS "stationCode", o."name" AS "operatorName", cs."countedUnits", cs."openedAt", cs."closedAt"
    FROM "WarehouseCountSession" cs
    JOIN "WarehouseLocation" l ON l."id" = cs."locationId"
    LEFT JOIN "WarehouseStation" st ON st."id" = cs."stationId"
    LEFT JOIN "WarehouseOperator" o ON o."id" = cs."operatorId"
    WHERE cs."id" = ${sessionId}`);
  const s = rows[0];
  if (!s) throw notFound("Session de comptage");
  const scans = await conn.$queryRaw<{ unitId: string; result: any; createdAt: Date }[]>(Prisma.sql`
    SELECT "unitId", "result", "createdAt" FROM "WarehouseCountScan" WHERE "sessionId" = ${sessionId} ORDER BY "createdAt" DESC LIMIT 500`);
  const scanned = await Promise.all(scans.map(async (sc) => ({ unitId: sc.unitId, result: sc.result, scannedAt: new Date(sc.createdAt).toISOString(), unit: await getUnitSummary(conn, sc.unitId) })));
  const missing = await conn.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT u."id" FROM "WarehouseUnit" u
    WHERE u."currentLocationId" = ${s.locationId} AND u."presence" = 'PRESENT'
      AND NOT EXISTS (SELECT 1 FROM "WarehouseCountScan" c WHERE c."sessionId" = ${sessionId} AND c."unitId" = u."id")
    ORDER BY u."receivedAt" LIMIT 500`);
  return {
    ...s,
    openedAt: iso(s.openedAt),
    closedAt: iso(s.closedAt),
    scans: scanned,
    notYetScanned: await Promise.all(missing.map((m) => getUnitSummary(conn, m.id))),
  };
}

/**
 * Open (or resume) the count of one level for a stock-take batch.
 *
 * One OPEN session per level, enforced by a partial unique index: a second person scanning the
 * same level joins nothing silently — the session is resumed on the same station, or refused
 * with the holder shown (A04) unless `takeOver` is explicit.
 */
export async function openCountSession(
  db: WarehouseDb,
  input: { batchId: string; locationId: string; takeOver?: boolean },
  ctx: ActorContext
): Promise<{ session: CountSessionView; resumed: boolean }> {
  assertWritesEnabled();
  const outcome = await withTx(db, async (tx) => {
    const batch = await requireOpenBatchTx(tx, input.batchId, "STOCK_TAKE");
    const locRows = await tx.$queryRaw<{ id: string; siteId: string; code: string; holdsUnits: boolean; status: string }[]>(Prisma.sql`
      SELECT "id", "siteId", "code", "holdsUnits", "status" FROM "WarehouseLocation" WHERE "id" = ${input.locationId}`);
    const loc = locRows[0];
    if (!loc) throw notFound("Emplacement");
    if (loc.siteId !== batch.siteId) throw conflict("SITE_MISMATCH", "Ce niveau appartient à un autre site que le lot.");
    if (!loc.holdsUnits || loc.status === "RETIRED") throw conflict("LOCATION_NOT_USABLE", `${loc.code} ne peut pas contenir de paires.`);

    const existing = await tx.$queryRaw<{ id: string; batchId: string; stationId: string | null; operatorId: string | null }[]>(Prisma.sql`
      SELECT "id", "batchId", "stationId", "operatorId" FROM "WarehouseCountSession" WHERE "locationId" = ${loc.id} AND "status" = 'OPEN' FOR UPDATE`);
    if (existing[0]) {
      const s = existing[0];
      if (s.batchId !== batch.id) {
        throw conflict("SESSION_CONFLICT", `${loc.code} est en cours de comptage dans un autre lot : le clôturer d'abord.`, { sessionId: s.id, batchId: s.batchId });
      }
      const otherStation = s.stationId && ctx.stationId && s.stationId !== ctx.stationId;
      if (otherStation && !input.takeOver) {
        throw conflict("SESSION_CONFLICT", `${loc.code} est déjà en cours de comptage sur un autre poste. Reprendre la session uniquement si ce poste a arrêté.`, {
          sessionId: s.id,
          stationId: s.stationId,
        });
      }
      if (otherStation || (ctx.operatorId && ctx.operatorId !== s.operatorId)) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "WarehouseCountSession" SET "stationId" = ${ctx.stationId ?? s.stationId}, "operatorId" = ${ctx.operatorId ?? s.operatorId} WHERE "id" = ${s.id}`);
      }
      await tx.$executeRaw(Prisma.sql`UPDATE "WarehouseBatch" SET "activeLocationId" = ${loc.id}, "updatedAt" = now() WHERE "id" = ${batch.id}`);
      return { id: s.id, resumed: true };
    }
    const round = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n FROM "WarehouseCountSession" WHERE "batchId" = ${batch.id} AND "locationId" = ${loc.id}`);
    const id = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WarehouseCountSession" ("id", "batchId", "locationId", "round", "operatorId", "stationId")
      VALUES (${id}, ${batch.id}, ${loc.id}, ${round[0].n + 1}, ${ctx.operatorId ?? null}, ${ctx.stationId ?? null})`);
    await tx.$executeRaw(Prisma.sql`UPDATE "WarehouseBatch" SET "activeLocationId" = ${loc.id}, "updatedAt" = now() WHERE "id" = ${batch.id}`);
    return { id, resumed: false };
  }).catch((err) => {
    // Two stations opened the same level at the same instant: the index kept one.
    if (isUniqueViolation(err)) {
      throw conflict("SESSION_CONFLICT", "Ce niveau vient d'être ouvert au comptage sur un autre poste.");
    }
    throw err;
  });
  return { session: await getCountSession(db, outcome.id), resumed: outcome.resumed };
}

type OpenSession = { id: string; batchId: string; locationId: string; round: number; status: string; siteId: string; locationCode: string; locationKind: LocationKind };

async function requireOpenSessionTx(tx: WarehouseTx, sessionId: string): Promise<OpenSession> {
  const rows = await tx.$queryRaw<OpenSession[]>(Prisma.sql`
    SELECT cs."id", cs."batchId", cs."locationId", cs."round", cs."status", l."siteId", l."code" AS "locationCode", l."kind" AS "locationKind"
    FROM "WarehouseCountSession" cs JOIN "WarehouseLocation" l ON l."id" = cs."locationId"
    WHERE cs."id" = ${sessionId} FOR SHARE OF cs`);
  if (!rows[0]) throw notFound("Session de comptage");
  if (rows[0].status !== "OPEN") {
    throw conflict("SESSION_CONFLICT", "Cette session de comptage est close : rescanner le niveau pour en ouvrir une nouvelle.");
  }
  return rows[0];
}

async function recordCountScanTx(tx: WarehouseTx, session: OpenSession, unitId: string, result: "CREATED" | "FOUND_HERE" | "MOVED_HERE"): Promise<boolean> {
  const inserted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO "WarehouseCountScan" ("id", "sessionId", "batchId", "unitId", "locationId", "round", "result")
    VALUES (${randomUUID()}, ${session.id}, ${session.batchId}, ${unitId}, ${session.locationId}, ${session.round}, ${result})
    ON CONFLICT ("sessionId", "unitId") DO NOTHING RETURNING "id"`);
  if (inserted.length === 0) return false;
  await tx.$executeRaw(Prisma.sql`UPDATE "WarehouseCountSession" SET "countedUnits" = "countedUnits" + 1 WHERE "id" = ${session.id}`);
  return true;
}

export type StockTakeCreateInput = {
  opKey: string;
  sessionId: string;
  itemId: string;
  condition?: UnitCondition;
  boxCondition?: BoxCondition;
  conditionNote?: string | null;
  /** The box is on the level but its owner is not certain: recorded here, owner UNKNOWN, blocked (A02). */
  ownerUncertain?: boolean;
  print?: boolean;
};

export type StockTakeCreateResult = {
  unit: UnitSummary;
  print: PrintOutcome;
  countedInSession: number;
  exceptions: { id: string; type: string }[];
};

/**
 * An unidentified box on the counted level: create its unit AT the level (it is already on the
 * shelf — no putaway task, no reservation), under the batch owner, and print its QR.
 * Reality wins over the configured capacity: an over-capacity level raises a discrepancy.
 */
export async function stockTakeCreateUnit(db: WarehouseDb, input: StockTakeCreateInput, ctx: ActorContext): Promise<OperationResult<StockTakeCreateResult>> {
  return runOperation(db, { opKey: input.opKey, kind: "STOCK_TAKE_CREATE", request: input, ctx }, async (tx) => {
    const session = await requireOpenSessionTx(tx, input.sessionId);
    const batch = await requireOpenBatchTx(tx, session.batchId, "STOCK_TAKE");
    const item = await tx.$queryRaw<{ id: string; status: string }[]>(Prisma.sql`SELECT "id", "status" FROM "WarehouseItem" WHERE "id" = ${input.itemId}`);
    if (!item[0] || item[0].status === "MERGED") throw notFound("Article");
    const uncertain = Boolean(input.ownerUncertain);
    const { unit, overCapacity } = await createUnitTx(
      tx,
      {
        siteId: batch.siteId,
        siteCode: batch.siteCode,
        itemId: item[0].id,
        ownerKind: uncertain ? "UNKNOWN" : batch.ownerKind,
        ownerPartnerId: uncertain ? null : batch.ownerPartnerId,
        agreementId: uncertain ? null : batch.agreementId,
        originType: "STOCK_TAKE",
        originBatchId: batch.id,
        locationId: session.locationId,
        forceOccupancy: true,
        condition: input.condition,
        boxCondition: input.boxCondition,
        conditionNote: input.conditionNote?.trim() || null,
        saleState: uncertain ? "BLOCKED" : "STORAGE_ONLY",
        movementType: "STOCK_TAKE",
      },
      ctx,
      input.opKey
    );
    await recordCountScanTx(tx, session, unit.id, "CREATED");
    const exceptions: { id: string; type: string }[] = [];
    if (uncertain) {
      exceptions.push({
        type: "OWNER_SUSPECT",
        id: await openExceptionTx(tx, { siteId: batch.siteId, type: "OWNER_SUSPECT", unitId: unit.id, batchId: batch.id, locationId: session.locationId, opKey: `${input.opKey}:owner` }, ctx),
      });
    }
    if (overCapacity) {
      exceptions.push({
        type: "CAPACITY_MISMATCH",
        id: await openExceptionTx(tx, { siteId: batch.siteId, type: "CAPACITY_MISMATCH", unitId: unit.id, batchId: batch.id, locationId: session.locationId, opKey: `${input.opKey}:cap` }, ctx),
      });
    }
    // A box left on a cart / receiving zone during a stock-take still has to be put away.
    if (session.locationKind === "RECEIVING" || session.locationKind === "CART") {
      await ensurePutawayTaskTx(tx, { unitId: unit.id, siteId: batch.siteId, batchId: batch.id, fromLocationId: session.locationId, fromKind: session.locationKind }, ctx);
    }
    const print: PrintOutcome =
      input.print === false
        ? { status: "NOT_QUEUED", reason: "NO_STATION", message: "Impression non demandée." }
        : await enqueuePrintJobTx(
            tx,
            {
              siteId: batch.siteId,
              stationId: ctx.stationId,
              labelKind: "PAIR",
              objectType: "UNIT",
              objectId: unit.id,
              labelCode: unit.labelCode,
              payload: await buildPairLabelPayload(tx, unit.id),
              opKey: `${input.opKey}:print`,
            },
            ctx
          );
    const counted = await tx.$queryRaw<{ countedUnits: number }[]>(Prisma.sql`SELECT "countedUnits" FROM "WarehouseCountSession" WHERE "id" = ${session.id}`);
    return { unit: await getUnitSummary(tx, unit.id), print, countedInSession: counted[0].countedUnits, exceptions };
  });
}

export type StockTakeScanResult = {
  result: "FOUND_HERE" | "MOVED_HERE" | "ALREADY_COUNTED" | "NOT_COUNTED_EXCEPTION";
  unit: UnitSummary;
  countedInSession: number;
  exceptions: { id: string; type: string }[];
  message: string;
};

/**
 * An already identified pair scanned during the count of a level.
 *
 *  - recorded on this level → counted (and its label verified);
 *  - recorded elsewhere / missing → CONFIRMATION_REQUIRED, then with `confirmMove` an audited
 *    stock-take movement to the level actually observed (A40) — counters are never edited;
 *  - another owner than the batch → CONFIRMATION_REQUIRED, then with `acknowledgeOwner` it is
 *    counted and a discrepancy is opened; the owner is NOT changed by a count (A02);
 *  - sold / out / in transit → not counted, a discrepancy is opened; it does not come back into
 *    stock by being scanned (A09).
 */
export async function stockTakeScanUnit(
  db: WarehouseDb,
  input: { opKey: string; sessionId: string; unitId: string; confirmMove?: boolean; acknowledgeOwner?: boolean },
  ctx: ActorContext
): Promise<OperationResult<StockTakeScanResult>> {
  return runOperation(db, { opKey: input.opKey, kind: "STOCK_TAKE_SCAN", request: input, ctx }, async (tx) => {
    const session = await requireOpenSessionTx(tx, input.sessionId);
    const batch = await requireOpenBatchTx(tx, session.batchId, "STOCK_TAKE");
    const unit = await lockUnitTx(tx, input.unitId);
    const counted = async () =>
      (await tx.$queryRaw<{ countedUnits: number }[]>(Prisma.sql`SELECT "countedUnits" FROM "WarehouseCountSession" WHERE "id" = ${session.id}`))[0].countedUnits;
    const exceptions: { id: string; type: string }[] = [];

    const already = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "WarehouseCountScan" WHERE "sessionId" = ${session.id} AND "unitId" = ${unit.id}`);
    if (already[0]) {
      return { result: "ALREADY_COUNTED" as const, unit: await getUnitSummary(tx, unit.id), countedInSession: await counted(), exceptions, message: "Déjà comptée dans cette session : aucun changement." };
    }

    if (unit.presence === "OUT" || unit.presence === "IN_TRANSIT" || unit.presence === "THIRD_PARTY") {
      const id = await openExceptionTx(
        tx,
        {
          siteId: batch.siteId,
          type: "WRONG_LOCATION",
          unitId: unit.id,
          batchId: batch.id,
          locationId: session.locationId,
          rawCode: unit.labelCode,
          details: { presence: unit.presence, outReason: unit.outReason, instruction: "Vérifier le retour ou l'état de sortie avant toute remise en stock." },
          opKey: `${input.opKey}:exc`,
        },
        ctx
      );
      exceptions.push({ id, type: "WRONG_LOCATION" });
      return {
        result: "NOT_COUNTED_EXCEPTION" as const,
        unit: await getUnitSummary(tx, unit.id),
        countedInSession: await counted(),
        exceptions,
        message:
          unit.presence === "OUT"
            ? "Cette paire est sortie du stock. Elle n'est pas recomptée : un écart est ouvert pour vérifier le retour."
            : "Cette paire est en transit ou chez un tiers. Elle n'est pas recomptée : un écart est ouvert.",
      };
    }
    if (unit.currentSiteId && unit.currentSiteId !== session.siteId) {
      throw conflict("SITE_MISMATCH", "Cette paire est enregistrée sur un autre site : passer par un transfert entre sites.");
    }

    const ownerDiffers = unit.ownerKind !== batch.ownerKind || unit.ownerPartnerId !== batch.ownerPartnerId;
    if (ownerDiffers && !input.acknowledgeOwner) {
      throw conflict("CONFIRMATION_REQUIRED", "Cette paire appartient à un autre propriétaire que le lot en cours. La compter quand même ouvre un écart ; le propriétaire ne change pas.", {
        confirm: "acknowledgeOwner",
        unitOwnerKind: unit.ownerKind,
      });
    }
    const here = unit.presence === "PRESENT" && unit.currentLocationId === session.locationId;
    if (!here && !input.confirmMove) {
      const from = unit.currentLocationId
        ? (await tx.$queryRaw<{ code: string }[]>(Prisma.sql`SELECT "code" FROM "WarehouseLocation" WHERE "id" = ${unit.currentLocationId}`))[0]?.code
        : null;
      throw conflict(
        "CONFIRMATION_REQUIRED",
        from
          ? `Cette paire est enregistrée en ${from}. Confirmer qu'elle est physiquement en ${session.locationCode} pour corriger son adresse.`
          : `Cette paire était déclarée introuvable. Confirmer qu'elle est physiquement en ${session.locationCode}.`,
        { confirm: "confirmMove", recordedLocationCode: from }
      );
    }

    if (here) {
      await recordCountScanTx(tx, session, unit.id, "FOUND_HERE");
      if (!unit.labelVerifiedAt) {
        await applyUnitChangeTx(tx, unit, { labelVerifiedAt: new Date() }, { type: "LABEL_VERIFIED", batchId: batch.id }, ctx, input.opKey);
      }
    } else {
      await releaseActiveTaskTx(tx, unit.id, "STOCK_TAKE_MOVE");
      const { overCapacity } = await moveOccupancyTx(tx, { fromId: unit.currentLocationId, toId: session.locationId, force: true });
      await applyUnitChangeTx(
        tx,
        unit,
        { presence: "PRESENT", currentLocationId: session.locationId, currentSiteId: session.siteId, labelVerifiedAt: unit.labelVerifiedAt ?? new Date() },
        { type: "STOCK_TAKE", batchId: batch.id, reason: "Constat de reprise : adresse réelle", changes: { previousPresence: unit.presence } },
        ctx,
        input.opKey
      );
      await recordCountScanTx(tx, session, unit.id, "MOVED_HERE");
      if (overCapacity) {
        exceptions.push({
          type: "CAPACITY_MISMATCH",
          id: await openExceptionTx(tx, { siteId: batch.siteId, type: "CAPACITY_MISMATCH", unitId: unit.id, batchId: batch.id, locationId: session.locationId, opKey: `${input.opKey}:cap` }, ctx),
        });
      }
    }
    if (ownerDiffers) {
      exceptions.push({
        type: "OWNER_SUSPECT",
        id: await openExceptionTx(
          tx,
          { siteId: batch.siteId, type: "OWNER_SUSPECT", unitId: unit.id, batchId: batch.id, locationId: session.locationId, details: { batchOwnerKind: batch.ownerKind, unitOwnerKind: unit.ownerKind }, opKey: `${input.opKey}:owner` },
          ctx
        ),
      });
    }
    return {
      result: here ? ("FOUND_HERE" as const) : ("MOVED_HERE" as const),
      unit: await getUnitSummary(tx, unit.id),
      countedInSession: await counted(),
      exceptions,
      message: here ? "Comptée à sa place." : `Adresse corrigée : ${session.locationCode}.`,
    };
  });
}

export type CloseSessionResult = {
  sessionId: string;
  locationCode: string;
  round: number;
  counted: number;
  created: number;
  foundHere: number;
  movedHere: number;
  /** Pairs the system places here that were not scanned: to recount or to declare missing explicitly. */
  notScanned: { unitId: string; labelCode: string }[];
  /** Movements made on this level by other gestures while it was being counted (A03). */
  movementsDuringCount: number;
  exceptionId: string | null;
};

/**
 * Close the count of a level. Pairs expected here but not scanned are NOT silently removed:
 * a COUNT_MISMATCH discrepancy lists them for an independent second count (A06).
 */
export async function closeCountSession(db: WarehouseDb, input: { sessionId: string }, ctx: ActorContext): Promise<CloseSessionResult> {
  assertWritesEnabled();
  return withTx(db, async (tx) => {
    const rows = await tx.$queryRaw<any[]>(Prisma.sql`
      SELECT cs."id", cs."batchId", cs."locationId", cs."round", cs."status", cs."openedAt", l."code" AS "locationCode", l."siteId"
      FROM "WarehouseCountSession" cs JOIN "WarehouseLocation" l ON l."id" = cs."locationId"
      WHERE cs."id" = ${input.sessionId} FOR UPDATE OF cs`);
    const s = rows[0];
    if (!s) throw notFound("Session de comptage");
    const byResult = await tx.$queryRaw<{ result: string; n: number }[]>(Prisma.sql`
      SELECT "result", count(*)::int AS n FROM "WarehouseCountScan" WHERE "sessionId" = ${s.id} GROUP BY "result"`);
    const n = (r: string) => byResult.find((b) => b.result === r)?.n ?? 0;
    const notScanned = await tx.$queryRaw<{ unitId: string; labelCode: string }[]>(Prisma.sql`
      SELECT u."id" AS "unitId", u."labelCode" FROM "WarehouseUnit" u
      WHERE u."currentLocationId" = ${s.locationId} AND u."presence" = 'PRESENT'
        AND NOT EXISTS (SELECT 1 FROM "WarehouseCountScan" c WHERE c."sessionId" = ${s.id} AND c."unitId" = u."id")
      ORDER BY u."receivedAt" LIMIT 1000`);
    const during = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n FROM "WarehouseMovement" m
      WHERE m."createdAt" >= ${s.openedAt} AND (m."fromLocationId" = ${s.locationId} OR m."toLocationId" = ${s.locationId})
        AND m."batchId" IS DISTINCT FROM ${s.batchId} AND m."type" NOT IN ('LABEL_PRINT', 'LABEL_REPRINT', 'LABEL_VERIFIED')`);
    let exceptionId: string | null = null;
    if (s.status === "OPEN") {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "WarehouseCountSession" SET "status" = 'CLOSED', "closedAt" = now() WHERE "id" = ${s.id}`);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "WarehouseBatch" SET "activeLocationId" = NULL, "updatedAt" = now() WHERE "id" = ${s.batchId} AND "activeLocationId" = ${s.locationId}`);
      if (notScanned.length > 0) {
        exceptionId = await openExceptionTx(
          tx,
          {
            siteId: s.siteId,
            type: "COUNT_MISMATCH",
            batchId: s.batchId,
            locationId: s.locationId,
            details: { round: s.round, notScanned: notScanned.slice(0, 200), movementsDuringCount: during[0].n },
            opKey: `count-close:${s.id}`,
          },
          ctx
        );
      }
    }
    return {
      sessionId: s.id,
      locationCode: s.locationCode,
      round: s.round,
      counted: n("CREATED") + n("FOUND_HERE") + n("MOVED_HERE"),
      created: n("CREATED"),
      foundHere: n("FOUND_HERE"),
      movedHere: n("MOVED_HERE"),
      notScanned,
      movementsDuringCount: during[0].n,
      exceptionId,
    };
  });
}

// ───────────────────────────── Batch detail & close ─────────────────────────────

export type BatchDetail = {
  batch: BatchRow;
  lines: BatchLineRow[];
  totals: {
    expected: number | null;
    identified: number;
    atTemporary: number;
    shelved: number;
    quarantine: number;
    missing: number;
    labelsVerified: number;
    openExceptions: number;
  };
  /** Stock-take: counted levels (latest round per level) and the level in progress. */
  sessions: { id: string; locationId: string; locationCode: string; locationShortCode: string; round: number; status: string; countedUnits: number; openedAt: string; closedAt: string | null }[];
  openSession: { id: string; locationCode: string; locationShortCode: string; countedUnits: number } | null;
};

export async function getBatchDetail(conn: WarehouseConn, batchId: string): Promise<BatchDetail> {
  const batch = await getBatch(conn, batchId);
  const [lines, totals, sessions] = await Promise.all([
    listBatchLines(conn, batchId),
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT count(*)::int AS "identified",
             count(*) FILTER (WHERE u."presence" = 'PRESENT' AND l."kind" IN ('RECEIVING', 'CART'))::int AS "atTemporary",
             count(*) FILTER (WHERE u."presence" = 'PRESENT' AND l."kind" = 'LEVEL')::int AS "shelved",
             count(*) FILTER (WHERE u."qcState" = 'QUARANTINE')::int AS "quarantine",
             count(*) FILTER (WHERE u."presence" = 'MISSING')::int AS "missing",
             count(*) FILTER (WHERE u."labelVerifiedAt" IS NOT NULL)::int AS "labelsVerified"
      FROM "WarehouseUnit" u LEFT JOIN "WarehouseLocation" l ON l."id" = u."currentLocationId"
      WHERE u."originBatchId" = ${batchId}`),
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT cs."id", cs."locationId", l."code" AS "locationCode", l."shortCode" AS "locationShortCode", cs."round", cs."status",
             cs."countedUnits", cs."openedAt", cs."closedAt"
      FROM "WarehouseCountSession" cs JOIN "WarehouseLocation" l ON l."id" = cs."locationId"
      WHERE cs."batchId" = ${batchId} ORDER BY cs."openedAt" DESC LIMIT 500`),
  ]);
  const expected = batch.expectedKnown ? lines.reduce((sum, l) => sum + (l.expectedQty ?? 0), 0) : null;
  const open = sessions.find((s) => s.status === "OPEN") ?? null;
  return {
    batch,
    lines,
    totals: { expected, ...totals[0], openExceptions: batch.openExceptionCount },
    sessions: sessions.map((s) => ({ ...s, openedAt: iso(s.openedAt), closedAt: iso(s.closedAt) })),
    openSession: open ? { id: open.id, locationCode: open.locationCode, locationShortCode: open.locationShortCode, countedUnits: open.countedUnits } : null,
  };
}

/**
 * Close a batch. The summary explains every difference: per expected line received vs expected
 * (shortfall needs an explicit reason — A22), surplus boxes, pairs still to put away, open
 * discrepancies ("à vérifier"). Closing never creates, removes or moves a pair.
 */
export async function closeBatch(
  db: WarehouseDb,
  input: { batchId: string; reason?: string | null },
  ctx: ActorContext
): Promise<{ batch: BatchRow; summary: Record<string, unknown> }> {
  assertWritesEnabled();
  const summary = await withTx(db, async (tx) => {
    const rows = await tx.$queryRaw<{ status: BatchStatus; kind: BatchKind; closeSummary: any; siteId: string }[]>(Prisma.sql`
      SELECT "status", "kind", "closeSummary", "siteId" FROM "WarehouseBatch" WHERE "id" = ${input.batchId} FOR UPDATE`);
    const b = rows[0];
    if (!b) throw notFound("Lot");
    if (b.status === "CLOSED") return b.closeSummary as Record<string, unknown>;
    if (b.status === "CANCELLED") throw conflict("BATCH_NOT_OPEN", "Lot annulé.");
    const openSessions = await tx.$queryRaw<{ code: string }[]>(Prisma.sql`
      SELECT l."code" FROM "WarehouseCountSession" cs JOIN "WarehouseLocation" l ON l."id" = cs."locationId"
      WHERE cs."batchId" = ${input.batchId} AND cs."status" = 'OPEN'`);
    if (openSessions.length) {
      throw conflict("SESSION_CONFLICT", `Comptage encore ouvert sur ${openSessions.map((s) => s.code).join(", ")} : le clôturer avant le lot.`);
    }
    const detail = await getBatchDetail(tx, input.batchId);
    const short = detail.lines.filter((l) => l.expectedQty !== null && l.receivedQty < l.expectedQty && l.status === "OPEN");
    const reason = String(input.reason ?? "").trim();
    if (short.length > 0 && reason.length < 3) {
      throw invalid(`${short.length} ligne(s) attendue(s) incomplète(s) : indiquer le motif de clôture (reliquat, manquant, erreur de bordereau).`, {
        shortLines: short.map((l) => ({ lineNo: l.lineNo, expectedQty: l.expectedQty, receivedQty: l.receivedQty })),
      });
    }
    for (const l of short) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "WarehouseBatchLine" SET "status" = 'CLOSED_SHORT', "closeReason" = ${reason.slice(0, 500)}, "updatedAt" = now() WHERE "id" = ${l.id}`);
      await openExceptionTx(
        tx,
        { siteId: b.siteId, type: "MISSING", batchId: input.batchId, details: { lineNo: l.lineNo, gtin: l.gtin, description: l.description, expectedQty: l.expectedQty, receivedQty: l.receivedQty, reason }, opKey: `batch-close:${l.id}` },
        ctx
      );
    }
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseBatchLine" SET "status" = 'CLOSED', "updatedAt" = now() WHERE "batchId" = ${input.batchId} AND "status" = 'OPEN'`);
    const surplus = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n FROM "WarehouseException" WHERE "batchId" = ${input.batchId} AND "type" = 'SURPLUS'`);
    const openExc = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n FROM "WarehouseException" WHERE "batchId" = ${input.batchId} AND "status" = 'OPEN'`);
    const result = {
      closedAt: new Date().toISOString(),
      kind: b.kind,
      expected: detail.totals.expected,
      identified: detail.totals.identified,
      confirmedOnShelf: detail.totals.shelved,
      stillToPutAway: detail.totals.atTemporary,
      quarantine: detail.totals.quarantine,
      missingPairs: detail.totals.missing,
      shortLines: short.map((l) => ({ lineNo: l.lineNo, gtin: l.gtin, description: l.description, expectedQty: l.expectedQty, receivedQty: l.receivedQty })),
      surplusBoxes: surplus[0].n,
      toVerify: openExc[0].n,
      labelsVerified: detail.totals.labelsVerified,
      levelsCounted: new Set(detail.sessions.map((s) => s.locationId)).size,
      reason: reason || null,
    };
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseBatch" SET "status" = 'CLOSED', "closedAt" = now(), "closeSummary" = ${JSON.stringify(result)}::jsonb,
        "activeLocationId" = NULL, "updatedAt" = now()
      WHERE "id" = ${input.batchId}`);
    return result as Record<string, unknown>;
  });
  return { batch: await getBatch(db, input.batchId), summary };
}
