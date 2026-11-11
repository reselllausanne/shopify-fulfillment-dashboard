import { prisma } from "@/app/lib/prisma";

/**
 * ProviderKeys that still need a QuantityOnStock=0 delist row:
 * - Galaxus CLS still shows lastPushedStock > 0 (we once listed them), AND
 * - last stock snapshot is missing or still positive (not already zeroed).
 *
 * Keys already at 0 in the snapshot were pushed (or built) as delists — do not
 * pad the feed forever (~380k sticky zeros → 872k stock vs ~490k offer).
 */
/**
 * Above this many keys a scoped lookup stops paying off (and the array param gets large):
 * fall back to the full-table scans.
 */
export const DELIST_SCOPE_MAX_KEYS = 20_000;

/**
 * Eligibility decided only for `scope` keys. Any key OUTSIDE the scope answers `true`
 * (= emit the zero), which is the same fail-open direction as a load error: a needed delist
 * is never skipped, at worst a redundant zero row is emitted.
 */
class ScopedDelistEligibleSet extends Set<string> {
  private readonly scope: ReadonlySet<string>;
  constructor(scope: ReadonlySet<string>, eligible: Iterable<string>) {
    super(eligible);
    this.scope = scope;
  }
  override has(key: string): boolean {
    return !this.scope.has(key) || super.has(key);
  }
}

/**
 * @param scopeKeys when provided (live patch export for a handful of keys), only these keys
 *   are looked up by index instead of scanning ~380k CLS rows + the whole 1.6M-row stock
 *   snapshot (JSON predicate) on every patch. Semantics per key are identical to the full load.
 */
export async function loadGalaxusDelistZeroEligibleKeys(
  scopeKeys?: ReadonlyArray<string> | null
): Promise<Set<string>> {
  const prismaAny = prisma as any;

  const scoped = Array.from(
    new Set((scopeKeys ?? []).map((k) => String(k ?? "").trim()).filter(Boolean))
  );
  if (scopeKeys != null && scoped.length > 0 && scoped.length <= DELIST_SCOPE_MAX_KEYS) {
    const [liveScoped, zeroedScoped] = await Promise.all([
      prismaAny.$queryRaw`
        SELECT c."providerKey" AS "providerKey"
        FROM "ChannelListingState" c
        WHERE c.channel = 'GALAXUS'
          AND c."lastPushedStock" > 0
          AND c."providerKey" = ANY(${scoped}::text[])
      ` as Promise<Array<{ providerKey?: string | null }>>,
      prismaAny.$queryRaw`
        SELECT s."providerKey" AS "providerKey"
        FROM "GalaxusFeedStockSnapshot" s
        WHERE s."providerKey" = ANY(${scoped}::text[])
          AND coalesce((s."rowJson"->>'QuantityOnStock')::int, 0) <= 0
      ` as Promise<Array<{ providerKey?: string | null }>>,
    ]);
    const zeroed = new Set<string>();
    for (const row of zeroedScoped) {
      const key = String(row?.providerKey ?? "").trim();
      if (key) zeroed.add(key);
    }
    const eligible = new Set<string>();
    for (const row of liveScoped) {
      const key = String(row?.providerKey ?? "").trim();
      if (key && !zeroed.has(key)) eligible.add(key);
    }
    return new ScopedDelistEligibleSet(new Set(scoped), eligible);
  }

  // Two cheap sequential scans + set difference in memory.
  //
  // The previous single statement (`CLS LEFT JOIN snapshot … rowJson->>'QuantityOnStock'`)
  // let the planner under-estimate the CLS side 6x (63k est. vs 383k actual) and pick a
  // nested loop with ~383k random index lookups into the snapshot: 85 s and ~180k disk
  // block reads per call (13.5 s mean over 7.7k calls, run on every feed build).
  // Semantics are unchanged: a key is eligible when it still shows lastPushedStock > 0 on
  // Galaxus AND is NOT already present in the stock snapshot with quantity <= 0.
  const [liveRows, zeroedRows] = await Promise.all([
    prismaAny.$queryRaw`
      SELECT c."providerKey" AS "providerKey"
      FROM "ChannelListingState" c
      WHERE c.channel = 'GALAXUS'
        AND c."lastPushedStock" > 0
    ` as Promise<Array<{ providerKey?: string | null }>>,
    prismaAny.$queryRaw`
      SELECT s."providerKey" AS "providerKey"
      FROM "GalaxusFeedStockSnapshot" s
      WHERE coalesce((s."rowJson"->>'QuantityOnStock')::int, 0) <= 0
    ` as Promise<Array<{ providerKey?: string | null }>>,
  ]);

  const alreadyZeroed = new Set<string>();
  for (const row of zeroedRows) {
    const key = String(row?.providerKey ?? "").trim();
    if (key) alreadyZeroed.add(key);
  }

  const out = new Set<string>();
  for (const row of liveRows) {
    const key = String(row?.providerKey ?? "").trim();
    if (key && !alreadyZeroed.has(key)) out.add(key);
  }
  return out;
}

/** @deprecated use {@link loadGalaxusDelistZeroEligibleKeys} */
export async function loadGalaxusWasLiveProviderKeys(): Promise<Set<string>> {
  return loadGalaxusDelistZeroEligibleKeys();
}

/** Fail-open when `eligible` is null (load error) so we never skip a needed delist. */
export function shouldEmitGalaxusDelistZero(
  providerKey: string | null | undefined,
  eligible: Set<string> | null
): boolean {
  const key = String(providerKey ?? "").trim();
  if (!key) return false;
  if (eligible == null) return true;
  return eligible.has(key);
}

/**
 * After a successful stock SFTP upload, mirror QuantityOnStock into
 * ChannelListingState so sticky lastPushedStock>0 rows clear and the next
 * export can drop already-delisted zeros.
 */
export async function syncGalaxusListingStockFromCsv(csv: string): Promise<{
  parsed: number;
  updated: number;
}> {
  if (!csv.trim()) return { parsed: 0, updated: 0 };
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return { parsed: 0, updated: 0 };

  const header = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  const keyIdx = header.findIndex((h) => h === "ProviderKey");
  const qtyIdx = header.findIndex((h) => h === "QuantityOnStock");
  if (keyIdx < 0 || qtyIdx < 0) return { parsed: 0, updated: 0 };

  const pairs: Array<{ key: string; qty: number }> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const key = String(cols[keyIdx] ?? "")
      .replace(/^"|"$/g, "")
      .trim();
    if (!key) continue;
    const qty = Math.max(0, Number.parseInt(String(cols[qtyIdx] ?? "0").replace(/^"|"$/g, ""), 10) || 0);
    pairs.push({ key, qty });
  }
  if (pairs.length === 0) return { parsed: 0, updated: 0 };

  const prismaAny = prisma as any;
  const CHUNK = 1000;
  let updated = 0;
  const now = new Date();
  for (let offset = 0; offset < pairs.length; offset += CHUNK) {
    const chunk = pairs.slice(offset, offset + CHUNK);
    const result = await prismaAny.$executeRawUnsafe(
      `
      UPDATE "ChannelListingState" AS c
      SET
        "lastPushedStock" = v.qty,
        "status" = CASE WHEN v.qty <= 0 THEN 'SOLD_OUT' ELSE 'ACTIVE' END,
        "soldOutAt" = CASE
          WHEN v.qty <= 0 THEN COALESCE(c."soldOutAt", $1::timestamp)
          ELSE NULL
        END,
        "lastSyncedAt" = $1::timestamp,
        "updatedAt" = $1::timestamp
      FROM (
        SELECT * FROM UNNEST($2::text[], $3::int[]) AS t("providerKey", qty)
      ) AS v
      WHERE c.channel = 'GALAXUS'
        AND c."providerKey" = v."providerKey"
      `,
      now,
      chunk.map((p) => p.key),
      chunk.map((p) => p.qty)
    );
    updated += Number(result ?? 0);
  }
  return { parsed: pairs.length, updated };
}

/** Minimal CSV split for unquoted/quoted fields (ProviderKey / qty are simple). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
