import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { WarehouseConn, WarehouseDb } from "./db";
import { WarehouseError, conflict, invalid, isUniqueViolation, notFound } from "./errors";
import { assertWritesEnabled } from "./operations";

/**
 * Individual operators. Staff login is a shared role password (existing dashboard); the
 * operator identifies the PERSON behind a sensitive gesture (C17), independently of the station.
 * Deactivating an operator takes effect on the next request, even from an open tab (C16).
 */

export type OperatorRow = { id: string; code: string; name: string; active: boolean; hasPin: boolean; createdAt: string };

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `s1$${salt.toString("hex")}$${scryptSync(pin, salt, 32).toString("hex")}`;
}

function checkPin(pin: string, stored: string): boolean {
  const [version, saltHex, hashHex] = stored.split("$");
  if (version !== "s1" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const toRow = (r: any): OperatorRow => ({ id: r.id, code: r.code, name: r.name, active: r.active, hasPin: Boolean(r.pinHash), createdAt: new Date(r.createdAt).toISOString() });

export async function listOperators(conn: WarehouseConn, opts: { activeOnly?: boolean } = {}): Promise<OperatorRow[]> {
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`
    SELECT "id", "code", "name", "active", "pinHash", "createdAt" FROM "WarehouseOperator"
    ${opts.activeOnly ? Prisma.sql`WHERE "active" = true` : Prisma.empty} ORDER BY "name"`);
  return rows.map(toRow);
}

function validatePin(pin: string | null | undefined): string | null {
  if (pin === null || pin === undefined || pin === "") return null;
  if (!/^[0-9]{4,8}$/.test(pin)) throw invalid("PIN : 4 à 8 chiffres.");
  return pin;
}

export async function createOperator(db: WarehouseDb, input: { code?: string; name: string; pin?: string | null }): Promise<OperatorRow> {
  assertWritesEnabled();
  const name = String(input.name ?? "").trim();
  if (name.length < 2) throw invalid("Nom de l'opérateur requis.");
  const code = (String(input.code ?? "").trim() || name.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "OP").toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(code)) throw invalid("Code opérateur : 2 à 12 lettres ou chiffres.");
  const pin = validatePin(input.pin);
  const id = randomUUID();
  try {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "WarehouseOperator" ("id", "code", "name", "pinHash") VALUES (${id}, ${code}, ${name}, ${pin ? hashPin(pin) : null})`);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("CONFLICT", `Le code opérateur ${code} existe déjà.`);
    throw err;
  }
  return (await listOperators(db)).find((o) => o.id === id) as OperatorRow;
}

export async function updateOperator(
  db: WarehouseDb,
  operatorId: string,
  patch: { name?: string; active?: boolean; pin?: string | null }
): Promise<OperatorRow> {
  assertWritesEnabled();
  const rows = await db.$queryRaw<any[]>(Prisma.sql`SELECT "id", "name", "active", "pinHash" FROM "WarehouseOperator" WHERE "id" = ${operatorId}`);
  if (!rows[0]) throw notFound("Opérateur");
  if (patch.active === false && rows[0].active) {
    // Named gestures are required as soon as one operator is active: switching the last one off
    // would silently bring anonymous gestures back (C16).
    const others = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n FROM "WarehouseOperator" WHERE "active" = true AND "id" <> ${operatorId}`);
    if (others[0].n === 0) {
      throw conflict("CONFLICT", "Dernier opérateur actif : créez ou réactivez un autre opérateur avant de désactiver celui-ci. Sans opérateur actif, les gestes ne seraient plus nominatifs.");
    }
  }
  const pinHash = patch.pin === undefined ? rows[0].pinHash : patch.pin === null || patch.pin === "" ? null : hashPin(validatePin(patch.pin) as string);
  await db.$executeRaw(Prisma.sql`
    UPDATE "WarehouseOperator" SET "name" = ${patch.name?.trim() || rows[0].name}, "active" = ${patch.active ?? rows[0].active},
      "pinHash" = ${pinHash}, "updatedAt" = now() WHERE "id" = ${operatorId}`);
  if (patch.pin !== undefined) pinFailures.delete(operatorId);
  return (await listOperators(db)).find((o) => o.id === operatorId) as OperatorRow;
}

/** Wrong PINs in a row before an operator is locked, and for how long. Kept in the process: a restart clears it. */
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MS = 5 * 60_000;
const pinFailures = new Map<string, { count: number; lockedUntil: number }>();

/** Test seam. */
export function resetPinThrottle(): void {
  pinFailures.clear();
}

/**
 * Identify the person at the desk. Returns the operator when active and the PIN (if any) matches.
 * A 4-digit PIN is short: after `PIN_MAX_FAILURES` wrong codes in a row the operator is locked for
 * `PIN_LOCK_MS`, and even the right code is refused until then.
 */
export async function verifyOperator(conn: WarehouseConn, input: { operatorId: string; pin?: string | null }, now: number = Date.now()): Promise<OperatorRow | null> {
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`
    SELECT "id", "code", "name", "active", "pinHash", "createdAt" FROM "WarehouseOperator" WHERE "id" = ${input.operatorId}`);
  const op = rows[0];
  if (!op || !op.active) return null;
  if (op.pinHash) {
    const state = pinFailures.get(op.id);
    if (state && state.lockedUntil > now) {
      const retryAfterSeconds = Math.ceil((state.lockedUntil - now) / 1000);
      throw new WarehouseError("UNAUTHORIZED", `Trop de codes PIN erronés pour ${op.name}. Réessayer dans ${Math.ceil(retryAfterSeconds / 60)} min, ou demander à l'administration de changer le code.`, 429, {
        pinLocked: true,
        retryAfterSeconds,
      });
    }
    if (!checkPin(String(input.pin ?? ""), op.pinHash)) {
      const count = (state?.count ?? 0) + 1;
      pinFailures.set(op.id, count >= PIN_MAX_FAILURES ? { count: 0, lockedUntil: now + PIN_LOCK_MS } : { count, lockedUntil: 0 });
      return null;
    }
    pinFailures.delete(op.id);
  }
  return toRow(op);
}

export async function isOperatorActive(conn: WarehouseConn, operatorId: string): Promise<boolean> {
  const rows = await conn.$queryRaw<{ active: boolean }[]>(Prisma.sql`SELECT "active" FROM "WarehouseOperator" WHERE "id" = ${operatorId}`);
  return Boolean(rows[0]?.active);
}
