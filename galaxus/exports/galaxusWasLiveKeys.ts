import { prisma } from "@/app/lib/prisma";

/**
 * ProviderKeys that still need a QuantityOnStock=0 delist row:
 * - Galaxus CLS still shows lastPushedStock > 0 (we once listed them), AND
 * - last stock snapshot is missing or still positive (not already zeroed).
 *
 * Keys already at 0 in the snapshot were pushed (or built) as delists — do not
 * pad the feed forever (~380k sticky zeros → 872k stock vs ~490k offer).
 */
export async function loadGalaxusDelistZeroEligibleKeys(): Promise<Set<string>> {
  const prismaAny = prisma as any;
  const rows = (await prismaAny.$queryRaw`
    SELECT c."providerKey" AS "providerKey"
    FROM "ChannelListingState" c
    LEFT JOIN "GalaxusFeedStockSnapshot" s ON s."providerKey" = c."providerKey"
    WHERE c.channel = 'GALAXUS'
      AND c."lastPushedStock" > 0
      AND (
        s."providerKey" IS NULL
        OR coalesce((s."rowJson"->>'QuantityOnStock')::int, 0) > 0
      )
  `) as Array<{ providerKey?: string | null }>;

  const out = new Set<string>();
  for (const row of rows) {
    const key = String(row?.providerKey ?? "").trim();
    if (key) out.add(key);
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
