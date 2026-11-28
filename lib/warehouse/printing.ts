import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { isLabelJournalEnforced, printClaimTimeoutSeconds } from "./config";
import { withTx, type WarehouseConn, type WarehouseDb, type WarehouseTx } from "./db";
import { conflict, invalid, isUniqueViolation, notFound } from "./errors";
import { openExceptionTx } from "./exceptions";
import { LABEL_PROFILES, type LabelPayload, type LocationLabelPayload, type PairLabelPayload } from "./labels";
import { assertValidOpKey, assertWritesEnabled, runOperation, type OperationResult } from "./operations";
import type { ActorContext, LabelKind, PrintJobKind, PrintJobStatus, PrinterAdapter } from "./types";
import { applyUnitChangeTx, lockUnitTx } from "./units";

/**
 * Stations, printers, routing and durable print jobs.
 *
 * - A station (poste) belongs to one site and is independent of the operator account. It is
 *   paired with a secret token; the browser at that desk is the print agent (existing QZ Tray
 *   chain) and only ever receives the jobs of ITS station → a scan at station A cannot print
 *   at station B.
 * - A job is written in the same transaction as the gesture that needs it (C09) and is unique
 *   per action key: a double click or a network retry never creates a second job.
 * - QUEUED → CLAIMED (atomic, one agent) → SENT (spooler accepted — not a proof of paper) →
 *   CONFIRMED (label scanned back / operator confirmed). FAILED = refused before sending.
 *   A claimed job with no answer becomes UNCERTAIN and is NEVER re-sent automatically (C10/C12):
 *   an operator checks the paper, then explicitly reprints the same QR.
 * - Reprint = a new explicit job on the same code, with a reason and a trace. Never a new unit.
 */

const LABEL_KINDS: LabelKind[] = ["PAIR", "LOCATION", "PARCEL", "SHIPPING", "RETURN"];
/** Kinds this module prints in lot 1. PARCEL / SHIPPING / RETURN keep the existing carrier circuit. */
const PRINTABLE_KINDS: PrintJobKind[] = ["PAIR", "LOCATION", "TEST"];

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

// ───────────────────────────── Stations ─────────────────────────────

export type StationRow = {
  id: string;
  siteId: string;
  siteCode: string;
  code: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
  paired: boolean;
  pairedAt: string | null;
  lastSeenAt: string | null;
  routes: { labelKind: LabelKind; printerId: string; printerName: string; printerStatus: string; fallbackPrinterId: string | null; fallbackPrinterName: string | null }[];
};

export async function listStations(conn: WarehouseConn, siteId?: string): Promise<StationRow[]> {
  const stations = await conn.$queryRaw<any[]>(Prisma.sql`
    SELECT st."id", st."siteId", s."code" AS "siteCode", st."code", st."name", st."status",
           (st."tokenHash" IS NOT NULL) AS "paired", st."pairedAt", st."lastSeenAt"
    FROM "WarehouseStation" st JOIN "WarehouseSite" s ON s."id" = st."siteId"
    ${siteId ? Prisma.sql`WHERE st."siteId" = ${siteId}` : Prisma.empty}
    ORDER BY st."code"`);
  if (stations.length === 0) return [];
  const routes = await conn.$queryRaw<any[]>(Prisma.sql`
    SELECT r."stationId", r."labelKind", r."printerId", p."name" AS "printerName", p."status" AS "printerStatus",
           r."fallbackPrinterId", f."name" AS "fallbackPrinterName"
    FROM "WarehouseStationRoute" r
    JOIN "WarehousePrinter" p ON p."id" = r."printerId"
    LEFT JOIN "WarehousePrinter" f ON f."id" = r."fallbackPrinterId"
    WHERE r."stationId" IN (${Prisma.join(stations.map((s) => s.id))})
    ORDER BY r."labelKind"`);
  return stations.map((s) => ({
    ...s,
    pairedAt: iso(s.pairedAt),
    lastSeenAt: iso(s.lastSeenAt),
    routes: routes.filter((r) => r.stationId === s.id).map(({ stationId: _s, ...r }) => r),
  }));
}

export async function getStation(conn: WarehouseConn, stationId: string): Promise<StationRow> {
  const rows = await conn.$queryRaw<{ siteId: string }[]>(Prisma.sql`SELECT "siteId" FROM "WarehouseStation" WHERE "id" = ${stationId}`);
  if (!rows[0]) throw notFound("Poste");
  const all = await listStations(conn, rows[0].siteId);
  return all.find((s) => s.id === stationId) as StationRow;
}

export async function createStation(db: WarehouseDb, input: { siteId: string; code?: string; name: string }): Promise<StationRow> {
  assertWritesEnabled();
  const name = String(input.name ?? "").trim();
  if (!name) throw invalid("Nom du poste requis.");
  const site = await db.$queryRaw<{ id: string; code: string }[]>(Prisma.sql`SELECT "id", "code" FROM "WarehouseSite" WHERE "id" = ${input.siteId}`);
  if (!site[0]) throw notFound("Site");
  let code = String(input.code ?? "").trim().toUpperCase();
  if (!code) {
    const n = await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM "WarehouseStation" WHERE "siteId" = ${input.siteId}`);
    code = `${site[0].code}-P${n[0].n + 1}`;
  }
  if (!/^[A-Z0-9][A-Z0-9-]{1,23}$/.test(code)) throw invalid("Code de poste : lettres, chiffres et tirets (ex. CH01-P1).");
  const id = randomUUID();
  try {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "WarehouseStation" ("id", "siteId", "code", "name") VALUES (${id}, ${input.siteId}, ${code}, ${name})`);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("CONFLICT", `Le poste ${code} existe déjà.`);
    throw err;
  }
  return getStation(db, id);
}

export async function updateStation(
  db: WarehouseDb,
  stationId: string,
  patch: { name?: string; status?: "ACTIVE" | "DISABLED" }
): Promise<StationRow> {
  assertWritesEnabled();
  const current = await getStation(db, stationId);
  if (patch.status && !["ACTIVE", "DISABLED"].includes(patch.status)) throw invalid("Statut invalide.");
  await db.$executeRaw(Prisma.sql`
    UPDATE "WarehouseStation" SET "name" = ${patch.name?.trim() || current.name}, "status" = ${patch.status ?? current.status},
      -- Disabling a station revokes its pairing: an open tab at that desk stops working (C16).
      "tokenHash" = CASE WHEN ${patch.status ?? current.status} = 'DISABLED' THEN NULL ELSE "tokenHash" END,
      "updatedAt" = now()
    WHERE "id" = ${stationId}`);
  return getStation(db, stationId);
}

/**
 * (Re)pair a station: returns the secret ONCE; only its hash is stored. Pairing again revokes
 * the previous browser. The credential sent by the desk is `<stationId>.<token>`.
 */
export async function pairStation(db: WarehouseDb, stationId: string): Promise<{ station: StationRow; credential: string }> {
  assertWritesEnabled();
  const station = await getStation(db, stationId);
  if (station.status !== "ACTIVE") throw conflict("CONFLICT", "Poste désactivé : le réactiver avant l'appairage.");
  const token = randomBytes(24).toString("base64url");
  await db.$executeRaw(Prisma.sql`
    UPDATE "WarehouseStation" SET "tokenHash" = ${sha256(token)}, "pairedAt" = now(), "updatedAt" = now() WHERE "id" = ${stationId}`);
  return { station: await getStation(db, stationId), credential: `${stationId}.${token}` };
}

export async function unpairStation(db: WarehouseDb, stationId: string): Promise<StationRow> {
  assertWritesEnabled();
  await db.$executeRaw(Prisma.sql`
    UPDATE "WarehouseStation" SET "tokenHash" = NULL, "updatedAt" = now() WHERE "id" = ${stationId}`);
  return getStation(db, stationId);
}

/** Verify a desk credential. Returns the station (site-scoped) or null. Touches lastSeenAt at most once a minute. */
export async function authenticateStation(
  conn: WarehouseConn,
  credential: string | null | undefined
): Promise<{ id: string; siteId: string; siteCode: string; code: string; name: string } | null> {
  const raw = String(credential ?? "");
  const dot = raw.indexOf(".");
  if (dot < 1) return null;
  const stationId = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  if (!/^[0-9a-f-]{36}$/.test(stationId) || token.length < 16) return null;
  const rows = await conn.$queryRaw<{ id: string; siteId: string; siteCode: string; code: string; name: string; tokenHash: string | null; status: string; lastSeenAt: Date | null }[]>(
    Prisma.sql`SELECT st."id", st."siteId", s."code" AS "siteCode", st."code", st."name", st."tokenHash", st."status", st."lastSeenAt"
               FROM "WarehouseStation" st JOIN "WarehouseSite" s ON s."id" = st."siteId" WHERE st."id" = ${stationId}`
  );
  const st = rows[0];
  if (!st || st.status !== "ACTIVE" || !st.tokenHash) return null;
  const a = Buffer.from(sha256(token), "hex");
  const b = Buffer.from(st.tokenHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!st.lastSeenAt || Date.now() - new Date(st.lastSeenAt).getTime() > 60_000) {
    await conn.$executeRaw(Prisma.sql`UPDATE "WarehouseStation" SET "lastSeenAt" = now() WHERE "id" = ${st.id}`).catch(() => undefined);
  }
  return { id: st.id, siteId: st.siteId, siteCode: st.siteCode, code: st.code, name: st.name };
}

// ───────────────────────────── Printers & routes ─────────────────────────────

export type PrinterRow = {
  id: string;
  siteId: string;
  name: string;
  adapter: PrinterAdapter;
  systemName: string | null;
  mediaWidthMm: number;
  mediaHeightMm: number;
  dpi: number | null;
  orientation: string;
  marginMm: number;
  useDriverPaperSize: boolean;
  supportedKinds: string[];
  status: "ACTIVE" | "DISABLED";
  verifiedAt: string | null;
  verifiedNote: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

const PRINTER_COLUMNS = Prisma.sql`
  "id", "siteId", "name", "adapter", "systemName", "mediaWidthMm", "mediaHeightMm", "dpi", "orientation", "marginMm",
  "useDriverPaperSize", "supportedKinds", "status", "verifiedAt", "verifiedNote", "lastError", "lastErrorAt"`;

const toPrinter = (p: any): PrinterRow => ({ ...p, verifiedAt: iso(p.verifiedAt), lastErrorAt: iso(p.lastErrorAt) });

export async function listPrinters(conn: WarehouseConn, siteId?: string): Promise<PrinterRow[]> {
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`
    SELECT ${PRINTER_COLUMNS} FROM "WarehousePrinter" ${siteId ? Prisma.sql`WHERE "siteId" = ${siteId}` : Prisma.empty} ORDER BY "name"`);
  return rows.map(toPrinter);
}

export async function getPrinter(conn: WarehouseConn, printerId: string): Promise<PrinterRow> {
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`SELECT ${PRINTER_COLUMNS} FROM "WarehousePrinter" WHERE "id" = ${printerId}`);
  if (!rows[0]) throw notFound("Imprimante");
  return toPrinter(rows[0]);
}

export type PrinterInput = {
  siteId: string;
  name: string;
  adapter: PrinterAdapter;
  /** Exact OS / QZ printer name (required for QZ_TRAY). */
  systemName?: string | null;
  mediaWidthMm: number;
  mediaHeightMm: number;
  dpi?: number | null;
  orientation?: "portrait" | "landscape";
  marginMm?: number;
  useDriverPaperSize?: boolean;
  supportedKinds?: string[];
};

function validatePrinter(input: Partial<PrinterInput>): void {
  if (input.adapter !== undefined && !["QZ_TRAY", "PDF_MANUAL"].includes(input.adapter)) {
    throw invalid("Adaptateur supporté : QZ_TRAY (imprimante vue par le poste) ou PDF_MANUAL (secours).");
  }
  for (const k of ["mediaWidthMm", "mediaHeightMm"] as const) {
    const v = input[k];
    if (v !== undefined && (!Number.isFinite(v) || v < 10 || v > 300)) throw invalid("Format d'étiquette : 10 à 300 mm.");
  }
  if (input.dpi !== undefined && input.dpi !== null && (!Number.isInteger(input.dpi) || input.dpi < 100 || input.dpi > 1200)) {
    throw invalid("Résolution : 100 à 1200 dpi, ou vide.");
  }
  if (input.supportedKinds && input.supportedKinds.some((k) => !LABEL_KINDS.includes(k as LabelKind))) {
    throw invalid(`Types d'étiquette : ${LABEL_KINDS.join(", ")}.`);
  }
}

/** Add a compatible printer from the UI — no code change needed for a supported adapter. */
export async function createPrinter(db: WarehouseDb, input: PrinterInput): Promise<PrinterRow> {
  assertWritesEnabled();
  validatePrinter(input);
  const name = String(input.name ?? "").trim();
  if (!name) throw invalid("Nom de l'imprimante requis.");
  if (input.adapter === "QZ_TRAY" && !input.systemName?.trim()) throw invalid("Nom système de l'imprimante requis pour QZ Tray.");
  const id = randomUUID();
  try {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "WarehousePrinter"
        ("id", "siteId", "name", "adapter", "systemName", "mediaWidthMm", "mediaHeightMm", "dpi", "orientation", "marginMm",
         "useDriverPaperSize", "supportedKinds")
      VALUES
        (${id}, ${input.siteId}, ${name}, ${input.adapter}, ${input.systemName?.trim() || null}, ${input.mediaWidthMm},
         ${input.mediaHeightMm}, ${input.dpi ?? null}, ${input.orientation ?? "landscape"}, ${input.marginMm ?? 0},
         ${Boolean(input.useDriverPaperSize)}, ${input.supportedKinds?.length ? input.supportedKinds : ["PAIR", "LOCATION"]}::text[])`);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("CONFLICT", `Une imprimante « ${name} » existe déjà sur ce site.`);
    throw err;
  }
  return getPrinter(db, id);
}

export async function updatePrinter(
  db: WarehouseDb,
  printerId: string,
  patch: Partial<Omit<PrinterInput, "siteId">> & { status?: "ACTIVE" | "DISABLED" }
): Promise<PrinterRow> {
  assertWritesEnabled();
  validatePrinter(patch);
  const cur = await getPrinter(db, printerId);
  const mediaChanged =
    (patch.mediaWidthMm !== undefined && patch.mediaWidthMm !== cur.mediaWidthMm) ||
    (patch.mediaHeightMm !== undefined && patch.mediaHeightMm !== cur.mediaHeightMm) ||
    (patch.systemName !== undefined && (patch.systemName?.trim() || null) !== cur.systemName);
  await db.$executeRaw(Prisma.sql`
    UPDATE "WarehousePrinter" SET
      "name" = ${patch.name?.trim() || cur.name}, "adapter" = ${patch.adapter ?? cur.adapter},
      "systemName" = ${patch.systemName === undefined ? cur.systemName : patch.systemName?.trim() || null},
      "mediaWidthMm" = ${patch.mediaWidthMm ?? cur.mediaWidthMm}, "mediaHeightMm" = ${patch.mediaHeightMm ?? cur.mediaHeightMm},
      "dpi" = ${patch.dpi === undefined ? cur.dpi : patch.dpi}, "orientation" = ${patch.orientation ?? cur.orientation},
      "marginMm" = ${patch.marginMm ?? cur.marginMm}, "useDriverPaperSize" = ${patch.useDriverPaperSize ?? cur.useDriverPaperSize},
      "supportedKinds" = ${patch.supportedKinds ?? cur.supportedKinds}::text[], "status" = ${patch.status ?? cur.status},
      -- A changed format or device invalidates the physical verification (C13).
      "verifiedAt" = CASE WHEN ${mediaChanged} THEN NULL ELSE "verifiedAt" END,
      "verifiedNote" = CASE WHEN ${mediaChanged} THEN NULL ELSE "verifiedNote" END,
      "updatedAt" = now()
    WHERE "id" = ${printerId}`);
  return getPrinter(db, printerId);
}

/** The operator confirms a physical test label: right size, QR readable with the desk scanner. */
export async function markPrinterVerified(db: WarehouseDb, printerId: string, note?: string | null): Promise<PrinterRow> {
  assertWritesEnabled();
  await getPrinter(db, printerId);
  await db.$executeRaw(Prisma.sql`
    UPDATE "WarehousePrinter" SET "verifiedAt" = now(), "verifiedNote" = ${note?.trim().slice(0, 500) || null}, "updatedAt" = now()
    WHERE "id" = ${printerId}`);
  return getPrinter(db, printerId);
}

/** Default (and optional fallback) printer of a station for one label type. `printerId: null` removes the route. */
export async function setStationRoute(
  db: WarehouseDb,
  input: { stationId: string; labelKind: LabelKind; printerId: string | null; fallbackPrinterId?: string | null }
): Promise<StationRow> {
  assertWritesEnabled();
  if (!LABEL_KINDS.includes(input.labelKind)) throw invalid("Type d'étiquette invalide.");
  const station = await getStation(db, input.stationId);
  if (!input.printerId) {
    await db.$executeRaw(Prisma.sql`
      DELETE FROM "WarehouseStationRoute" WHERE "stationId" = ${station.id} AND "labelKind" = ${input.labelKind}`);
    return getStation(db, station.id);
  }
  for (const pid of [input.printerId, input.fallbackPrinterId]) {
    if (!pid) continue;
    const p = await getPrinter(db, pid);
    // C14: a station only prints on destinations of its own site.
    if (p.siteId !== station.siteId) throw conflict("SITE_MISMATCH", `L'imprimante ${p.name} appartient à un autre site que le poste.`);
    if (!p.supportedKinds.includes(input.labelKind)) {
      throw conflict("CONFLICT", `L'imprimante ${p.name} n'est pas déclarée pour les étiquettes ${input.labelKind}.`);
    }
  }
  if (input.fallbackPrinterId && input.fallbackPrinterId === input.printerId) throw invalid("L'imprimante de secours doit être différente.");
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "WarehouseStationRoute" ("id", "stationId", "labelKind", "printerId", "fallbackPrinterId")
    VALUES (${randomUUID()}, ${station.id}, ${input.labelKind}, ${input.printerId}, ${input.fallbackPrinterId ?? null})
    ON CONFLICT ("stationId", "labelKind") DO UPDATE
      SET "printerId" = EXCLUDED."printerId", "fallbackPrinterId" = EXCLUDED."fallbackPrinterId", "updatedAt" = now()`);
  return getStation(db, station.id);
}

// ───────────────────────────── Jobs ─────────────────────────────

export type PrintJobRow = {
  id: string;
  siteId: string;
  stationId: string;
  stationCode: string | null;
  printerId: string | null;
  printerName: string | null;
  labelKind: PrintJobKind;
  objectType: string;
  objectId: string;
  labelCode: string | null;
  payload: LabelPayload;
  widthMm: number;
  heightMm: number;
  isReprint: boolean;
  reason: string | null;
  status: PrintJobStatus;
  attempts: number;
  claimedAt: string | null;
  sentAt: string | null;
  completedAt: string | null;
  timeoutAt: string | null;
  lastError: string | null;
  createdAt: string;
};

const JOB_SELECT = Prisma.sql`
  SELECT j."id", j."siteId", j."stationId", st."code" AS "stationCode", j."printerId", p."name" AS "printerName",
         j."labelKind", j."objectType", j."objectId", j."labelCode", j."payload", j."widthMm", j."heightMm", j."isReprint",
         j."reason", j."status", j."attempts", j."claimedAt", j."sentAt", j."completedAt", j."timeoutAt", j."lastError", j."createdAt"
  FROM "WarehousePrintJob" j
  LEFT JOIN "WarehouseStation" st ON st."id" = j."stationId"
  LEFT JOIN "WarehousePrinter" p ON p."id" = j."printerId"`;

const toJob = (j: any): PrintJobRow => ({
  ...j,
  claimedAt: iso(j.claimedAt),
  sentAt: iso(j.sentAt),
  completedAt: iso(j.completedAt),
  timeoutAt: iso(j.timeoutAt),
  createdAt: iso(j.createdAt),
});

export async function getPrintJob(conn: WarehouseConn, jobId: string): Promise<PrintJobRow> {
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`${JOB_SELECT} WHERE j."id" = ${jobId}`);
  if (!rows[0]) throw notFound("Job d'impression");
  return toJob(rows[0]);
}

export async function listPrintJobs(
  conn: WarehouseConn,
  input: { siteId?: string; stationId?: string; status?: PrintJobStatus | PrintJobStatus[]; objectId?: string; limit?: number }
): Promise<PrintJobRow[]> {
  const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (input.siteId) where.push(Prisma.sql`j."siteId" = ${input.siteId}`);
  if (input.stationId) where.push(Prisma.sql`j."stationId" = ${input.stationId}`);
  if (input.objectId) where.push(Prisma.sql`j."objectId" = ${input.objectId}`);
  if (input.status) {
    const list = Array.isArray(input.status) ? input.status : [input.status];
    if (list.length) where.push(Prisma.sql`j."status" IN (${Prisma.join(list)})`);
  }
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`
    ${JOB_SELECT} WHERE ${Prisma.join(where, " AND ")} ORDER BY j."createdAt" DESC LIMIT ${Math.min(500, Math.max(1, input.limit ?? 100))}`);
  return rows.map(toJob);
}

export type PrintOutcome =
  | { status: "QUEUED"; jobId: string; printerName: string | null; stationCode: string; deduplicated: boolean }
  /** No station on this gesture, or no route / usable printer: nothing queued, the PDF fallback stays available. */
  | { status: "NOT_QUEUED"; reason: "NO_STATION" | "NO_ROUTE" | "PRINTER_DISABLED"; message: string };

export type EnqueueInput = {
  siteId: string;
  stationId: string | null | undefined;
  labelKind: PrintJobKind;
  objectType: "UNIT" | "LOCATION" | "PRINTER";
  objectId: string;
  labelCode: string | null;
  payload: LabelPayload;
  /** Unique per action: `<gesture opKey>:print`. */
  opKey: string;
  isReprint?: boolean;
  reprintOfJobId?: string | null;
  reason?: string | null;
  /** Explicit destination (test print, reroute). Otherwise the station route decides. */
  printerId?: string | null;
};

/**
 * Persist a print request inside the caller's transaction. Never throws for a missing route:
 * the stock gesture must succeed even when no printer is configured (PDF fallback).
 */
export async function enqueuePrintJobTx(tx: WarehouseTx, input: EnqueueInput, ctx: ActorContext): Promise<PrintOutcome> {
  if (!input.stationId) {
    return { status: "NOT_QUEUED", reason: "NO_STATION", message: "Aucun poste actif sur cette action : utiliser le PDF de l'étiquette." };
  }
  const station = await tx.$queryRaw<{ id: string; siteId: string; code: string; status: string }[]>(Prisma.sql`
    SELECT "id", "siteId", "code", "status" FROM "WarehouseStation" WHERE "id" = ${input.stationId}`);
  const st = station[0];
  if (!st || st.status !== "ACTIVE") {
    return { status: "NOT_QUEUED", reason: "NO_STATION", message: "Poste inconnu ou désactivé : utiliser le PDF de l'étiquette." };
  }
  // C14: a station never prints for another site.
  if (st.siteId !== input.siteId) {
    throw conflict("SITE_MISMATCH", `Le poste ${st.code} n'appartient pas au site de cette action.`);
  }

  const existing = await tx.$queryRaw<{ id: string; printerName: string | null }[]>(Prisma.sql`
    SELECT j."id", p."name" AS "printerName" FROM "WarehousePrintJob" j LEFT JOIN "WarehousePrinter" p ON p."id" = j."printerId"
    WHERE j."opKey" = ${input.opKey}`);
  if (existing[0]) {
    return { status: "QUEUED", jobId: existing[0].id, printerName: existing[0].printerName, stationCode: st.code, deduplicated: true };
  }

  let printer: { id: string; name: string; status: string; mediaWidthMm: number; mediaHeightMm: number } | undefined;
  if (input.printerId) {
    const rows = await tx.$queryRaw<any[]>(Prisma.sql`
      SELECT "id", "name", "status", "mediaWidthMm", "mediaHeightMm", "siteId" FROM "WarehousePrinter" WHERE "id" = ${input.printerId}`);
    if (!rows[0]) throw notFound("Imprimante");
    if (rows[0].siteId !== st.siteId) throw conflict("SITE_MISMATCH", "Cette imprimante appartient à un autre site que le poste.");
    printer = rows[0];
  } else {
    const routeKind = input.labelKind === "TEST" ? "PAIR" : input.labelKind;
    const routes = await tx.$queryRaw<any[]>(Prisma.sql`
      SELECT p."id", p."name", p."status", p."mediaWidthMm", p."mediaHeightMm",
             f."id" AS "fId", f."name" AS "fName", f."status" AS "fStatus", f."mediaWidthMm" AS "fW", f."mediaHeightMm" AS "fH"
      FROM "WarehouseStationRoute" r
      JOIN "WarehousePrinter" p ON p."id" = r."printerId"
      LEFT JOIN "WarehousePrinter" f ON f."id" = r."fallbackPrinterId"
      WHERE r."stationId" = ${st.id} AND r."labelKind" = ${routeKind}`);
    const r = routes[0];
    if (!r) {
      return { status: "NOT_QUEUED", reason: "NO_ROUTE", message: `Aucune imprimante affectée au poste ${st.code} pour ce type d'étiquette : utiliser le PDF.` };
    }
    if (r.status === "ACTIVE") printer = r;
    else if (r.fId && r.fStatus === "ACTIVE") printer = { id: r.fId, name: r.fName, status: r.fStatus, mediaWidthMm: r.fW, mediaHeightMm: r.fH };
  }
  if (!printer || printer.status !== "ACTIVE") {
    return { status: "NOT_QUEUED", reason: "PRINTER_DISABLED", message: "Imprimante désactivée et pas de secours : utiliser le PDF." };
  }

  const id = randomUUID();
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "WarehousePrintJob"
      ("id", "siteId", "stationId", "printerId", "labelKind", "objectType", "objectId", "labelCode", "payload", "widthMm", "heightMm",
       "opKey", "isReprint", "reprintOfJobId", "reason", "requestedByOperatorId")
    VALUES
      (${id}, ${input.siteId}, ${st.id}, ${printer.id}, ${input.labelKind}, ${input.objectType}, ${input.objectId}, ${input.labelCode},
       ${JSON.stringify(input.payload)}::jsonb, ${printer.mediaWidthMm}, ${printer.mediaHeightMm}, ${input.opKey},
       ${Boolean(input.isReprint)}, ${input.reprintOfJobId ?? null}, ${input.reason ?? null}, ${ctx.operatorId ?? null})`);
  return { status: "QUEUED", jobId: id, printerName: printer.name, stationCode: st.code, deduplicated: false };
}

export async function buildPairLabelPayload(conn: WarehouseConn, unitId: string, isReprint = false): Promise<PairLabelPayload> {
  const rows = await conn.$queryRaw<{ labelCode: string; brand: string | null; name: string; sizeLabel: string | null; styleCode: string | null }[]>(
    Prisma.sql`SELECT u."labelCode", i."brand", i."name", i."sizeLabel", i."styleCode"
               FROM "WarehouseUnit" u JOIN "WarehouseItem" i ON i."id" = u."itemId" WHERE u."id" = ${unitId}`
  );
  const r = rows[0];
  if (!r) throw notFound("Paire");
  const title = r.brand && !r.name.toLowerCase().startsWith(r.brand.toLowerCase()) ? `${r.brand} ${r.name}` : r.name;
  return { kind: "PAIR", code: r.labelCode, unitId, title, sizeLabel: r.sizeLabel, styleCode: r.styleCode, isReprint };
}

const KIND_FR: Record<string, string> = {
  LEVEL: "Niveau",
  RECEIVING: "Réception",
  CART: "Chariot",
  PACKING: "Préparation",
  RETURNS: "Retours",
  QUARANTINE: "Quarantaine",
  RACK: "Rack",
  ROW: "Rangée",
  SECTOR: "Secteur",
};

export async function buildLocationLabelPayload(conn: WarehouseConn, locationId: string): Promise<LocationLabelPayload & { siteId: string }> {
  const rows = await conn.$queryRaw<{ code: string; shortCode: string; kind: string; siteId: string }[]>(Prisma.sql`
    SELECT "code", "shortCode", "kind", "siteId" FROM "WarehouseLocation" WHERE "id" = ${locationId}`);
  if (!rows[0]) throw notFound("Emplacement");
  return { kind: "LOCATION", code: rows[0].code, shortCode: rows[0].shortCode, locationKind: KIND_FR[rows[0].kind] ?? rows[0].kind, siteId: rows[0].siteId };
}

/**
 * Explicit reprint of the SAME QR (lost / unreadable label, failed or uncertain first print).
 * New job, reason required, traced — and never a new unit.
 */
export async function reprintUnitLabel(
  db: WarehouseDb,
  input: { opKey: string; unitId: string; stationId: string | null; reason: string },
  ctx: ActorContext
): Promise<OperationResult<{ unitId: string; labelCode: string; print: PrintOutcome }>> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3) throw invalid("Motif requis pour une réimpression.");
  return runOperation(db, { opKey: input.opKey, kind: "LABEL_REPRINT", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    const siteId = unit.currentSiteId ?? unit.issuingSiteId;
    const previous = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "WarehousePrintJob" WHERE "objectType" = 'UNIT' AND "objectId" = ${unit.id} ORDER BY "createdAt" DESC LIMIT 1`);
    const print = await enqueuePrintJobTx(
      tx,
      {
        siteId,
        stationId: input.stationId,
        labelKind: "PAIR",
        objectType: "UNIT",
        objectId: unit.id,
        labelCode: unit.labelCode,
        payload: await buildPairLabelPayload(tx, unit.id, true),
        opKey: `${input.opKey}:print`,
        isReprint: true,
        reprintOfJobId: previous[0]?.id ?? null,
        reason,
      },
      ctx
    );
    await applyUnitChangeTx(
      tx,
      unit,
      // The label must be scanned again after a reprint before it counts as verified.
      { labelVerifiedAt: null },
      { type: "LABEL_REPRINT", reason, changes: { print: print.status, jobId: print.status === "QUEUED" ? print.jobId : null } },
      ctx,
      input.opKey
    );
    return { unitId: unit.id, labelCode: unit.labelCode, print };
  });
}

/** Print level / zone labels one by one or in batch from Emplacements. One job per label, each idempotent. */
export async function enqueueLocationLabels(
  db: WarehouseDb,
  input: { opKey: string; stationId: string | null; locationIds: string[] },
  ctx: ActorContext
): Promise<{ queued: number; notQueued: number; jobs: PrintOutcome[] }> {
  assertWritesEnabled();
  assertValidOpKey(input.opKey);
  const ids = [...new Set(input.locationIds ?? [])];
  if (ids.length === 0) throw invalid("Aucun emplacement sélectionné.");
  if (ids.length > 500) throw invalid("500 étiquettes au maximum par envoi.");
  return withTx(db, async (tx) => {
    const jobs: PrintOutcome[] = [];
    for (const locationId of ids) {
      const payload = await buildLocationLabelPayload(tx, locationId);
      const { siteId, ...labelPayload } = payload;
      jobs.push(
        await enqueuePrintJobTx(
          tx,
          { siteId, stationId: input.stationId, labelKind: "LOCATION", objectType: "LOCATION", objectId: locationId, labelCode: payload.code, payload: labelPayload, opKey: `${input.opKey}:${locationId}` },
          ctx
        )
      );
    }
    return { queued: jobs.filter((j) => j.status === "QUEUED").length, notQueued: jobs.filter((j) => j.status !== "QUEUED").length, jobs };
  });
}

/** Test label on an explicit printer through a station (checks routing, size and scanner readability). */
export async function enqueueTestPrint(
  db: WarehouseDb,
  input: { opKey: string; stationId: string; printerId: string },
  ctx: ActorContext
): Promise<PrintOutcome> {
  assertWritesEnabled();
  assertValidOpKey(input.opKey);
  return withTx(db, async (tx) => {
    const st = await tx.$queryRaw<{ code: string; siteId: string }[]>(Prisma.sql`SELECT "code", "siteId" FROM "WarehouseStation" WHERE "id" = ${input.stationId}`);
    if (!st[0]) throw notFound("Poste");
    const pr = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT "name" FROM "WarehousePrinter" WHERE "id" = ${input.printerId}`);
    if (!pr[0]) throw notFound("Imprimante");
    return enqueuePrintJobTx(
      tx,
      {
        siteId: st[0].siteId,
        stationId: input.stationId,
        printerId: input.printerId,
        labelKind: "TEST",
        objectType: "PRINTER",
        objectId: input.printerId,
        labelCode: null,
        payload: { kind: "TEST", text: `TEST-${st[0].code}-${new Date().toISOString().slice(0, 16)}`, stationCode: st[0].code, printerName: pr[0].name },
        opKey: `${input.opKey}:print`,
      },
      ctx
    );
  });
}

/** CLAIMED jobs past their deadline become UNCERTAIN (+ an alert). They are never re-sent automatically. */
export async function sweepPrintTimeouts(db: WarehouseDb): Promise<{ uncertain: number }> {
  return withTx(db, async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; siteId: string; objectType: string; objectId: string; labelCode: string | null }[]>(Prisma.sql`
      UPDATE "WarehousePrintJob"
      SET "status" = 'UNCERTAIN', "lastError" = 'Aucune réponse du poste après la prise en charge', "updatedAt" = now()
      WHERE "id" IN (SELECT "id" FROM "WarehousePrintJob" WHERE "status" = 'CLAIMED' AND "timeoutAt" < now() FOR UPDATE SKIP LOCKED)
      RETURNING "id", "siteId", "objectType", "objectId", "labelCode"`);
    for (const j of rows) {
      await openExceptionTx(
        tx,
        {
          siteId: j.siteId,
          type: "PRINT_UNCERTAIN",
          unitId: j.objectType === "UNIT" ? j.objectId : null,
          locationId: j.objectType === "LOCATION" ? j.objectId : null,
          rawCode: j.labelCode,
          details: { jobId: j.id, instruction: "Vérifier la file et le papier, puis confirmer ou réimprimer explicitement." },
          opKey: `print-uncertain:${j.id}`,
        },
        { role: "system" }
      );
    }
    return { uncertain: rows.length };
  });
}

export type ClaimedJob = PrintJobRow & {
  claimToken: string;
  printer: Pick<PrinterRow, "id" | "name" | "adapter" | "systemName" | "mediaWidthMm" | "mediaHeightMm" | "dpi" | "orientation" | "marginMm" | "useDriverPaperSize">;
};

/**
 * The station agent asks for its next job. Atomic claim (FOR UPDATE SKIP LOCKED): two agents or
 * two tabs can never take the same job. Only jobs of THIS station are visible.
 */
export async function claimNextPrintJob(db: WarehouseDb, input: { stationId: string }): Promise<ClaimedJob | null> {
  assertWritesEnabled();
  await sweepPrintTimeouts(db);
  const claimToken = randomBytes(16).toString("hex");
  const timeout = printClaimTimeoutSeconds();
  const enforce = isLabelJournalEnforced();
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE "WarehousePrintJob"
    SET "status" = 'CLAIMED', "claimToken" = ${claimToken}, "claimedAt" = now(), "attempts" = "attempts" + 1,
        "timeoutAt" = now() + make_interval(secs => ${timeout}::int), "updatedAt" = now()
    WHERE "id" = (
      SELECT j."id" FROM "WarehousePrintJob" j
      JOIN "WarehousePrinter" p ON p."id" = j."printerId"
      WHERE j."stationId" = ${input.stationId} AND j."status" = 'QUEUED' AND p."status" = 'ACTIVE' AND p."adapter" = 'QZ_TRAY'
        AND (${!enforce} OR j."labelKind" <> 'PAIR' OR EXISTS (
              SELECT 1 FROM "WarehouseLabelJournal" lj WHERE lj."code" = j."labelCode" AND lj."exportedAt" IS NOT NULL))
      ORDER BY j."createdAt", j."id"
      FOR UPDATE OF j SKIP LOCKED LIMIT 1)
    RETURNING "id"`);
  if (!rows[0]) return null;
  const job = await getPrintJob(db, rows[0].id);
  const printer = await getPrinter(db, job.printerId as string);
  return {
    ...job,
    claimToken,
    printer: {
      id: printer.id,
      name: printer.name,
      adapter: printer.adapter,
      systemName: printer.systemName,
      mediaWidthMm: printer.mediaWidthMm,
      mediaHeightMm: printer.mediaHeightMm,
      dpi: printer.dpi,
      orientation: printer.orientation,
      marginMm: printer.marginMm,
      useDriverPaperSize: printer.useDriverPaperSize,
    },
  };
}

/**
 * Result reported by the agent that claimed the job.
 *  SENT   = the local spooler accepted it (still not a proof of paper);
 *  FAILED = refused before anything was sent (printer not found, QZ down): safe to retry.
 * A report with a stale claim token (job already swept to UNCERTAIN, or claimed elsewhere) is refused.
 */
export async function reportPrintJob(
  db: WarehouseDb,
  input: { jobId: string; claimToken: string; outcome: "SENT" | "FAILED"; error?: string | null },
  ctx: ActorContext
): Promise<PrintJobRow> {
  assertWritesEnabled();
  if (!["SENT", "FAILED"].includes(input.outcome)) throw invalid("Résultat attendu : SENT ou FAILED.");
  await withTx(db, async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; status: string; claimToken: string | null; objectType: string; objectId: string; isReprint: boolean; printerId: string | null }[]>(
      Prisma.sql`SELECT "id", "status", "claimToken", "objectType", "objectId", "isReprint", "printerId" FROM "WarehousePrintJob" WHERE "id" = ${input.jobId} FOR UPDATE`
    );
    const job = rows[0];
    if (!job) throw notFound("Job d'impression");
    if (job.claimToken !== input.claimToken) throw conflict("PRINT_STATE_CONFLICT", "Ce job a été pris en charge par un autre agent.");
    // Idempotent report.
    if ((job.status === "SENT" || job.status === "CONFIRMED") && input.outcome === "SENT") return;
    if (job.status === "FAILED" && input.outcome === "FAILED") return;
    // A late answer after the deadline: the job is UNCERTAIN; a late SENT is real information.
    if (job.status !== "CLAIMED" && !(job.status === "UNCERTAIN" && input.outcome === "SENT")) {
      throw conflict("PRINT_STATE_CONFLICT", `Job en état ${job.status} : résultat ignoré.`, { status: job.status });
    }
    const error = input.error ? String(input.error).slice(0, 500) : null;
    if (input.outcome === "SENT") {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "WarehousePrintJob" SET "status" = 'SENT', "sentAt" = now(), "timeoutAt" = NULL, "lastError" = NULL, "updatedAt" = now()
        WHERE "id" = ${job.id}`);
      if (job.objectType === "UNIT") {
        const unit = await lockUnitTx(tx, job.objectId);
        await applyUnitChangeTx(
          tx,
          unit,
          { labelPrintIncrement: 1 },
          { type: job.isReprint ? "LABEL_REPRINT" : "LABEL_PRINT", changes: { jobId: job.id, sent: true } },
          ctx,
          null
        );
      }
    } else {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "WarehousePrintJob" SET "status" = 'FAILED', "timeoutAt" = NULL, "lastError" = ${error ?? "Échec d'impression"}, "updatedAt" = now()
        WHERE "id" = ${job.id}`);
      if (job.printerId) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "WarehousePrinter" SET "lastError" = ${error ?? "Échec d'impression"}, "lastErrorAt" = now(), "updatedAt" = now()
          WHERE "id" = ${job.printerId}`);
      }
    }
  });
  return getPrintJob(db, input.jobId);
}

/**
 * Operator actions on a job:
 *  RETRY     FAILED → QUEUED (nothing was sent, same job);
 *  CANCEL    QUEUED / FAILED → CANCELLED;
 *  REROUTE   QUEUED / FAILED → QUEUED on another printer (and optionally another station of the site);
 *  MANUAL_SENT  QUEUED / FAILED → SENT on a PDF_MANUAL printer (PDF opened and printed by hand);
 *  CONFIRM   SENT / UNCERTAIN → CONFIRMED (the label is physically there);
 *  NOT_PRINTED  UNCERTAIN → CANCELLED (checked: nothing came out; reprint explicitly).
 * An UNCERTAIN job can never be retried or rerouted: a late print could still come out (C11).
 */
export async function actOnPrintJob(
  db: WarehouseDb,
  input: {
    jobId: string;
    action: "RETRY" | "CANCEL" | "REROUTE" | "CONFIRM" | "NOT_PRINTED" | "MANUAL_SENT";
    printerId?: string | null;
    stationId?: string | null;
  },
  ctx: ActorContext = { role: "system", operatorId: null, stationId: null }
): Promise<PrintJobRow> {
  assertWritesEnabled();
  await withTx(db, async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string; status: PrintJobStatus; siteId: string; stationId: string; labelKind: string; objectType: string; objectId: string; isReprint: boolean; printerId: string | null }[]
    >(Prisma.sql`
      SELECT "id", "status", "siteId", "stationId", "labelKind", "objectType", "objectId", "isReprint", "printerId"
      FROM "WarehousePrintJob" WHERE "id" = ${input.jobId} FOR UPDATE`);
    const job = rows[0];
    if (!job) throw notFound("Job d'impression");
    const refuse = (allowed: string) =>
      conflict("PRINT_STATE_CONFLICT", `Action impossible sur un job ${job.status} (attendu : ${allowed}).`, { status: job.status });

    switch (input.action) {
      case "RETRY":
        if (job.status !== "FAILED") throw refuse("FAILED");
        await tx.$executeRaw(Prisma.sql`
          UPDATE "WarehousePrintJob" SET "status" = 'QUEUED', "claimToken" = NULL, "claimedAt" = NULL, "timeoutAt" = NULL, "updatedAt" = now() WHERE "id" = ${job.id}`);
        return;
      case "CANCEL":
        if (job.status !== "QUEUED" && job.status !== "FAILED") throw refuse("QUEUED ou FAILED");
        await tx.$executeRaw(Prisma.sql`
          UPDATE "WarehousePrintJob" SET "status" = 'CANCELLED', "completedAt" = now(), "updatedAt" = now() WHERE "id" = ${job.id}`);
        return;
      case "REROUTE": {
        if (job.status !== "QUEUED" && job.status !== "FAILED") {
          throw conflict(
            "PRINT_STATE_CONFLICT",
            job.status === "UNCERTAIN" || job.status === "CLAIMED" || job.status === "SENT"
              ? "Ce job a peut-être déjà été envoyé : vérifier la file et le papier, le clore, puis réimprimer explicitement."
              : `Action impossible sur un job ${job.status}.`,
            { status: job.status }
          );
        }
        if (!input.printerId) throw invalid("Imprimante de destination requise.");
        const printer = await tx.$queryRaw<{ id: string; siteId: string; status: string; mediaWidthMm: number; mediaHeightMm: number }[]>(Prisma.sql`
          SELECT "id", "siteId", "status", "mediaWidthMm", "mediaHeightMm" FROM "WarehousePrinter" WHERE "id" = ${input.printerId}`);
        if (!printer[0]) throw notFound("Imprimante");
        if (printer[0].siteId !== job.siteId) throw conflict("SITE_MISMATCH", "Imprimante d'un autre site.");
        if (printer[0].status !== "ACTIVE") throw conflict("CONFLICT", "Imprimante désactivée.");
        let stationId = job.stationId;
        if (input.stationId && input.stationId !== job.stationId) {
          const st = await tx.$queryRaw<{ siteId: string; status: string }[]>(Prisma.sql`SELECT "siteId", "status" FROM "WarehouseStation" WHERE "id" = ${input.stationId}`);
          if (!st[0] || st[0].status !== "ACTIVE") throw notFound("Poste");
          if (st[0].siteId !== job.siteId) throw conflict("SITE_MISMATCH", "Poste d'un autre site.");
          stationId = input.stationId;
        }
        await tx.$executeRaw(Prisma.sql`
          UPDATE "WarehousePrintJob" SET "status" = 'QUEUED', "printerId" = ${printer[0].id}, "stationId" = ${stationId},
            "widthMm" = ${printer[0].mediaWidthMm}, "heightMm" = ${printer[0].mediaHeightMm},
            "claimToken" = NULL, "claimedAt" = NULL, "timeoutAt" = NULL, "updatedAt" = now()
          WHERE "id" = ${job.id}`);
        return;
      }
      case "MANUAL_SENT": {
        // PDF fallback: the operator opened the PDF and printed it by hand. Only for printers
        // without an agent — a QZ job is reported by the agent that claimed it.
        if (job.status !== "QUEUED" && job.status !== "FAILED") throw refuse("QUEUED ou FAILED");
        const printer = await tx.$queryRaw<{ adapter: string }[]>(Prisma.sql`SELECT "adapter" FROM "WarehousePrinter" WHERE "id" = ${job.printerId}`);
        if (printer[0]?.adapter !== "PDF_MANUAL") {
          throw conflict("PRINT_STATE_CONFLICT", "Cette imprimante est pilotée par le poste : l'envoi est déclaré par l'agent d'impression.");
        }
        await tx.$executeRaw(Prisma.sql`
          UPDATE "WarehousePrintJob" SET "status" = 'SENT', "sentAt" = now(), "attempts" = "attempts" + 1, "timeoutAt" = NULL, "lastError" = NULL, "updatedAt" = now()
          WHERE "id" = ${job.id}`);
        if (job.objectType === "UNIT") {
          const unit = await lockUnitTx(tx, job.objectId);
          await applyUnitChangeTx(
            tx,
            unit,
            { labelPrintIncrement: 1 },
            { type: job.isReprint ? "LABEL_REPRINT" : "LABEL_PRINT", changes: { jobId: job.id, sent: true, manual: true } },
            ctx,
            null
          );
        }
        return;
      }
      case "CONFIRM":
        if (job.status !== "SENT" && job.status !== "UNCERTAIN") throw refuse("SENT ou UNCERTAIN");
        await tx.$executeRaw(Prisma.sql`
          UPDATE "WarehousePrintJob" SET "status" = 'CONFIRMED', "completedAt" = now(), "timeoutAt" = NULL, "updatedAt" = now() WHERE "id" = ${job.id}`);
        return;
      case "NOT_PRINTED":
        if (job.status !== "UNCERTAIN") throw refuse("UNCERTAIN");
        await tx.$executeRaw(Prisma.sql`
          UPDATE "WarehousePrintJob" SET "status" = 'CANCELLED', "completedAt" = now(), "timeoutAt" = NULL,
            "lastError" = 'Vérifié : rien n''est sorti', "updatedAt" = now() WHERE "id" = ${job.id}`);
        return;
      default:
        throw invalid("Action inconnue.");
    }
  });
  return getPrintJob(db, input.jobId);
}

/**
 * The freshly stuck label is scanned back: proves the QR is readable and on a box. Marks the
 * unit's label verified and confirms its latest sent job. Idempotent.
 */
export async function confirmUnitLabelScan(
  db: WarehouseDb,
  input: { opKey: string; unitId: string },
  ctx: ActorContext
): Promise<OperationResult<{ unitId: string; labelVerifiedAt: string; alreadyVerified: boolean }>> {
  return runOperation(db, { opKey: input.opKey, kind: "LABEL_VERIFIED", request: input, ctx }, async (tx) => {
    const unit = await lockUnitTx(tx, input.unitId);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehousePrintJob" SET "status" = 'CONFIRMED', "completedAt" = now(), "timeoutAt" = NULL, "updatedAt" = now()
      WHERE "objectType" = 'UNIT' AND "objectId" = ${unit.id} AND "status" IN ('SENT', 'UNCERTAIN')`);
    if (unit.labelVerifiedAt) {
      return { unitId: unit.id, labelVerifiedAt: new Date(unit.labelVerifiedAt).toISOString(), alreadyVerified: true };
    }
    const now = new Date();
    await applyUnitChangeTx(tx, unit, { labelVerifiedAt: now }, { type: "LABEL_VERIFIED" }, ctx, input.opKey);
    return { unitId: unit.id, labelVerifiedAt: now.toISOString(), alreadyVerified: false };
  });
}

export { LABEL_PROFILES, PRINTABLE_KINDS };
