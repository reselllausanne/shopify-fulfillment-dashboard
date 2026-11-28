import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { isWarehouseWritesEnabled, isSiteInPilot } from "./config";
import { toPlain, withTx, type WarehouseDb, type WarehouseTx } from "./db";
import { WarehouseError } from "./errors";
import type { ActorContext } from "./types";

/**
 * Idempotent gesture runner.
 *
 * Every mutating gesture carries a client-generated action key (`opKey`). The key identifies the
 * physical action, not the payload: ten boxes with the same GTIN are ten keys; a network retry,
 * a double click or a page reload re-sends the same key and gets the stored result back.
 *
 * The ledger row, the state change and its movement are committed in ONE transaction. If the
 * body throws, nothing is stored and the same key can be retried.
 */

const OPKEY_RE = /^[A-Za-z0-9][A-Za-z0-9:_.-]{7,119}$/;

export function assertValidOpKey(opKey: unknown): asserts opKey is string {
  if (typeof opKey !== "string" || !OPKEY_RE.test(opKey)) {
    throw new WarehouseError(
      "INVALID_INPUT",
      "Clé d'action (opKey) manquante ou invalide : 8 à 120 caractères [A-Za-z0-9:_.-].",
      400
    );
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function hashRequest(request: unknown): string {
  return createHash("sha256").update(stableStringify(request)).digest("hex");
}

export type OperationMeta = {
  opKey: string;
  kind: string;
  /** Business payload: a retry must carry the same payload. */
  request: unknown;
  ctx: ActorContext;
};

export type OperationResult<T> = T & { opKey: string; replayed: boolean };

export function assertWritesEnabled(): void {
  if (!isWarehouseWritesEnabled()) {
    throw new WarehouseError(
      "WRITES_DISABLED",
      "Les écritures du module Entrepôt sont arrêtées (WAREHOUSE_WRITES_ENABLED). Les données déjà enregistrées restent consultables.",
      503
    );
  }
}

/**
 * Pilot perimeter: when WAREHOUSE_PILOT_SITES is set, new stock only enters on the listed sites
 * (batches opened, identities issued). Reads, scans and corrections of existing pairs stay
 * possible everywhere so a pair already labelled is never stranded.
 */
export function assertSiteInPilot(siteCode: string): void {
  if (!isSiteInPilot(siteCode)) {
    throw new WarehouseError(
      "SITE_NOT_IN_PILOT",
      `Le site ${siteCode} n'est pas dans le périmètre du pilote (WAREHOUSE_PILOT_SITES) : aucune entrée de stock n'y est ouverte.`,
      403,
      { siteCode }
    );
  }
}

export async function runOperation<T extends Record<string, unknown>>(
  db: WarehouseDb,
  meta: OperationMeta,
  body: (tx: WarehouseTx) => Promise<T>
): Promise<OperationResult<T>> {
  assertWritesEnabled();
  assertValidOpKey(meta.opKey);
  const requestHash = hashRequest(meta.request);

  return withTx(db, async (tx) => {
    const inserted = await tx.$queryRaw<{ opKey: string }[]>(Prisma.sql`
      INSERT INTO "WarehouseOperation" ("opKey", "kind", "requestHash", "status", "result", "actorRole", "operatorId", "stationId")
      VALUES (${meta.opKey}, ${meta.kind}, ${requestHash}, 'DONE', '{}'::jsonb, ${meta.ctx.role}, ${meta.ctx.operatorId ?? null}, ${meta.ctx.stationId ?? null})
      ON CONFLICT ("opKey") DO NOTHING
      RETURNING "opKey"`);

    if (inserted.length === 0) {
      const existing = await tx.$queryRaw<{ kind: string; requestHash: string; result: unknown }[]>(Prisma.sql`
        SELECT "kind", "requestHash", "result" FROM "WarehouseOperation" WHERE "opKey" = ${meta.opKey}`);
      const row = existing[0];
      if (!row) {
        // The concurrent transaction that held the key rolled back between our INSERT and SELECT.
        throw new WarehouseError("CONFLICT", "Action concurrente annulée, réessayez avec la même clé.", 409, {
          retryable: true,
        });
      }
      if (row.kind !== meta.kind || row.requestHash !== requestHash) {
        throw new WarehouseError(
          "OPKEY_REUSED",
          "Cette clé d'action a déjà servi pour une autre action. Générez une nouvelle clé pour un nouveau geste.",
          409,
          { kind: row.kind }
        );
      }
      return { ...(row.result as T), opKey: meta.opKey, replayed: true };
    }

    const result = toPlain(await body(tx));
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseOperation" SET "result" = ${JSON.stringify(result)}::jsonb WHERE "opKey" = ${meta.opKey}`);
    return { ...result, opKey: meta.opKey, replayed: false };
  });
}

/** Look up the outcome of a gesture whose HTTP answer was lost (C06 / C08). */
export async function getOperationResult(
  db: WarehouseDb,
  opKey: string
): Promise<{ found: boolean; kind?: string; result?: unknown; createdAt?: string }> {
  assertValidOpKey(opKey);
  const rows = await db.$queryRaw<{ kind: string; result: unknown; createdAt: Date }[]>(Prisma.sql`
    SELECT "kind", "result", "createdAt" FROM "WarehouseOperation" WHERE "opKey" = ${opKey}`);
  if (!rows[0]) return { found: false };
  return { found: true, kind: rows[0].kind, result: rows[0].result, createdAt: rows[0].createdAt.toISOString() };
}
