import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  buildLevelCode,
  buildLevelShortCode,
  buildRackCode,
  buildRowCode,
  buildSectorCode,
  computeWalkSequence,
  isLocationCode,
  isSiteCode,
} from "./codes";
import { withTx, type WarehouseConn, type WarehouseDb, type WarehouseTx } from "./db";
import { WarehouseError, conflict, invalid, isUniqueViolation, notFound } from "./errors";
import { assertWritesEnabled } from "./operations";
import {
  UNIT_HOLDING_KINDS,
  type ActorContext,
  type LocationKind,
  type LocationStatus,
  type LocationSummary,
} from "./types";

// ───────────────────────────── Sites ─────────────────────────────

export type SiteRow = {
  id: string;
  code: string;
  name: string;
  countryCode: string;
  timezone: string;
  status: string;
  isTest: boolean;
};

export async function listSites(conn: WarehouseConn, opts: { includeRetired?: boolean } = {}): Promise<SiteRow[]> {
  return conn.$queryRaw<SiteRow[]>(Prisma.sql`
    SELECT "id", "code", "name", "countryCode", "timezone", "status", "isTest"
    FROM "WarehouseSite"
    ${opts.includeRetired ? Prisma.empty : Prisma.sql`WHERE "status" = 'ACTIVE'`}
    ORDER BY "code"`);
}

export async function getSite(conn: WarehouseConn, idOrCode: string): Promise<SiteRow> {
  const rows = await conn.$queryRaw<SiteRow[]>(Prisma.sql`
    SELECT "id", "code", "name", "countryCode", "timezone", "status", "isTest"
    FROM "WarehouseSite" WHERE "id" = ${idOrCode} OR "code" = ${idOrCode.toUpperCase()} LIMIT 1`);
  if (!rows[0]) throw notFound("Site", { site: idOrCode });
  return rows[0];
}

/**
 * Adding a warehouse = one site row + addresses + access. Existing units are untouched.
 * The code is printed inside pair QR codes, so it can never change afterwards (DB trigger).
 */
export async function createSite(
  db: WarehouseDb,
  input: { code: string; name: string; countryCode: string; timezone?: string; isTest?: boolean }
): Promise<SiteRow> {
  assertWritesEnabled();
  const code = String(input.code ?? "").trim().toUpperCase();
  if (!isSiteCode(code)) throw invalid("Code site attendu : 2 lettres + 2 chiffres (ex. CH01).");
  const name = String(input.name ?? "").trim();
  if (!name) throw invalid("Nom du site requis.");
  const countryCode = String(input.countryCode ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) throw invalid("Pays attendu : code ISO à 2 lettres.");
  try {
    const rows = await db.$queryRaw<SiteRow[]>(Prisma.sql`
      INSERT INTO "WarehouseSite" ("id", "code", "name", "countryCode", "timezone", "isTest")
      VALUES (${randomUUID()}, ${code}, ${name}, ${countryCode}, ${input.timezone?.trim() || "Europe/Zurich"}, ${Boolean(input.isTest)})
      RETURNING "id", "code", "name", "countryCode", "timezone", "status", "isTest"`);
    return rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("CONFLICT", `Le site ${code} existe déjà.`);
    throw err;
  }
}

/** Retire a site from new operations; its issued codes keep resolving (C05). */
export async function setSiteStatus(db: WarehouseDb, siteId: string, status: "ACTIVE" | "RETIRED"): Promise<SiteRow> {
  assertWritesEnabled();
  const rows = await db.$queryRaw<SiteRow[]>(Prisma.sql`
    UPDATE "WarehouseSite" SET "status" = ${status}, "updatedAt" = now() WHERE "id" = ${siteId}
    RETURNING "id", "code", "name", "countryCode", "timezone", "status", "isTest"`);
  if (!rows[0]) throw notFound("Site");
  return rows[0];
}

// ───────────────────────────── Locations ─────────────────────────────

type LocationDbRow = Omit<LocationSummary, "freeCount">;

const LOCATION_COLUMNS = Prisma.sql`
  l."id", l."siteId", s."code" AS "siteCode", l."code", l."shortCode", l."kind", l."holdsUnits",
  l."sector", l."rowNo", l."rackNo", l."levelNo", l."walkSequence", l."capacity", l."sizeProfile",
  l."status", l."statusReason", l."occupiedCount", l."reservedCount"`;

export function toLocationSummary(row: LocationDbRow): LocationSummary {
  return {
    ...row,
    freeCount: row.capacity === null ? null : Math.max(0, row.capacity - row.occupiedCount - row.reservedCount),
  };
}

export async function getLocation(conn: WarehouseConn, id: string): Promise<LocationSummary> {
  const rows = await conn.$queryRaw<LocationDbRow[]>(Prisma.sql`
    SELECT ${LOCATION_COLUMNS} FROM "WarehouseLocation" l JOIN "WarehouseSite" s ON s."id" = l."siteId"
    WHERE l."id" = ${id}`);
  if (!rows[0]) throw notFound("Emplacement", { locationId: id });
  return toLocationSummary(rows[0]);
}

/**
 * Resolve a scanned location code through the code registry (current code or historic alias).
 * `viaAlias` tells the operator the shelf label is outdated.
 */
export async function resolveLocationCode(
  conn: WarehouseConn,
  code: string
): Promise<(LocationSummary & { viaAlias: boolean; scannedCode: string }) | null> {
  const normalized = String(code ?? "").trim().toUpperCase();
  if (!normalized) return null;
  const rows = await conn.$queryRaw<(LocationDbRow & { isPrimary: boolean })[]>(Prisma.sql`
    SELECT ${LOCATION_COLUMNS}, c."isPrimary"
    FROM "WarehouseLocationCode" c
    JOIN "WarehouseLocation" l ON l."id" = c."locationId"
    JOIN "WarehouseSite" s ON s."id" = l."siteId"
    WHERE c."code" = ${normalized}`);
  if (!rows[0]) return null;
  const { isPrimary, ...row } = rows[0];
  return { ...toLocationSummary(row), viaAlias: !isPrimary || row.code !== normalized, scannedCode: normalized };
}

type NewLocation = {
  siteId: string;
  parentId: string | null;
  code: string;
  shortCode: string;
  kind: LocationKind;
  sector?: string | null;
  rowNo?: number | null;
  rackNo?: number | null;
  levelNo?: number | null;
  walkSequence?: number;
  capacity?: number | null;
  sizeProfile?: string;
};

/** Insert a location + its primary code. Returns null when the code already exists (idempotent generators). */
async function insertLocationTx(tx: WarehouseTx, loc: NewLocation): Promise<string | null> {
  const id = randomUUID();
  const codeRow = await tx.$queryRaw<{ code: string }[]>(Prisma.sql`
    SELECT "code" FROM "WarehouseLocationCode" WHERE "code" = ${loc.code}`);
  if (codeRow.length > 0) return null;
  const inserted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO "WarehouseLocation"
      ("id", "siteId", "parentId", "code", "shortCode", "kind", "holdsUnits", "sector", "rowNo", "rackNo", "levelNo",
       "walkSequence", "capacity", "sizeProfile")
    VALUES
      (${id}, ${loc.siteId}, ${loc.parentId}, ${loc.code}, ${loc.shortCode}, ${loc.kind},
       ${UNIT_HOLDING_KINDS.includes(loc.kind)}, ${loc.sector ?? null}, ${loc.rowNo ?? null}, ${loc.rackNo ?? null},
       ${loc.levelNo ?? null}, ${loc.walkSequence ?? 0}, ${loc.capacity ?? null}, ${loc.sizeProfile ?? "STANDARD"})
    ON CONFLICT ("code") DO NOTHING
    RETURNING "id"`);
  if (inserted.length === 0) return null;
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "WarehouseLocationCode" ("code", "locationId", "isPrimary") VALUES (${loc.code}, ${id}, true)`);
  return id;
}

async function findLocationIdByCode(tx: WarehouseTx, code: string): Promise<string> {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "WarehouseLocation" WHERE "code" = ${code}`);
  if (!rows[0]) throw notFound("Emplacement", { code });
  return rows[0].id;
}

export type GenerateRacksInput = {
  siteId: string;
  sector: string;
  rowFrom: number;
  rowTo: number;
  racksPerRow: number;
  levelsPerRack: number;
  capacityPerLevel: number;
  sizeProfile?: string;
  /** Even rows walked in reverse rack order (aisle walked there and back). */
  serpentine?: boolean;
  /** 0-based order of this sector in the site walk. */
  sectorIndex?: number;
};

/**
 * Assisted creation of a rack block: SECTOR → ROW → RACK → LEVEL, with codes
 * `CH01-A-R01-T03-N02`. Re-running the same generation only adds what is missing.
 */
export async function generateRacks(
  db: WarehouseDb,
  input: GenerateRacksInput
): Promise<{ created: number; skipped: number; levelCodes: string[] }> {
  assertWritesEnabled();
  const sector = String(input.sector ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{1,4}$/.test(sector)) throw invalid("Secteur attendu : 1 à 4 lettres/chiffres (ex. A).");
  const ints = [input.rowFrom, input.rowTo, input.racksPerRow, input.levelsPerRack, input.capacityPerLevel];
  if (ints.some((n) => !Number.isInteger(n) || n < 0)) throw invalid("Valeurs entières positives attendues.");
  if (input.rowFrom < 1 || input.rowTo < input.rowFrom || input.rowTo > 99) throw invalid("Rangées attendues entre 1 et 99.");
  if (input.racksPerRow < 1 || input.racksPerRow > 99) throw invalid("Racks par rangée : 1 à 99.");
  if (input.levelsPerRack < 1 || input.levelsPerRack > 20) throw invalid("Niveaux par rack : 1 à 20.");
  const totalLevels = (input.rowTo - input.rowFrom + 1) * input.racksPerRow * input.levelsPerRack;
  if (totalLevels > 20_000) throw invalid("Génération limitée à 20 000 niveaux par appel.");

  return withTx(
    db,
    async (tx) => {
      const site = await getSite(tx, input.siteId);
      let created = 0;
      let skipped = 0;
      const levelCodes: string[] = [];
      const count = (id: string | null) => (id ? (created += 1) : (skipped += 1));

      const sectorCode = buildSectorCode(site.code, sector);
      count(
        await insertLocationTx(tx, {
          siteId: site.id,
          parentId: null,
          code: sectorCode,
          shortCode: sector,
          kind: "SECTOR",
          sector,
          walkSequence: (input.sectorIndex ?? 0) * 1_000_000,
        })
      );
      const sectorId = await findLocationIdByCode(tx, sectorCode);

      for (let rowNo = input.rowFrom; rowNo <= input.rowTo; rowNo += 1) {
        const rowCode = buildRowCode({ siteCode: site.code, sector, rowNo });
        count(
          await insertLocationTx(tx, {
            siteId: site.id,
            parentId: sectorId,
            code: rowCode,
            shortCode: `${sector}-${String(rowNo).padStart(2, "0")}`,
            kind: "ROW",
            sector,
            rowNo,
            walkSequence: (input.sectorIndex ?? 0) * 1_000_000 + rowNo * 10_000,
          })
        );
        const rowId = await findLocationIdByCode(tx, rowCode);

        for (let rackNo = 1; rackNo <= input.racksPerRow; rackNo += 1) {
          const rackCode = buildRackCode({ siteCode: site.code, sector, rowNo, rackNo });
          count(
            await insertLocationTx(tx, {
              siteId: site.id,
              parentId: rowId,
              code: rackCode,
              shortCode: `${sector}-${String(rowNo).padStart(2, "0")}-${String(rackNo).padStart(2, "0")}`,
              kind: "RACK",
              sector,
              rowNo,
              rackNo,
              walkSequence: computeWalkSequence({
                sectorIndex: input.sectorIndex ?? 0,
                rowNo,
                rackNo,
                levelNo: 0,
                racksPerRow: input.racksPerRow,
                serpentine: input.serpentine !== false,
              }),
            })
          );
          const rackId = await findLocationIdByCode(tx, rackCode);

          for (let levelNo = 1; levelNo <= input.levelsPerRack; levelNo += 1) {
            const code = buildLevelCode({ siteCode: site.code, sector, rowNo, rackNo, levelNo });
            const id = await insertLocationTx(tx, {
              siteId: site.id,
              parentId: rackId,
              code,
              shortCode: buildLevelShortCode({ sector, rowNo, rackNo, levelNo }),
              kind: "LEVEL",
              sector,
              rowNo,
              rackNo,
              levelNo,
              capacity: input.capacityPerLevel,
              sizeProfile: input.sizeProfile ?? "STANDARD",
              walkSequence: computeWalkSequence({
                sectorIndex: input.sectorIndex ?? 0,
                rowNo,
                rackNo,
                levelNo,
                racksPerRow: input.racksPerRow,
                serpentine: input.serpentine !== false,
              }),
            });
            count(id);
            if (id) levelCodes.push(code);
          }
        }
      }
      return { created, skipped, levelCodes };
    },
    { timeoutMs: 120_000 }
  );
}

/**
 * Create one level (and its sector / row / rack parents when missing) — used by the assisted
 * CSV import and by "ajouter une adresse". Idempotent: an existing code is left untouched.
 */
export async function createLevelTx(
  tx: WarehouseTx,
  input: { siteId: string; sector: string; rowNo: number; rackNo: number; levelNo: number; capacity: number; sizeProfile?: string; racksPerRow?: number; serpentine?: boolean }
): Promise<{ code: string; created: boolean }> {
  const sector = String(input.sector ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{1,4}$/.test(sector)) throw invalid("Secteur attendu : 1 à 4 lettres/chiffres.");
  for (const [label, v, max] of [["Rangée", input.rowNo, 99], ["Rack", input.rackNo, 99], ["Niveau", input.levelNo, 20]] as const) {
    if (!Number.isInteger(v) || v < 1 || v > max) throw invalid(`${label} attendu entre 1 et ${max}.`);
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 0 || input.capacity > 10_000) throw invalid("Capacité : entier positif.");
  const site = await getSite(tx, input.siteId);
  const pad = (n: number) => String(n).padStart(2, "0");
  const sectorCode = buildSectorCode(site.code, sector);
  await insertLocationTx(tx, { siteId: site.id, parentId: null, code: sectorCode, shortCode: sector, kind: "SECTOR", sector });
  const sectorId = await findLocationIdByCode(tx, sectorCode);
  const rowCode = buildRowCode({ siteCode: site.code, sector, rowNo: input.rowNo });
  await insertLocationTx(tx, { siteId: site.id, parentId: sectorId, code: rowCode, shortCode: `${sector}-${pad(input.rowNo)}`, kind: "ROW", sector, rowNo: input.rowNo, walkSequence: input.rowNo * 10_000 });
  const rowId = await findLocationIdByCode(tx, rowCode);
  const rackCode = buildRackCode({ siteCode: site.code, sector, rowNo: input.rowNo, rackNo: input.rackNo });
  const walk = (levelNo: number) =>
    computeWalkSequence({ sectorIndex: 0, rowNo: input.rowNo, rackNo: input.rackNo, levelNo, racksPerRow: input.racksPerRow ?? 99, serpentine: Boolean(input.serpentine) });
  await insertLocationTx(tx, { siteId: site.id, parentId: rowId, code: rackCode, shortCode: `${sector}-${pad(input.rowNo)}-${pad(input.rackNo)}`, kind: "RACK", sector, rowNo: input.rowNo, rackNo: input.rackNo, walkSequence: walk(0) });
  const rackId = await findLocationIdByCode(tx, rackCode);
  const code = buildLevelCode({ siteCode: site.code, sector, rowNo: input.rowNo, rackNo: input.rackNo, levelNo: input.levelNo });
  const id = await insertLocationTx(tx, {
    siteId: site.id,
    parentId: rackId,
    code,
    shortCode: buildLevelShortCode({ sector, rowNo: input.rowNo, rackNo: input.rackNo, levelNo: input.levelNo }),
    kind: "LEVEL",
    sector,
    rowNo: input.rowNo,
    rackNo: input.rackNo,
    levelNo: input.levelNo,
    capacity: input.capacity,
    sizeProfile: (input.sizeProfile ?? "STANDARD").toUpperCase(),
    walkSequence: walk(input.levelNo),
  });
  return { code, created: Boolean(id) };
}

export async function createLevel(db: WarehouseDb, input: Parameters<typeof createLevelTx>[1]): Promise<{ code: string; created: boolean }> {
  assertWritesEnabled();
  return withTx(db, (tx) => createLevelTx(tx, input));
}

const SPECIAL_PREFIX: Partial<Record<LocationKind, string>> = {
  RECEIVING: "REC",
  CART: "CART",
  PACKING: "PACK",
  RETURNS: "RET",
  QUARANTINE: "QUA",
};

/** Create a non-rack position: receiving zone, cart, packing table, returns bin, quarantine. */
export async function createSpecialLocation(
  db: WarehouseDb,
  input: { siteId: string; kind: LocationKind; number?: number; capacity?: number | null; label?: string }
): Promise<LocationSummary> {
  assertWritesEnabled();
  const prefix = SPECIAL_PREFIX[input.kind];
  if (!prefix) throw invalid("Type attendu : RECEIVING, CART, PACKING, RETURNS ou QUARANTINE.");
  if (input.capacity !== undefined && input.capacity !== null && (!Number.isInteger(input.capacity) || input.capacity < 0)) {
    throw invalid("Capacité : entier positif ou vide.");
  }
  const id = await withTx(db, async (tx) => {
    const site = await getSite(tx, input.siteId);
    let number = input.number;
    if (number === undefined) {
      const rows = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT count(*)::int AS n FROM "WarehouseLocation" WHERE "siteId" = ${site.id} AND "kind" = ${input.kind}`);
      number = rows[0].n + 1;
    }
    if (!Number.isInteger(number) || number < 1 || number > 999) throw invalid("Numéro attendu entre 1 et 999.");
    const code = `${site.code}-${prefix}-${String(number).padStart(2, "0")}`;
    const created = await insertLocationTx(tx, {
      siteId: site.id,
      parentId: null,
      code,
      shortCode: input.label?.trim() || `${prefix}-${String(number).padStart(2, "0")}`,
      kind: input.kind,
      capacity: input.capacity ?? null,
      // Temporary positions come first in any walk.
      walkSequence: 0,
    });
    if (!created) throw conflict("CONFLICT", `Le code ${code} existe déjà (y compris comme ancien code).`);
    return created;
  });
  return getLocation(db, id);
}

export async function updateLocation(
  db: WarehouseDb,
  locationId: string,
  patch: { capacity?: number | null; sizeProfile?: string; walkSequence?: number; shortCode?: string }
): Promise<LocationSummary> {
  assertWritesEnabled();
  if (patch.capacity !== undefined && patch.capacity !== null && (!Number.isInteger(patch.capacity) || patch.capacity < 0)) {
    throw invalid("Capacité : entier positif ou vide.");
  }
  const current = await getLocation(db, locationId);
  await db.$executeRaw(Prisma.sql`
    UPDATE "WarehouseLocation" SET
      "capacity" = ${patch.capacity === undefined ? current.capacity : patch.capacity},
      "sizeProfile" = ${patch.sizeProfile?.trim().toUpperCase() || current.sizeProfile},
      "walkSequence" = ${patch.walkSequence ?? current.walkSequence},
      "shortCode" = ${patch.shortCode?.trim() || current.shortCode},
      "updatedAt" = now()
    WHERE "id" = ${locationId}`);
  return getLocation(db, locationId);
}

/**
 * Rename a level. The old scannable code stays as an alias of the same location forever
 * (never reused for another destination); pair QR codes are unaffected.
 */
export async function renameLocation(
  db: WarehouseDb,
  locationId: string,
  input: { newCode: string; newShortCode?: string }
): Promise<LocationSummary> {
  assertWritesEnabled();
  const newCode = String(input.newCode ?? "").trim().toUpperCase();
  if (!isLocationCode(newCode)) throw invalid("Code d'emplacement invalide (ex. CH01-A-R01-T03-N02).");
  await withTx(db, async (tx) => {
    const current = await getLocation(tx, locationId);
    if (!newCode.startsWith(`${current.siteCode}-`)) {
      throw invalid(`Le code doit commencer par le site ${current.siteCode}.`);
    }
    if (newCode === current.code) return;
    const existing = await tx.$queryRaw<{ locationId: string }[]>(Prisma.sql`
      SELECT "locationId" FROM "WarehouseLocationCode" WHERE "code" = ${newCode}`);
    if (existing[0] && existing[0].locationId !== locationId) {
      throw conflict("CONFLICT", `Le code ${newCode} désigne déjà (ou a désigné) un autre emplacement.`);
    }
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseLocationCode" SET "isPrimary" = false WHERE "locationId" = ${locationId} AND "isPrimary" = true`);
    if (existing[0]) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "WarehouseLocationCode" SET "isPrimary" = true WHERE "code" = ${newCode}`);
    } else {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "WarehouseLocationCode" ("code", "locationId", "isPrimary") VALUES (${newCode}, ${locationId}, true)`);
    }
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseLocation" SET "code" = ${newCode},
        "shortCode" = ${input.newShortCode?.trim() || current.shortCode}, "updatedAt" = now()
      WHERE "id" = ${locationId}`);
  });
  return getLocation(db, locationId);
}

/**
 * ACTIVE ⇄ BLOCKED (maintenance, reported full) or RETIRED (obsolete level, history kept).
 * Blocking releases the capacity reservations that targeted the location: their tasks go back
 * to PENDING and will be re-proposed; boxes already there stay where they are.
 */
export async function setLocationStatus(
  db: WarehouseDb,
  locationId: string,
  input: { status: LocationStatus; reason?: string },
  _ctx?: ActorContext
): Promise<LocationSummary & { releasedReservations: number }> {
  assertWritesEnabled();
  if (!["ACTIVE", "BLOCKED", "RETIRED"].includes(input.status)) throw invalid("Statut invalide.");
  const released = await withTx(db, async (tx) => {
    const rows = await tx.$queryRaw<{ occupiedCount: number; status: string }[]>(Prisma.sql`
      SELECT "occupiedCount", "status" FROM "WarehouseLocation" WHERE "id" = ${locationId} FOR UPDATE`);
    if (!rows[0]) throw notFound("Emplacement");
    if (rows[0].status === "RETIRED" && input.status !== "RETIRED") {
      throw conflict("LOCATION_NOT_USABLE", "Un emplacement retiré ne se réactive pas : créez un nouvel emplacement.");
    }
    if (input.status === "RETIRED" && rows[0].occupiedCount > 0) {
      throw conflict("LOCATION_NOT_USABLE", "Emplacement encore occupé : déplacez les paires avant de le retirer.", {
        occupiedCount: rows[0].occupiedCount,
      });
    }
    let releasedCount = 0;
    if (input.status !== "ACTIVE") {
      const tasks = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        UPDATE "WarehousePutawayTask"
        SET "status" = 'PENDING', "proposedLocationId" = NULL, "reservedAt" = NULL, "reservationExpiresAt" = NULL,
            "holdReason" = 'DESTINATION_BLOCKED', "updatedAt" = now()
        WHERE "proposedLocationId" = ${locationId} AND "status" = 'RESERVED'
        RETURNING "id"`);
      releasedCount = tasks.length;
    }
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseLocation" SET
        "status" = ${input.status},
        "statusReason" = ${input.status === "ACTIVE" ? null : input.reason?.trim() || null},
        "reservedCount" = CASE WHEN ${input.status} = 'ACTIVE' THEN "reservedCount" ELSE 0 END,
        "retiredAt" = CASE WHEN ${input.status} = 'RETIRED' THEN now() ELSE "retiredAt" END,
        "updatedAt" = now()
      WHERE "id" = ${locationId}`);
    return releasedCount;
  });
  return { ...(await getLocation(db, locationId)), releasedReservations: released };
}

export type ListLocationsInput = {
  siteId: string;
  kinds?: LocationKind[];
  holdsUnits?: boolean;
  status?: LocationStatus;
  sector?: string;
  rowNo?: number;
  rackNo?: number;
  search?: string;
  /** Only locations that still have free capacity. */
  onlyFree?: boolean;
  limit?: number;
  /** Keyset cursor: `<walkSequence>:<code>` of the last row. */
  cursor?: string | null;
};

/** Paginated list in walk order (server-side filters; never loads a whole site in the browser). */
export async function listLocations(
  conn: WarehouseConn,
  input: ListLocationsInput
): Promise<{ items: LocationSummary[]; nextCursor: string | null }> {
  const limit = Math.min(500, Math.max(1, input.limit ?? 100));
  const where: Prisma.Sql[] = [Prisma.sql`l."siteId" = ${input.siteId}`];
  if (input.kinds?.length) where.push(Prisma.sql`l."kind" IN (${Prisma.join(input.kinds)})`);
  if (input.holdsUnits !== undefined) where.push(Prisma.sql`l."holdsUnits" = ${input.holdsUnits}`);
  if (input.status) where.push(Prisma.sql`l."status" = ${input.status}`);
  if (input.sector) where.push(Prisma.sql`l."sector" = ${input.sector.toUpperCase()}`);
  if (input.rowNo !== undefined) where.push(Prisma.sql`l."rowNo" = ${input.rowNo}`);
  if (input.rackNo !== undefined) where.push(Prisma.sql`l."rackNo" = ${input.rackNo}`);
  if (input.search?.trim()) {
    const q = `%${input.search.trim().toUpperCase().replace(/[%_]/g, "")}%`;
    where.push(Prisma.sql`(l."code" LIKE ${q} OR upper(l."shortCode") LIKE ${q})`);
  }
  if (input.onlyFree) {
    where.push(Prisma.sql`(l."capacity" IS NULL OR l."occupiedCount" + l."reservedCount" < l."capacity")`);
  }
  if (input.cursor) {
    const idx = input.cursor.indexOf(":");
    const seq = Number.parseInt(input.cursor.slice(0, idx), 10);
    const code = input.cursor.slice(idx + 1);
    if (Number.isFinite(seq) && code) where.push(Prisma.sql`(l."walkSequence", l."code") > (${seq}, ${code})`);
  }
  const rows = await conn.$queryRaw<LocationDbRow[]>(Prisma.sql`
    SELECT ${LOCATION_COLUMNS}
    FROM "WarehouseLocation" l JOIN "WarehouseSite" s ON s."id" = l."siteId"
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY l."walkSequence", l."code"
    LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit).map(toLocationSummary);
  const last = page[page.length - 1];
  return { items: page, nextCursor: rows.length > limit && last ? `${last.walkSequence}:${last.code}` : null };
}

export type SiteStructure = {
  site: SiteRow;
  totals: { levels: number; capacity: number; occupied: number; reserved: number; blocked: number };
  sectors: {
    sector: string;
    rows: { rowNo: number; racks: number; levels: number; capacity: number; occupied: number; reserved: number; blocked: number }[];
  }[];
  special: LocationSummary[];
};

/** Site hierarchy with occupancy rates — aggregated in SQL (one row per aisle, not per level). */
export async function getSiteStructure(conn: WarehouseConn, siteId: string): Promise<SiteStructure> {
  const site = await getSite(conn, siteId);
  const rows = await conn.$queryRaw<
    { sector: string; rowNo: number; racks: number; levels: number; capacity: number; occupied: number; reserved: number; blocked: number }[]
  >(Prisma.sql`
    SELECT "sector", "rowNo",
      count(DISTINCT "rackNo")::int AS "racks", count(*)::int AS "levels",
      coalesce(sum("capacity"), 0)::int AS "capacity", sum("occupiedCount")::int AS "occupied",
      sum("reservedCount")::int AS "reserved", count(*) FILTER (WHERE "status" = 'BLOCKED')::int AS "blocked"
    FROM "WarehouseLocation"
    WHERE "siteId" = ${site.id} AND "kind" = 'LEVEL' AND "status" <> 'RETIRED'
    GROUP BY "sector", "rowNo" ORDER BY "sector", "rowNo"`);
  const special = await conn.$queryRaw<LocationDbRow[]>(Prisma.sql`
    SELECT ${LOCATION_COLUMNS} FROM "WarehouseLocation" l JOIN "WarehouseSite" s ON s."id" = l."siteId"
    WHERE l."siteId" = ${site.id} AND l."holdsUnits" = true AND l."kind" <> 'LEVEL' AND l."status" <> 'RETIRED'
    ORDER BY l."kind", l."code"`);
  const sectors = new Map<string, SiteStructure["sectors"][number]>();
  const totals = { levels: 0, capacity: 0, occupied: 0, reserved: 0, blocked: 0 };
  for (const r of rows) {
    if (!sectors.has(r.sector)) sectors.set(r.sector, { sector: r.sector, rows: [] });
    sectors.get(r.sector)!.rows.push({
      rowNo: r.rowNo,
      racks: r.racks,
      levels: r.levels,
      capacity: r.capacity,
      occupied: r.occupied,
      reserved: r.reserved,
      blocked: r.blocked,
    });
    totals.levels += r.levels;
    totals.capacity += r.capacity;
    totals.occupied += r.occupied;
    totals.reserved += r.reserved;
    totals.blocked += r.blocked;
  }
  return { site, totals, sectors: [...sectors.values()], special: special.map(toLocationSummary) };
}

/**
 * Apply occupancy deltas. Rows are locked in id order so two concurrent moves that touch the
 * same pair of locations in opposite directions cannot deadlock.
 */
export async function adjustOccupancyTx(tx: WarehouseTx, deltas: { locationId: string | null; delta: number }[]): Promise<void> {
  const merged = new Map<string, number>();
  for (const d of deltas) {
    if (!d.locationId || d.delta === 0) continue;
    merged.set(d.locationId, (merged.get(d.locationId) ?? 0) + d.delta);
  }
  for (const [locationId, delta] of [...merged.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (delta === 0) continue;
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseLocation" SET "occupiedCount" = "occupiedCount" + ${delta}, "updatedAt" = now()
      WHERE "id" = ${locationId}`);
  }
}

export type CounterDrift = {
  locationId: string;
  code: string;
  occupiedCount: number;
  actualOccupied: number;
  reservedCount: number;
  actualReserved: number;
};

/**
 * C42: compare the denormalized counters with the source of truth (units present at the address,
 * RESERVED tasks). `fix` rewrites the counters from the truth — identities are never touched.
 */
export async function reconcileLocationCounters(
  db: WarehouseDb,
  input: { siteId: string; fix?: boolean }
): Promise<{ checked: number; drifts: CounterDrift[]; fixed: number }> {
  if (input.fix) assertWritesEnabled();
  return withTx(
    db,
    async (tx) => {
      const drifts = await tx.$queryRaw<CounterDrift[]>(Prisma.sql`
        SELECT l."id" AS "locationId", l."code", l."occupiedCount", coalesce(u.n, 0)::int AS "actualOccupied",
               l."reservedCount", coalesce(t.n, 0)::int AS "actualReserved"
        FROM "WarehouseLocation" l
        LEFT JOIN (SELECT "currentLocationId" AS id, count(*) AS n FROM "WarehouseUnit"
                   WHERE "presence" = 'PRESENT' AND "currentSiteId" = ${input.siteId} GROUP BY 1) u ON u.id = l."id"
        LEFT JOIN (SELECT "proposedLocationId" AS id, count(*) AS n FROM "WarehousePutawayTask"
                   WHERE "status" = 'RESERVED' AND "siteId" = ${input.siteId} GROUP BY 1) t ON t.id = l."id"
        WHERE l."siteId" = ${input.siteId} AND l."holdsUnits" = true
          AND (l."occupiedCount" <> coalesce(u.n, 0) OR l."reservedCount" <> coalesce(t.n, 0))
        ORDER BY l."code"`);
      const checked = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT count(*)::int AS n FROM "WarehouseLocation" WHERE "siteId" = ${input.siteId} AND "holdsUnits" = true`);
      let fixed = 0;
      if (input.fix) {
        for (const d of drifts) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE "WarehouseLocation" SET "occupiedCount" = ${d.actualOccupied}, "reservedCount" = ${d.actualReserved},
              "updatedAt" = now() WHERE "id" = ${d.locationId}`);
          fixed += 1;
        }
      }
      return { checked: checked[0].n, drifts, fixed };
    },
    { timeoutMs: 120_000 }
  );
}

export function assertLocationUsable(
  loc: Pick<LocationSummary, "holdsUnits" | "status" | "code">,
  siteId?: string,
  locSiteId?: string
): void {
  if (!loc.holdsUnits) {
    throw new WarehouseError("LOCATION_NOT_USABLE", `${loc.code} est un repère de structure, pas un emplacement de paires.`, 409);
  }
  if (loc.status === "RETIRED") {
    throw new WarehouseError("LOCATION_NOT_USABLE", `${loc.code} est retiré.`, 409);
  }
  if (siteId && locSiteId && siteId !== locSiteId) {
    throw new WarehouseError("SITE_MISMATCH", `${loc.code} appartient à un autre site.`, 409);
  }
}
