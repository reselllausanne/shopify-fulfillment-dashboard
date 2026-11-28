import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { UNIT_LABEL_FORMAT_V1, buildUnitLabelCode, classifyScan, isUuidV4, stripScannerTransport, swapYZ, toCsv, unitShortRef } from "./codes";
import type { WarehouseConn, WarehouseDb, WarehouseTx } from "./db";
import { WarehouseError, conflict, invalid, notFound } from "./errors";
import { openExceptionTx } from "./exceptions";
import { resolveGtin, type GtinResolution } from "./items";
import { resolveLocationCode } from "./locations";
import { assertSiteInPilot, assertWritesEnabled, runOperation, type OperationResult } from "./operations";
import type {
  ActorContext,
  BoxCondition,
  LocationSummary,
  MovementType,
  OwnerKind,
  UnitCondition,
  UnitOrigin,
  UnitOutReason,
  UnitPresence,
  UnitQcState,
  UnitSaleState,
  UnitSummary,
} from "./types";

/**
 * Physical units. One row = one box, identified forever by its UUID v4.
 *
 * Invariants (also enforced in SQL):
 *  - the id, label code and issuing site never change (trigger);
 *  - current state + its movement are written in the same transaction, version + 1 each time;
 *  - PRESENT ⇔ a confirmed location; nothing here is derived from a channel listing;
 *  - a read (resolveScan, getUnitDetail) never moves or changes anything.
 */

// ───────────────────────────── Read model ─────────────────────────────

const UNIT_SELECT = Prisma.sql`
  SELECT u."id", u."labelCode", u."issuingSiteCode", u."itemId",
         i."name" AS "itemName", i."brand" AS "itemBrand", i."styleCode" AS "itemStyleCode",
         i."sizeLabel" AS "itemSizeLabel", i."gtin" AS "itemGtin", i."imageUrl" AS "itemImageUrl", i."status" AS "itemStatus",
         u."ownerKind", u."ownerPartnerId", p."name" AS "ownerName", u."originType", u."originBatchId",
         u."presence", u."currentSiteId", s."code" AS "currentSiteCode", u."currentLocationId",
         l."code" AS "currentLocationCode", l."shortCode" AS "currentLocationShortCode", l."kind" AS "currentLocationKind",
         u."qcState", u."saleState", u."condition", u."boxCondition", u."boxProfile", u."outReason", u."labelPrintCount",
         u."labelVerifiedAt", u."version", u."observedAt", u."receivedAt"
  FROM "WarehouseUnit" u
  JOIN "WarehouseItem" i ON i."id" = u."itemId"
  LEFT JOIN "Partner" p ON p."id" = u."ownerPartnerId"
  LEFT JOIN "WarehouseSite" s ON s."id" = u."currentSiteId"
  LEFT JOIN "WarehouseLocation" l ON l."id" = u."currentLocationId"`;

type UnitSummaryDb = Omit<UnitSummary, "shortRef" | "labelVerifiedAt" | "observedAt" | "receivedAt"> & {
  labelVerifiedAt: Date | null;
  observedAt: Date;
  receivedAt: Date;
};

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

function toUnitSummary(row: UnitSummaryDb): UnitSummary {
  return {
    ...row,
    shortRef: unitShortRef(row.id),
    labelVerifiedAt: iso(row.labelVerifiedAt),
    observedAt: iso(row.observedAt) as string,
    receivedAt: iso(row.receivedAt) as string,
  };
}

export async function getUnitSummary(conn: WarehouseConn, unitId: string): Promise<UnitSummary> {
  const rows = await conn.$queryRaw<UnitSummaryDb[]>(Prisma.sql`${UNIT_SELECT} WHERE u."id" = ${unitId}`);
  if (!rows[0]) throw notFound("Paire", { unitId });
  return toUnitSummary(rows[0]);
}

export type ListUnitsInput = {
  siteId?: string;
  ownerKind?: OwnerKind;
  ownerPartnerId?: string;
  presence?: UnitPresence | UnitPresence[];
  qcState?: UnitQcState;
  saleState?: UnitSaleState;
  itemId?: string;
  locationId?: string;
  batchId?: string;
  /** Free text: label / short ref / GTIN / model / style / size. */
  search?: string;
  limit?: number;
  /** Keyset cursor `<receivedAt ISO>|<id>` of the last row (stable under inserts). */
  cursor?: string | null;
};

function unitFilters(input: ListUnitsInput): Prisma.Sql[] {
  const where: Prisma.Sql[] = [];
  if (input.siteId) where.push(Prisma.sql`u."currentSiteId" = ${input.siteId}`);
  if (input.ownerKind) where.push(Prisma.sql`u."ownerKind" = ${input.ownerKind}`);
  if (input.ownerPartnerId) where.push(Prisma.sql`u."ownerPartnerId" = ${input.ownerPartnerId}`);
  if (input.presence) {
    const list = Array.isArray(input.presence) ? input.presence : [input.presence];
    if (list.length) where.push(Prisma.sql`u."presence" IN (${Prisma.join(list)})`);
  }
  if (input.qcState) where.push(Prisma.sql`u."qcState" = ${input.qcState}`);
  if (input.saleState) where.push(Prisma.sql`u."saleState" = ${input.saleState}`);
  if (input.itemId) where.push(Prisma.sql`u."itemId" = ${input.itemId}`);
  if (input.locationId) where.push(Prisma.sql`u."currentLocationId" = ${input.locationId}`);
  if (input.batchId) where.push(Prisma.sql`u."originBatchId" = ${input.batchId}`);

  const q = String(input.search ?? "").trim();
  if (q) {
    const scan = classifyScan(q);
    const hex = q.toLowerCase().replace(/[^0-9a-f]/g, "");
    if (scan.kind === "UNIT_LABEL") {
      where.push(Prisma.sql`u."id" = ${scan.unitId}`);
    } else if (scan.kind === "GTIN") {
      where.push(Prisma.sql`u."itemId" IN (
        SELECT "itemId" FROM "WarehouseItemAlias" WHERE "namespace" = 'GTIN' AND "value" = ${scan.gtin})`);
    } else if (/^[0-9a-fA-F-]{4,36}$/.test(q) && hex.length >= 4 && /^[0-9a-f]+$/.test(hex)) {
      // Short ref (75D2-7E3F) or UUID prefix: indexed prefix search on the id.
      const prefix = hex.length > 8 ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}`.replace(/-$/, "") : hex;
      where.push(Prisma.sql`u."id" LIKE ${`${prefix}%`}`);
    } else {
      const terms = q.toLowerCase().replace(/[%_\\]/g, "").split(/\s+/).filter(Boolean).slice(0, 6);
      for (const t of terms) where.push(Prisma.sql`i."searchText" LIKE ${`%${t}%`}`);
    }
  }
  return where;
}

/** Largest internal export in one file. Above it the export is refused, never cut short (C38). */
export const STOCK_EXPORT_MAX_ROWS = 250_000;

/**
 * CSV of the stock matching the list filters, read page by page with the list's own keyset.
 * A file that would leave rows out is refused with the limit: a statement is complete or absent.
 */
export async function exportStockCsv(
  conn: WarehouseConn,
  filters: Omit<ListUnitsInput, "limit" | "cursor">,
  maxRows = STOCK_EXPORT_MAX_ROWS
): Promise<{ csv: string; rows: number }> {
  const rows: unknown[][] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { items: UnitSummary[]; nextCursor: string | null } = await listUnits(conn, { ...filters, limit: 200, cursor });
    for (const u of page.items) {
      rows.push([u.labelCode, u.shortRef, u.itemGtin ?? "", u.itemBrand ?? "", u.itemName ?? "", u.itemStyleCode ?? "", u.itemSizeLabel ?? "", u.ownerKind, u.ownerName ?? "", u.currentSiteCode ?? "", u.currentLocationCode ?? "", u.presence, u.qcState, u.saleState, u.condition, u.receivedAt]);
    }
    if (rows.length > maxRows) {
      throw invalid(`Export limité à ${maxRows.toLocaleString("fr-CH")} lignes. Filtrer par site, propriétaire ou présence, puis exporter chaque partie.`, { maxRows });
    }
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  const csv = toCsv(["code_etiquette", "ref_courte", "gtin", "marque", "modele", "ref_modele", "pointure", "proprietaire", "partenaire", "site", "emplacement", "presence", "controle", "vente", "etat", "recu_le"], rows);
  return { csv, rows: rows.length };
}

/** Server-side paginated list — never returns a whole stock. */
export async function listUnits(
  conn: WarehouseConn,
  input: ListUnitsInput
): Promise<{ items: UnitSummary[]; nextCursor: string | null }> {
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const where = unitFilters(input);
  if (input.cursor) {
    const [at, id] = input.cursor.split("|");
    const date = new Date(at);
    if (!Number.isNaN(date.getTime()) && id) {
      where.push(Prisma.sql`(u."receivedAt", u."id") < (${date}, ${id})`);
    }
  }
  const rows = await conn.$queryRaw<UnitSummaryDb[]>(Prisma.sql`
    ${UNIT_SELECT}
    ${where.length ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty}
    ORDER BY u."receivedAt" DESC, u."id" DESC
    LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toUnitSummary),
    nextCursor: rows.length > limit && last ? `${new Date(last.receivedAt).toISOString()}|${last.id}` : null,
  };
}

export type ItemAggregate = {
  itemId: string;
  itemName: string;
  itemBrand: string | null;
  itemStyleCode: string | null;
  itemSizeLabel: string | null;
  itemImageUrl: string | null;
  ownerKind: OwnerKind;
  ownerPartnerId: string | null;
  ownerName: string | null;
  total: number;
  present: number;
  shelved: number;
  toPutAway: number;
  qcPending: number;
  quarantine: number;
  saleAuthorized: number;
  missing: number;
};

/** Stock aggregated by variant + owner (SQL aggregation, paginated by offset on a bounded group list). */
export async function aggregateUnitsByItem(
  conn: WarehouseConn,
  input: ListUnitsInput & { offset?: number }
): Promise<{ items: ItemAggregate[]; hasMore: boolean }> {
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const offset = Math.max(0, input.offset ?? 0);
  const where = unitFilters(input);
  if (!input.presence) where.push(Prisma.sql`u."presence" <> 'OUT'`);
  const rows = await conn.$queryRaw<ItemAggregate[]>(Prisma.sql`
    SELECT u."itemId", i."name" AS "itemName", i."brand" AS "itemBrand", i."styleCode" AS "itemStyleCode",
           i."sizeLabel" AS "itemSizeLabel", i."imageUrl" AS "itemImageUrl",
           u."ownerKind", u."ownerPartnerId", p."name" AS "ownerName",
           count(*)::int AS "total",
           count(*) FILTER (WHERE u."presence" = 'PRESENT')::int AS "present",
           count(*) FILTER (WHERE u."presence" = 'PRESENT' AND l."kind" = 'LEVEL')::int AS "shelved",
           count(*) FILTER (WHERE u."presence" = 'PRESENT' AND l."kind" IN ('RECEIVING', 'CART'))::int AS "toPutAway",
           count(*) FILTER (WHERE u."qcState" = 'PENDING')::int AS "qcPending",
           count(*) FILTER (WHERE u."qcState" = 'QUARANTINE')::int AS "quarantine",
           count(*) FILTER (WHERE u."saleState" = 'SALE_AUTHORIZED' AND u."qcState" = 'PASSED' AND u."presence" = 'PRESENT')::int AS "saleAuthorized",
           count(*) FILTER (WHERE u."presence" = 'MISSING')::int AS "missing"
    FROM "WarehouseUnit" u
    JOIN "WarehouseItem" i ON i."id" = u."itemId"
    LEFT JOIN "Partner" p ON p."id" = u."ownerPartnerId"
    LEFT JOIN "WarehouseLocation" l ON l."id" = u."currentLocationId"
    ${where.length ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty}
    GROUP BY u."itemId", i."name", i."brand", i."styleCode", i."sizeLabel", i."imageUrl", u."ownerKind", u."ownerPartnerId", p."name"
    ORDER BY i."name", i."sizeLabel", u."itemId", u."ownerPartnerId" NULLS FIRST
    LIMIT ${limit + 1} OFFSET ${offset}`);
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

export type UnitDetail = {
  unit: UnitSummary & { conditionNote: string | null; agreementId: string | null; historyArchivedAt: string | null; historyArchiveRef: string | null };
  labelCodes: { code: string; format: string; isOriginal: boolean; issuedAt: string; note: string | null }[];
  externalRefs: { namespace: string; value: string; note: string | null }[];
  movements: {
    id: string;
    seq: string;
    type: MovementType;
    fromLocationCode: string | null;
    toLocationCode: string | null;
    fromSiteCode: string | null;
    toSiteCode: string | null;
    changes: unknown;
    reason: string | null;
    note: string | null;
    operatorName: string | null;
    actorRole: string | null;
    stationCode: string | null;
    observedAt: string;
    createdAt: string;
  }[];
  activeTask: { id: string; status: string; proposedLocationCode: string | null; proposedLocationShortCode: string | null; holdReason: string | null } | null;
  prices: {
    id: string;
    status: string;
    source: string;
    currency: string;
    publicPrice: string | null;
    sellerNet: string | null;
    fees: string | null;
    margin: string | null;
    basisAmount: string | null;
    basisRef: string | null;
    factor: string | null;
    note: string | null;
    createdAt: string;
  }[];
  allocations: { id: string; channel: string; orderRef: string; status: string; createdAt: string }[];
  openExceptions: { id: string; type: string; createdAt: string }[];
  printJobs: { id: string; status: string; isReprint: boolean; reason: string | null; stationCode: string | null; printerName: string | null; createdAt: string; lastError: string | null }[];
};

/** Full staff view of one pair. Read-only: opening an old pair never puts it back in stock. */
export async function getUnitDetail(conn: WarehouseConn, unitId: string): Promise<UnitDetail> {
  const summary = await getUnitSummary(conn, unitId);
  const extra = await conn.$queryRaw<
    { conditionNote: string | null; agreementId: string | null; historyArchivedAt: Date | null; historyArchiveRef: string | null }[]
  >(Prisma.sql`SELECT "conditionNote", "agreementId", "historyArchivedAt", "historyArchiveRef" FROM "WarehouseUnit" WHERE "id" = ${unitId}`);
  const [labelCodes, externalRefs, movements, tasks, prices, allocations, exceptions, printJobs] = await Promise.all([
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT "code", "format", "isOriginal", "issuedAt", "note" FROM "WarehouseLabelCode" WHERE "unitId" = ${unitId} ORDER BY "issuedAt"`),
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT "namespace", "value", "note" FROM "WarehouseUnitExternalRef" WHERE "unitId" = ${unitId} ORDER BY "createdAt"`),
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT m."id", m."seq"::text AS "seq", m."type", fl."code" AS "fromLocationCode", tl."code" AS "toLocationCode",
             fs."code" AS "fromSiteCode", ts."code" AS "toSiteCode", m."changes", m."reason", m."note",
             o."name" AS "operatorName", m."actorRole", st."code" AS "stationCode", m."observedAt", m."createdAt"
      FROM "WarehouseMovement" m
      LEFT JOIN "WarehouseLocation" fl ON fl."id" = m."fromLocationId"
      LEFT JOIN "WarehouseLocation" tl ON tl."id" = m."toLocationId"
      LEFT JOIN "WarehouseSite" fs ON fs."id" = m."fromSiteId"
      LEFT JOIN "WarehouseSite" ts ON ts."id" = m."toSiteId"
      LEFT JOIN "WarehouseOperator" o ON o."id" = m."operatorId"
      LEFT JOIN "WarehouseStation" st ON st."id" = m."stationId"
      WHERE m."unitId" = ${unitId} ORDER BY m."seq" DESC LIMIT 200`),
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT t."id", t."status", pl."code" AS "proposedLocationCode", pl."shortCode" AS "proposedLocationShortCode", t."holdReason"
      FROM "WarehousePutawayTask" t LEFT JOIN "WarehouseLocation" pl ON pl."id" = t."proposedLocationId"
      WHERE t."unitId" = ${unitId} AND t."status" IN ('PENDING', 'RESERVED') LIMIT 1`),
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT "id", "status", "source", "currency", "publicPrice"::text, "sellerNet"::text, "fees"::text, "margin"::text,
             "basisAmount"::text, "basisRef", "factor"::text, "note", "createdAt"
      FROM "WarehouseUnitPrice" WHERE "unitId" = ${unitId} ORDER BY "createdAt" DESC LIMIT 20`),
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT "id", "channel", "orderRef", "status", "createdAt" FROM "WarehouseSaleAllocation"
      WHERE "unitId" = ${unitId} ORDER BY "createdAt" DESC LIMIT 20`),
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT "id", "type", "createdAt" FROM "WarehouseException" WHERE "unitId" = ${unitId} AND "status" = 'OPEN' ORDER BY "createdAt" DESC`),
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT j."id", j."status", j."isReprint", j."reason", st."code" AS "stationCode", pr."name" AS "printerName", j."createdAt", j."lastError"
      FROM "WarehousePrintJob" j
      LEFT JOIN "WarehouseStation" st ON st."id" = j."stationId"
      LEFT JOIN "WarehousePrinter" pr ON pr."id" = j."printerId"
      WHERE j."objectType" = 'UNIT' AND j."objectId" = ${unitId} ORDER BY j."createdAt" DESC LIMIT 20`),
  ]);
  const dates = <T extends Record<string, any>>(rows: T[], keys: string[]) =>
    rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, iso(r[k])])) }));
  return {
    unit: {
      ...summary,
      conditionNote: extra[0]?.conditionNote ?? null,
      agreementId: extra[0]?.agreementId ?? null,
      historyArchivedAt: iso(extra[0]?.historyArchivedAt),
      historyArchiveRef: extra[0]?.historyArchiveRef ?? null,
    },
    labelCodes: dates(labelCodes, ["issuedAt"]) as UnitDetail["labelCodes"],
    externalRefs,
    movements: dates(movements, ["observedAt", "createdAt"]) as UnitDetail["movements"],
    activeTask: tasks[0] ?? null,
    prices: dates(prices, ["createdAt"]) as UnitDetail["prices"],
    allocations: dates(allocations, ["createdAt"]) as UnitDetail["allocations"],
    openExceptions: dates(exceptions, ["createdAt"]) as UnitDetail["openExceptions"],
    printJobs: dates(printJobs, ["createdAt"]) as UnitDetail["printJobs"],
  };
}

// ───────────────────────────── Scan resolution (read-only) ─────────────────────────────

export type ScanResolution =
  | { kind: "UNIT"; unit: UnitSummary; scannedCode: string; via: "LABEL" | "ALIAS" | "EXTERNAL_REF" }
  | { kind: "UNIT_CODE_UNKNOWN"; scannedCode: string; hint: string }
  | { kind: "EXTERNAL_REF_UNKNOWN"; scannedCode: string; hint: string }
  | { kind: "EXTERNAL_REF_AMBIGUOUS"; scannedCode: string; unitIds: string[]; hint: string }
  | { kind: "LOCATION"; location: LocationSummary & { viaAlias: boolean; scannedCode: string } }
  | { kind: "LOCATION_UNKNOWN"; scannedCode: string; hint: string }
  | { kind: "GTIN"; resolution: GtinResolution }
  | { kind: "MANGLED_NUMBER"; raw: string; hint: string }
  | { kind: "EMPTY" }
  | { kind: "UNKNOWN"; raw: string; hint: string };

/**
 * What is this code? Asks the registries; never writes, never moves anything (a lookup is not
 * a movement). The printed value resolves on every site and after any migration: the registry
 * row is the authority, not the shape of the text.
 */
export async function resolveScan(conn: WarehouseConn, raw: string): Promise<ScanResolution> {
  const scan = classifyScan(raw);
  switch (scan.kind) {
    case "EMPTY":
      return { kind: "EMPTY" };
    case "UNIT_LABEL":
    case "EXTERNAL_UUID_REF": {
      let reg = await conn.$queryRaw<{ unitId: string; format: string; isOriginal: boolean }[]>(Prisma.sql`
        SELECT "unitId", "format", "isOriginal" FROM "WarehouseLabelCode" WHERE "code" = ${scan.code}`);
      if (!reg[0] && scan.kind === "UNIT_LABEL" && /[YZ]/.test(scan.issuingSiteCode)) {
        // QWERTZ host, QWERTY scanner: Y and Z are swapped in the site suffix. The UUID part is untouched,
        // so the registry row found this way is the one and only pair carrying this UUID.
        const swapped = `${scan.unitId}-${swapYZ(scan.issuingSiteCode)}`;
        reg = await conn.$queryRaw<{ unitId: string; format: string; isOriginal: boolean }[]>(Prisma.sql`
          SELECT "unitId", "format", "isOriginal" FROM "WarehouseLabelCode" WHERE "code" = ${swapped} AND "unitId" = ${scan.unitId}`);
      }
      if (reg[0]) {
        return {
          kind: "UNIT",
          unit: await getUnitSummary(conn, reg[0].unitId),
          scannedCode: scan.code,
          via: reg[0].isOriginal ? "LABEL" : "ALIAS",
        };
      }
      const ext = await conn.$queryRaw<{ unitId: string }[]>(Prisma.sql`
        SELECT DISTINCT "unitId" FROM "WarehouseUnitExternalRef" WHERE "value" = ${scan.code} LIMIT 5`);
      if (ext.length === 1) {
        return { kind: "UNIT", unit: await getUnitSummary(conn, ext[0].unitId), scannedCode: scan.code, via: "EXTERNAL_REF" };
      }
      if (ext.length > 1) {
        return {
          kind: "EXTERNAL_REF_AMBIGUOUS",
          scannedCode: scan.code,
          unitIds: ext.map((e) => e.unitId),
          hint: "Cette référence externe est rattachée à plusieurs paires : arbitrage requis.",
        };
      }
      if (scan.kind === "UNIT_LABEL") {
        return {
          kind: "UNIT_CODE_UNKNOWN",
          scannedCode: scan.code,
          hint: "Code au format paire, absent du registre. Ne pas créer de paire à partir de ce code : ouvrir un écart.",
        };
      }
      return {
        kind: "EXTERNAL_REF_UNKNOWN",
        scannedCode: scan.code,
        hint: "Référence externe (fournisseur / retour) non rattachée. Son suffixe n'est pas interprété.",
      };
    }
    case "LOCATION": {
      const location = (await resolveLocationCode(conn, scan.code)) ?? (/[YZ]/.test(scan.code) ? await resolveLocationCode(conn, swapYZ(scan.code)) : null);
      if (location) return { kind: "LOCATION", location };
      // An old label may look like an address: it is still only a search alias.
      const legacy = await resolveExternalRef(conn, stripScannerTransport(raw));
      if (legacy) return legacy;
      return { kind: "LOCATION_UNKNOWN", scannedCode: scan.code, hint: "Code au format emplacement, inconnu sur ce système." };
    }
    case "GTIN":
      return { kind: "GTIN", resolution: await resolveGtin(conn, scan.gtin) };
    case "MANGLED_NUMBER":
      return {
        kind: "MANGLED_NUMBER",
        raw: scan.raw,
        hint: "Nombre en notation scientifique : le GTIN a été abîmé par un tableur. Rescanner la boîte ou saisir les chiffres.",
      };
    default: {
      // Free text: an old label or a partner reference attached to a pair as an alias (C32).
      const legacy = await resolveExternalRef(conn, scan.raw);
      if (legacy) return legacy;
      return { kind: "UNKNOWN", raw: scan.raw, hint: "Code non reconnu : ni paire, ni emplacement, ni GTIN." };
    }
  }
}

/** Exact-match lookup of an external reference. One pair → found; several → explicit choice. Never an identity. */
async function resolveExternalRef(conn: WarehouseConn, value: string): Promise<ScanResolution | null> {
  const v = String(value ?? "").trim();
  if (!v || v.length > 200) return null;
  const ext = await conn.$queryRaw<{ unitId: string }[]>(Prisma.sql`
    SELECT DISTINCT "unitId" FROM "WarehouseUnitExternalRef" WHERE "value" = ${v} LIMIT 5`);
  if (ext.length === 1) return { kind: "UNIT", unit: await getUnitSummary(conn, ext[0].unitId), scannedCode: v, via: "EXTERNAL_REF" };
  if (ext.length > 1) {
    return {
      kind: "EXTERNAL_REF_AMBIGUOUS",
      scannedCode: v,
      unitIds: ext.map((e) => e.unitId),
      hint: "Cette référence externe est rattachée à plusieurs paires : arbitrage requis.",
    };
  }
  return null;
}

// ───────────────────────────── Write primitives ─────────────────────────────

export type UnitRow = {
  id: string;
  labelCode: string;
  issuingSiteId: string;
  issuingSiteCode: string;
  itemId: string;
  ownerKind: OwnerKind;
  ownerPartnerId: string | null;
  agreementId: string | null;
  originType: UnitOrigin;
  originBatchId: string | null;
  presence: UnitPresence;
  currentSiteId: string | null;
  currentLocationId: string | null;
  qcState: UnitQcState;
  saleState: UnitSaleState;
  condition: UnitCondition;
  boxCondition: BoxCondition;
  boxProfile: string;
  conditionNote: string | null;
  outReason: UnitOutReason | null;
  labelPrintCount: number;
  labelVerifiedAt: Date | null;
  version: number;
  observedAt: Date;
};

/** Lock one unit for the rest of the transaction. Every gesture locks the unit first, then locations. */
export async function lockUnitTx(tx: WarehouseTx, unitId: string): Promise<UnitRow> {
  if (!isUuidV4(String(unitId ?? "").toLowerCase())) throw notFound("Paire", { unitId });
  const rows = await tx.$queryRaw<UnitRow[]>(Prisma.sql`
    SELECT "id", "labelCode", "issuingSiteId", "issuingSiteCode", "itemId", "ownerKind", "ownerPartnerId", "agreementId",
           "originType", "originBatchId", "presence", "currentSiteId", "currentLocationId", "qcState", "saleState",
           "condition", "boxCondition", "boxProfile", "conditionNote", "outReason", "labelPrintCount", "labelVerifiedAt", "version", "observedAt"
    FROM "WarehouseUnit" WHERE "id" = ${unitId.toLowerCase()} FOR UPDATE`);
  if (!rows[0]) throw notFound("Paire", { unitId });
  return rows[0];
}

export function assertExpectedVersion(unit: UnitRow, expectedVersion?: number | null): void {
  if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== unit.version) {
    throw conflict("VERSION_CONFLICT", "La paire a changé depuis l'affichage : relire sa fiche avant de corriger.", {
      expectedVersion,
      currentVersion: unit.version,
    });
  }
}

/**
 * Move one unit of occupancy. Locations are updated in id order (no deadlock between two
 * opposite moves). The destination increment is conditional and atomic: under READ COMMITTED
 * the predicate is re-evaluated after any lock wait, so two stations can never both take the
 * last place.
 *
 * consumeReservation: the unit holds a RESERVED putaway task on `toId` (reserved → occupied).
 * force: record reality (stock-take, found pair, admin correction) even if blocked / over capacity.
 */
export async function moveOccupancyTx(
  tx: WarehouseTx,
  input: { fromId: string | null; toId: string | null; consumeReservation?: boolean; force?: boolean }
): Promise<{ overCapacity: boolean }> {
  const { fromId, toId } = input;
  if (fromId === toId) return { overCapacity: false };
  let overCapacity = false;
  const ops = [
    ...(fromId ? [{ id: fromId, dir: -1 as const }] : []),
    ...(toId ? [{ id: toId, dir: 1 as const }] : []),
  ].sort((a, b) => (a.id < b.id ? -1 : 1));

  for (const op of ops) {
    if (op.dir === -1) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "WarehouseLocation" SET "occupiedCount" = GREATEST("occupiedCount" - 1, 0), "updatedAt" = now()
        WHERE "id" = ${op.id}`);
      continue;
    }
    const consume = input.consumeReservation ? 1 : 0;
    const updated = await tx.$queryRaw<{ capacity: number | null; occupiedCount: number; reservedCount: number }[]>(Prisma.sql`
      UPDATE "WarehouseLocation"
      SET "occupiedCount" = "occupiedCount" + 1,
          "reservedCount" = GREATEST("reservedCount" - ${consume}, 0),
          "updatedAt" = now()
      WHERE "id" = ${op.id} AND "holdsUnits" = true AND "status" <> 'RETIRED'
        AND (${Boolean(input.force)} OR (
          "status" = 'ACTIVE'
          AND ("capacity" IS NULL OR "occupiedCount" + "reservedCount" - ${consume} < "capacity")))
      RETURNING "capacity", "occupiedCount", "reservedCount"`);
    if (updated.length === 0) {
      const loc = await tx.$queryRaw<{ code: string; status: string; holdsUnits: boolean; capacity: number | null; occupiedCount: number; reservedCount: number }[]>(
        Prisma.sql`SELECT "code", "status", "holdsUnits", "capacity", "occupiedCount", "reservedCount" FROM "WarehouseLocation" WHERE "id" = ${op.id}`
      );
      const l = loc[0];
      if (!l) throw notFound("Emplacement");
      if (!l.holdsUnits) throw conflict("LOCATION_NOT_USABLE", `${l.code} est un repère de structure, pas un emplacement de paires.`);
      if (l.status !== "ACTIVE") {
        throw conflict("LOCATION_NOT_USABLE", `${l.code} est ${l.status === "BLOCKED" ? "bloqué" : "retiré"} : choisir un autre emplacement.`, {
          locationStatus: l.status,
        });
      }
      throw conflict("LEVEL_FULL", `${l.code} est plein (${l.occupiedCount} occupées + ${l.reservedCount} réservées / ${l.capacity}).`, {
        capacity: l.capacity,
        occupiedCount: l.occupiedCount,
        reservedCount: l.reservedCount,
      });
    }
    const u = updated[0];
    if (u.capacity !== null && u.occupiedCount + u.reservedCount > u.capacity) overCapacity = true;
  }
  return { overCapacity };
}

export type MovementInput = {
  type: MovementType;
  reason?: string | null;
  note?: string | null;
  changes?: Record<string, unknown> | null;
  batchId?: string | null;
  taskId?: string | null;
  transferId?: string | null;
  /** When the fact was observed on the floor (defaults to now). */
  observedAt?: Date | null;
};

export type UnitPatch = Partial<
  Pick<
    UnitRow,
    | "itemId"
    | "ownerKind"
    | "ownerPartnerId"
    | "agreementId"
    | "presence"
    | "currentSiteId"
    | "currentLocationId"
    | "qcState"
    | "saleState"
    | "condition"
    | "boxCondition"
    | "boxProfile"
    | "conditionNote"
    | "outReason"
    | "labelVerifiedAt"
  >
> & { labelPrintIncrement?: number; outAt?: Date | null };

/**
 * Write the new current state and its movement together (same transaction, version + 1).
 * Occupancy counters are moved by the caller (moveOccupancyTx) before calling this.
 */
export async function applyUnitChangeTx(
  tx: WarehouseTx,
  unit: UnitRow,
  patch: UnitPatch,
  movement: MovementInput,
  ctx: ActorContext,
  opKey: string | null
): Promise<UnitRow> {
  const lastObserved = new Date(unit.observedAt).getTime();
  // A live gesture is "now"; it never loses against the stored constat because of a clock skew
  // between the application and the database server.
  const observedAt = movement.observedAt ?? new Date(Math.max(Date.now(), lastObserved + 1));
  const movesLocation =
    (patch.currentLocationId !== undefined && patch.currentLocationId !== unit.currentLocationId) ||
    (patch.presence !== undefined && patch.presence !== unit.presence);
  // C43: an explicitly dated, older observation (late sync) must not overwrite a newer confirmed one.
  if (movesLocation && movement.observedAt && observedAt.getTime() < lastObserved) {
    throw conflict("VERSION_CONFLICT", "Un constat plus récent existe déjà pour cette paire : ce relevé antérieur n'écrase pas l'état courant.", {
      currentObservedAt: iso(unit.observedAt),
    });
  }
  const { labelPrintIncrement, ...fields } = patch;
  const next: UnitRow = { ...unit, ...fields, version: unit.version + 1, observedAt: movesLocation ? observedAt : unit.observedAt };
  if (labelPrintIncrement) next.labelPrintCount = unit.labelPrintCount + labelPrintIncrement;

  const updated = await tx.$executeRaw(Prisma.sql`
    UPDATE "WarehouseUnit" SET
      "itemId" = ${next.itemId}, "ownerKind" = ${next.ownerKind}, "ownerPartnerId" = ${next.ownerPartnerId},
      "agreementId" = ${next.agreementId}, "presence" = ${next.presence}, "currentSiteId" = ${next.currentSiteId},
      "currentLocationId" = ${next.currentLocationId}, "qcState" = ${next.qcState}, "saleState" = ${next.saleState},
      "condition" = ${next.condition}, "boxCondition" = ${next.boxCondition}, "boxProfile" = ${next.boxProfile}, "conditionNote" = ${next.conditionNote},
      "outReason" = ${next.outReason},
      "outAt" = ${patch.outAt === undefined ? Prisma.sql`"outAt"` : patch.outAt},
      "labelVerifiedAt" = ${next.labelVerifiedAt}, "labelPrintCount" = ${next.labelPrintCount},
      "version" = ${next.version}, "observedAt" = ${next.observedAt}, "updatedAt" = now()
    WHERE "id" = ${unit.id} AND "version" = ${unit.version}`);
  if (updated !== 1) {
    throw conflict("VERSION_CONFLICT", "La paire a été modifiée par une autre action : réessayer.", { unitId: unit.id });
  }
  await insertMovementTx(tx, {
    unitId: unit.id,
    fromSiteId: unit.currentSiteId,
    fromLocationId: unit.currentLocationId,
    toSiteId: next.currentSiteId,
    toLocationId: next.currentLocationId,
    unitVersion: next.version,
    observedAt,
    movement,
    ctx,
    opKey,
  });
  return next;
}

export async function insertMovementTx(
  tx: WarehouseTx,
  m: {
    unitId: string;
    fromSiteId: string | null;
    fromLocationId: string | null;
    toSiteId: string | null;
    toLocationId: string | null;
    unitVersion: number;
    observedAt: Date;
    movement: MovementInput;
    ctx: ActorContext;
    opKey: string | null;
  }
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "WarehouseMovement"
      ("id", "unitId", "type", "fromSiteId", "fromLocationId", "toSiteId", "toLocationId", "changes", "reason", "note",
       "operatorId", "actorRole", "stationId", "batchId", "taskId", "transferId", "opKey", "unitVersion", "observedAt")
    VALUES
      (${randomUUID()}, ${m.unitId}, ${m.movement.type}, ${m.fromSiteId}, ${m.fromLocationId}, ${m.toSiteId}, ${m.toLocationId},
       ${m.movement.changes ? JSON.stringify(m.movement.changes) : null}::jsonb, ${m.movement.reason ?? null}, ${m.movement.note ?? null},
       ${m.ctx.operatorId ?? null}, ${m.ctx.role}, ${m.ctx.stationId ?? null}, ${m.movement.batchId ?? null},
       ${m.movement.taskId ?? null}, ${m.movement.transferId ?? null}, ${m.opKey}, ${m.unitVersion}, ${m.observedAt})`);
}

/**
 * Cancel the active putaway task of a unit (if any) and give its reserved place back.
 * Used whenever the pair leaves the putaway flow (relocated by hand, missing, quarantine, out).
 */
export async function releaseActiveTaskTx(tx: WarehouseTx, unitId: string, reason: string): Promise<string | null> {
  const tasks = await tx.$queryRaw<{ id: string; status: string; proposedLocationId: string | null }[]>(Prisma.sql`
    UPDATE "WarehousePutawayTask" t
    SET "status" = 'CANCELLED', "cancelReason" = ${reason}, "updatedAt" = now()
    FROM (SELECT "id", "status", "proposedLocationId" FROM "WarehousePutawayTask"
          WHERE "unitId" = ${unitId} AND "status" IN ('PENDING', 'RESERVED') FOR UPDATE) old
    WHERE t."id" = old."id"
    RETURNING t."id", old."status", old."proposedLocationId"`);
  const task = tasks[0];
  if (!task) return null;
  if (task.status === "RESERVED" && task.proposedLocationId) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseLocation" SET "reservedCount" = GREATEST("reservedCount" - 1, 0), "updatedAt" = now()
      WHERE "id" = ${task.proposedLocationId}`);
  }
  return task.id;
}

export type CreateUnitInput = {
  siteId: string;
  siteCode: string;
  itemId: string;
  ownerKind: OwnerKind;
  ownerPartnerId?: string | null;
  agreementId?: string | null;
  originType: UnitOrigin;
  originBatchId?: string | null;
  originLineId?: string | null;
  locationId: string;
  /** Record reality even when the level is blocked / over capacity (stock-take). */
  forceOccupancy?: boolean;
  condition?: UnitCondition;
  boxCondition?: BoxCondition;
  /** Box format (default STANDARD): decides which levels are proposed (A37). */
  boxProfile?: string | null;
  conditionNote?: string | null;
  qcState?: UnitQcState;
  saleState?: UnitSaleState;
  observedAt?: Date | null;
  movementType: "RECEIVE" | "STOCK_TAKE";
  note?: string | null;
  /** Test seam: lets a test force a collision. Production uses the platform generator. */
  generateId?: () => string;
};

/**
 * Issue a new permanent identity: unit row + label registry + issuance journal + first movement,
 * all in the caller's transaction. A UUID collision (unit id or any registered code) is detected
 * by the database and a new UUID is drawn before anything is printed.
 */
export async function createUnitTx(
  tx: WarehouseTx,
  input: CreateUnitInput,
  ctx: ActorContext,
  opKey: string | null
): Promise<{ unit: UnitRow; overCapacity: boolean; collisions: number }> {
  if (input.ownerKind === "PARTNER" && !input.ownerPartnerId) throw invalid("Déposant requis pour une paire de partenaire.");
  if (input.ownerKind !== "PARTNER" && input.ownerPartnerId) throw invalid("Un déposant n'est renseigné que pour une paire de partenaire.");
  assertSiteInPilot(input.siteCode);
  const observedAt = input.observedAt ?? new Date();
  const generate = input.generateId ?? randomUUID;

  let unitId: string | null = null;
  let labelCode = "";
  let collisions = 0;
  for (let attempt = 0; attempt < 6 && !unitId; attempt += 1) {
    const candidate = generate().toLowerCase();
    if (!isUuidV4(candidate)) throw new WarehouseError("INVALID_INPUT", "Le générateur n'a pas produit un UUID v4.", 500);
    const code = buildUnitLabelCode(candidate, input.siteCode);
    // The registry also holds aliases: a code that ever designated a pair is never issued again.
    const taken = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n FROM "WarehouseLabelCode" WHERE "code" = ${code}`);
    if (taken[0].n > 0) {
      collisions += 1;
      continue;
    }
    const inserted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO "WarehouseUnit"
        ("id", "labelCode", "issuingSiteId", "issuingSiteCode", "itemId", "ownerKind", "ownerPartnerId", "agreementId",
         "originType", "originBatchId", "originLineId", "presence", "currentSiteId", "currentLocationId",
         "qcState", "saleState", "condition", "boxCondition", "boxProfile", "conditionNote", "observedAt", "receivedAt")
      VALUES
        (${candidate}, ${code}, ${input.siteId}, ${input.siteCode}, ${input.itemId}, ${input.ownerKind},
         ${input.ownerPartnerId ?? null}, ${input.agreementId ?? null}, ${input.originType}, ${input.originBatchId ?? null},
         ${input.originLineId ?? null}, 'PRESENT', ${input.siteId}, ${input.locationId},
         ${input.qcState ?? "PENDING"}, ${input.saleState ?? "STORAGE_ONLY"}, ${input.condition ?? "UNKNOWN"},
         ${input.boxCondition ?? "UNKNOWN"}, ${normalizeBoxProfile(input.boxProfile)}, ${input.conditionNote ?? null}, ${observedAt}, now())
      ON CONFLICT ("id") DO NOTHING
      RETURNING "id"`);
    if (inserted.length === 0) {
      collisions += 1;
      continue;
    }
    unitId = candidate;
    labelCode = code;
  }
  if (!unitId) throw new WarehouseError("CONFLICT", "Impossible d'attribuer un identifiant unique : réessayer.", 500, { collisions });

  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "WarehouseLabelCode" ("code", "unitId", "format", "isOriginal", "issuingSiteCode")
    VALUES (${labelCode}, ${unitId}, ${UNIT_LABEL_FORMAT_V1}, true, ${input.siteCode})`);

  // Issuance journal: enough context to find the pair again if the primary disk is lost (C01).
  const payload = {
    v: 1,
    code: labelCode,
    unitId,
    format: UNIT_LABEL_FORMAT_V1,
    issuingSiteCode: input.siteCode,
    itemId: input.itemId,
    ownerKind: input.ownerKind,
    ownerPartnerId: input.ownerPartnerId ?? null,
    originType: input.originType,
    originBatchId: input.originBatchId ?? null,
    locationId: input.locationId,
    issuedAt: new Date().toISOString(),
  };
  const payloadJson = JSON.stringify(payload);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "WarehouseLabelJournal" ("code", "unitId", "payload", "payloadHash")
    VALUES (${labelCode}, ${unitId}, ${payloadJson}::jsonb, ${createHash("sha256").update(payloadJson).digest("hex")})`);

  const { overCapacity } = await moveOccupancyTx(tx, { fromId: null, toId: input.locationId, force: input.forceOccupancy });

  await insertMovementTx(tx, {
    unitId,
    fromSiteId: null,
    fromLocationId: null,
    toSiteId: input.siteId,
    toLocationId: input.locationId,
    unitVersion: 1,
    observedAt,
    movement: { type: input.movementType, batchId: input.originBatchId ?? null, note: input.note ?? null },
    ctx,
    opKey,
  });

  return { unit: await lockUnitTx(tx, unitId), overCapacity, collisions };
}

// ───────────────────────────── Gestures on an existing unit ─────────────────────────────

/** Box format token: STANDARD unless told otherwise; free vocabulary kept short and upper-case (LARGE, BOOT, …). */
export function normalizeBoxProfile(value: string | null | undefined): string {
  const v = String(value ?? "").trim().toUpperCase();
  if (!v) return "STANDARD";
  if (!/^[A-Z0-9_]{2,16}$/.test(v)) throw invalid("Format de boîte : 2 à 16 lettres ou chiffres (STANDARD, LARGE…).");
  return v;
}

type GestureBase = { opKey: string; unitId: string; expectedVersion?: number | null; reason?: string | null; note?: string | null };

function requireReason(reason: string | null | undefined, what: string): string {
  const r = String(reason ?? "").trim();
  if (r.length < 3) throw invalid(`Motif requis pour ${what}.`);
  return r;
}

async function done<E extends Record<string, unknown> = Record<string, never>>(
  tx: WarehouseTx,
  unitId: string,
  extra?: E
): Promise<{ unit: UnitSummary } & E> {
  return { unit: await getUnitSummary(tx, unitId), ...(extra ?? ({} as E)) };
}

/** Control result: PASSED, back to PENDING, or QUARANTINE (always excluded from sale). */
export async function setUnitQcState(
  db: WarehouseDb,
  input: GestureBase & { qcState: UnitQcState },
  ctx: ActorContext
): Promise<OperationResult<{ unit: UnitSummary }>> {
  if (!["PENDING", "PASSED", "QUARANTINE"].includes(input.qcState)) throw invalid("État de contrôle invalide.");
  return runOperation(db, { opKey: input.opKey, kind: "UNIT_QC", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    assertExpectedVersion(unit, input.expectedVersion);
    if (unit.qcState === input.qcState) return done(tx, unit.id);
    if (input.qcState === "QUARANTINE") requireReason(input.reason, "une mise en quarantaine");
    // Quarantine removes the sale right; leaving quarantine does not give it back by itself.
    const saleState: UnitSaleState = input.qcState === "QUARANTINE" ? "BLOCKED" : unit.saleState;
    await applyUnitChangeTx(
      tx,
      unit,
      { qcState: input.qcState, saleState },
      { type: "QC", reason: input.reason, note: input.note, changes: { qcState: [unit.qcState, input.qcState], saleState: [unit.saleState, saleState] } },
      ctx,
      input.opKey
    );
    return done(tx, unit.id);
  });
}

/**
 * Sale authorization. Storage-only is the default; authorizing requires a passed control, a
 * confirmed (non provisional) variant, a known owner and — for a deposit — an active agreement
 * that allows sale. Lot 1 publishes nothing: this is an internal state only.
 */
export async function setUnitSaleState(
  db: WarehouseDb,
  input: GestureBase & { saleState: UnitSaleState },
  ctx: ActorContext
): Promise<OperationResult<{ unit: UnitSummary }>> {
  if (!["STORAGE_ONLY", "SALE_AUTHORIZED", "BLOCKED"].includes(input.saleState)) throw invalid("État de vente invalide.");
  if (ctx.role !== "admin" && ctx.role !== "system") {
    throw new WarehouseError("FORBIDDEN", "L'autorisation de vente est réservée au gestionnaire.", 403);
  }
  return runOperation(db, { opKey: input.opKey, kind: "UNIT_SALE_STATE", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    assertExpectedVersion(unit, input.expectedVersion);
    if (unit.saleState === input.saleState) return done(tx, unit.id);
    if (input.saleState === "SALE_AUTHORIZED") {
      const blockers: string[] = [];
      if (unit.qcState !== "PASSED") blockers.push("contrôle non validé");
      if (unit.ownerKind === "UNKNOWN") blockers.push("propriétaire à confirmer");
      if (unit.presence !== "PRESENT") blockers.push("paire non présente");
      const item = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT "status" FROM "WarehouseItem" WHERE "id" = ${unit.itemId}`);
      if (item[0]?.status !== "ACTIVE") blockers.push("variante provisoire à confirmer");
      if (unit.ownerKind === "PARTNER") {
        const agreement = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT "id" FROM "WarehouseDepositAgreement"
          WHERE "partnerId" = ${unit.ownerPartnerId} AND "status" = 'ACTIVE' AND "saleAllowed" = true LIMIT 1`);
        if (!agreement[0]) blockers.push("pas d'accord de dépôt actif autorisant la vente");
      }
      if (blockers.length) {
        throw conflict("UNIT_STATE_CONFLICT", `Vente non autorisable : ${blockers.join(", ")}.`, { blockers });
      }
    } else if (input.saleState === "BLOCKED") {
      requireReason(input.reason, "un blocage de vente");
    }
    await applyUnitChangeTx(
      tx,
      unit,
      { saleState: input.saleState },
      { type: "SALE_STATE", reason: input.reason, note: input.note, changes: { saleState: [unit.saleState, input.saleState] } },
      ctx,
      input.opKey
    );
    return done(tx, unit.id);
  });
}

/** Physical condition of the pair and of its box, recorded separately (A18). */
export async function setUnitCondition(
  db: WarehouseDb,
  input: GestureBase & { condition?: UnitCondition; boxCondition?: BoxCondition; boxProfile?: string | null; conditionNote?: string | null },
  ctx: ActorContext
): Promise<OperationResult<{ unit: UnitSummary }>> {
  return runOperation(db, { opKey: input.opKey, kind: "UNIT_CONDITION", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    assertExpectedVersion(unit, input.expectedVersion);
    const condition = input.condition ?? unit.condition;
    const boxCondition = input.boxCondition ?? unit.boxCondition;
    const boxProfile = input.boxProfile === undefined || input.boxProfile === null ? unit.boxProfile : normalizeBoxProfile(input.boxProfile);
    const conditionNote = input.conditionNote === undefined ? unit.conditionNote : input.conditionNote?.trim() || null;
    await applyUnitChangeTx(
      tx,
      unit,
      { condition, boxCondition, boxProfile, conditionNote },
      {
        type: "CONDITION",
        reason: input.reason,
        note: input.note,
        changes: {
          condition: [unit.condition, condition],
          boxCondition: [unit.boxCondition, boxCondition],
          ...(boxProfile !== unit.boxProfile ? { boxProfile: [unit.boxProfile, boxProfile] } : {}),
        },
      },
      ctx,
      input.opKey
    );
    return done(tx, unit.id);
  });
}

/**
 * Owner correction (admin, with reason). The identity and the QR do not change; validated prices
 * are superseded and the sale right goes back to storage-only: nothing agreed with the previous
 * owner is carried over (A02, B47).
 */
export async function changeUnitOwner(
  db: WarehouseDb,
  input: GestureBase & { ownerKind: OwnerKind; ownerPartnerId?: string | null },
  ctx: ActorContext
): Promise<OperationResult<{ unit: UnitSummary }>> {
  if (ctx.role !== "admin" && ctx.role !== "system") {
    throw new WarehouseError("FORBIDDEN", "Le changement de propriétaire est réservé au gestionnaire.", 403);
  }
  const reason = requireReason(input.reason, "un changement de propriétaire");
  if (input.ownerKind === "PARTNER" && !input.ownerPartnerId) throw invalid("Déposant requis.");
  const ownerPartnerId = input.ownerKind === "PARTNER" ? (input.ownerPartnerId as string) : null;
  return runOperation(db, { opKey: input.opKey, kind: "UNIT_OWNER", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    assertExpectedVersion(unit, input.expectedVersion);
    if (unit.ownerKind === input.ownerKind && unit.ownerPartnerId === ownerPartnerId) return done(tx, unit.id);
    if (ownerPartnerId) {
      const p = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Partner" WHERE "id" = ${ownerPartnerId}`);
      if (!p[0]) throw notFound("Partenaire");
    }
    const active = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "WarehouseSaleAllocation" WHERE "unitId" = ${unit.id} AND "status" = 'ACTIVE'`);
    if (active[0]) throw conflict("ALREADY_ALLOCATED", "Paire engagée sur une vente : traiter la réservation avant de changer le propriétaire.");
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseUnitPrice" SET "status" = 'SUPERSEDED', "updatedAt" = now()
      WHERE "unitId" = ${unit.id} AND "status" IN ('PROPOSED', 'VALIDATED')`);
    await applyUnitChangeTx(
      tx,
      unit,
      { ownerKind: input.ownerKind, ownerPartnerId, agreementId: null, saleState: unit.saleState === "SALE_AUTHORIZED" ? "STORAGE_ONLY" : unit.saleState },
      {
        type: "OWNER_CHANGE",
        reason,
        note: input.note,
        changes: { ownerKind: [unit.ownerKind, input.ownerKind], ownerPartnerId: [unit.ownerPartnerId, ownerPartnerId] },
      },
      ctx,
      input.opKey
    );
    return done(tx, unit.id);
  });
}

/**
 * Variant correction (wrong size received, renamed / merged reference — A14, A17). Same UUID,
 * same QR. Prices of the old variant never follow: they are superseded and sale is suspended.
 */
export async function correctUnitItem(
  db: WarehouseDb,
  input: GestureBase & { itemId: string },
  ctx: ActorContext
): Promise<OperationResult<{ unit: UnitSummary }>> {
  const reason = requireReason(input.reason, "une correction de variante");
  return runOperation(db, { opKey: input.opKey, kind: "UNIT_ITEM", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    assertExpectedVersion(unit, input.expectedVersion);
    if (unit.itemId === input.itemId) return done(tx, unit.id);
    const item = await tx.$queryRaw<{ id: string; status: string }[]>(Prisma.sql`SELECT "id", "status" FROM "WarehouseItem" WHERE "id" = ${input.itemId}`);
    if (!item[0] || item[0].status === "MERGED") throw notFound("Article");
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseUnitPrice" SET "status" = 'SUPERSEDED', "updatedAt" = now()
      WHERE "unitId" = ${unit.id} AND "status" IN ('PROPOSED', 'VALIDATED')`);
    await applyUnitChangeTx(
      tx,
      unit,
      { itemId: input.itemId, saleState: unit.saleState === "SALE_AUTHORIZED" ? "STORAGE_ONLY" : unit.saleState },
      { type: "ITEM_CORRECTION", reason, note: input.note, changes: { itemId: [unit.itemId, input.itemId] } },
      ctx,
      input.opKey
    );
    return done(tx, unit.id);
  });
}

/**
 * "Paire introuvable" — the pair leaves internal availability explicitly (presence MISSING),
 * its place and any reservation are released, an exception is opened. Nothing is deleted.
 */
export async function markUnitMissing(db: WarehouseDb, input: GestureBase, ctx: ActorContext): Promise<OperationResult<{ unit: UnitSummary; exceptionId: string | null }>> {
  const reason = requireReason(input.reason, "une paire introuvable");
  return runOperation(db, { opKey: input.opKey, kind: "UNIT_MISSING", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    assertExpectedVersion(unit, input.expectedVersion);
    if (unit.presence === "MISSING") return done(tx, unit.id, { exceptionId: null });
    if (unit.presence !== "PRESENT") {
      throw conflict("UNIT_NOT_PRESENT", "Seule une paire présente peut être déclarée introuvable.", { presence: unit.presence });
    }
    await releaseActiveTaskTx(tx, unit.id, "MISSING");
    await moveOccupancyTx(tx, { fromId: unit.currentLocationId, toId: null });
    await applyUnitChangeTx(
      tx,
      unit,
      { presence: "MISSING", currentLocationId: null },
      { type: "MARK_MISSING", reason, note: input.note },
      ctx,
      input.opKey
    );
    const exceptionId = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WarehouseException" ("id", "siteId", "type", "unitId", "locationId", "details", "createdByRole", "createdByOperatorId", "opKey")
      VALUES (${exceptionId}, ${unit.currentSiteId}, 'UNIT_NOT_FOUND', ${unit.id}, ${unit.currentLocationId},
              ${JSON.stringify({ reason, lastLocationId: unit.currentLocationId })}::jsonb, ${ctx.role}, ${ctx.operatorId ?? null}, ${`${input.opKey}:exc`})`);
    return done(tx, unit.id, { exceptionId });
  });
}

/**
 * Two boxes carry the same QR (a label printed twice and stuck on two boxes, or a copied label).
 * The code keeps designating the one recorded pair; it is isolated — sale blocked, putaway task
 * released — and a DUPLICATE_LABEL discrepancy is opened. The second box is then received as a
 * NEW pair with its own UUID; nothing is re-attributed before somebody checked both boxes (A28).
 */
export async function reportDuplicateLabel(
  db: WarehouseDb,
  input: GestureBase & { seenAtLocationId?: string | null },
  ctx: ActorContext
): Promise<OperationResult<{ unit: UnitSummary; exceptionId: string }>> {
  return runOperation(db, { opKey: input.opKey, kind: "UNIT_DUPLICATE_LABEL", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    assertExpectedVersion(unit, input.expectedVersion);
    const releasedTaskId = unit.presence === "PRESENT" ? await releaseActiveTaskTx(tx, unit.id, "DUPLICATE_LABEL") : null;
    await applyUnitChangeTx(
      tx,
      unit,
      { saleState: "BLOCKED" },
      {
        type: "SALE_STATE",
        reason: "Étiquette vue sur deux boîtes",
        note: input.note,
        changes: { saleState: [unit.saleState, "BLOCKED"], duplicateLabel: true, releasedTaskId, seenAtLocationId: input.seenAtLocationId ?? null },
      },
      ctx,
      input.opKey
    );
    const exceptionId = await openExceptionTx(
      tx,
      {
        siteId: unit.currentSiteId,
        type: "DUPLICATE_LABEL",
        unitId: unit.id,
        locationId: input.seenAtLocationId ?? unit.currentLocationId,
        rawCode: unit.labelCode,
        details: { note: input.note ?? null, recordedLocationId: unit.currentLocationId, previousSaleState: unit.saleState },
        opKey: `${input.opKey}:dup`,
      },
      ctx
    );
    return done(tx, unit.id, { exceptionId });
  });
}

/**
 * Definitive exit (withdrawn by the depositor, returned to supplier, disposed…). The QR keeps
 * resolving to this record forever; a later re-entry is a new validated entry, not a silent undo.
 * A sale exit (SOLD) belongs to lot 2 and is refused here unless called by the system seam.
 */
export async function markUnitOut(
  db: WarehouseDb,
  input: GestureBase & { outReason: UnitOutReason },
  ctx: ActorContext
): Promise<OperationResult<{ unit: UnitSummary }>> {
  const reason = requireReason(input.reason, "une sortie de stock");
  if (!["SOLD", "WITHDRAWN", "RETURNED_TO_SUPPLIER", "DISPOSED", "OTHER"].includes(input.outReason)) throw invalid("Motif de sortie invalide.");
  if (ctx.role !== "admin" && ctx.role !== "system") {
    throw new WarehouseError("FORBIDDEN", "La sortie de stock est réservée au gestionnaire.", 403);
  }
  return runOperation(db, { opKey: input.opKey, kind: "UNIT_OUT", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    assertExpectedVersion(unit, input.expectedVersion);
    if (unit.presence === "OUT") return done(tx, unit.id);
    const active = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "WarehouseSaleAllocation" WHERE "unitId" = ${unit.id} AND "status" = 'ACTIVE'`);
    if (active[0] && input.outReason !== "SOLD") {
      throw conflict("ALREADY_ALLOCATED", "Paire engagée sur une vente : traiter la réservation avant la sortie.");
    }
    await releaseActiveTaskTx(tx, unit.id, "OUT");
    if (unit.presence === "PRESENT") await moveOccupancyTx(tx, { fromId: unit.currentLocationId, toId: null });
    await applyUnitChangeTx(
      tx,
      unit,
      { presence: "OUT", currentLocationId: null, currentSiteId: unit.currentSiteId, outReason: input.outReason, outAt: new Date(), saleState: "BLOCKED" },
      { type: "OUT", reason, note: input.note, changes: { outReason: input.outReason } },
      ctx,
      input.opKey
    );
    return done(tx, unit.id);
  });
}

/** Attach an external reference (supplier return code, StockX order, carrier ref) to a pair. */
export async function addUnitExternalRef(
  db: WarehouseDb,
  input: { unitId: string; namespace: string; value: string; note?: string | null }
): Promise<{ added: boolean }> {
  assertWritesEnabled();
  const namespace = String(input.namespace ?? "").trim().toUpperCase();
  const value = String(input.value ?? "").trim();
  if (!/^[A-Z0-9_]{2,32}$/.test(namespace) || !value || value.length > 200) throw invalid("Référence externe invalide.");
  await getUnitSummary(db, input.unitId);
  const existing = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "WarehouseUnitExternalRef" WHERE "unitId" = ${input.unitId} AND "namespace" = ${namespace} AND "value" = ${value}`);
  if (existing[0]) return { added: false };
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "WarehouseUnitExternalRef" ("id", "unitId", "namespace", "value", "note")
    VALUES (${randomUUID()}, ${input.unitId}, ${namespace}, ${value}, ${input.note?.trim() || null})`);
  return { added: true };
}
