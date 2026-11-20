import { prisma } from "@/app/lib/prisma";

/**
 * One Galaxus offer per product: every supplier stays in the DB and keeps refreshing, but only
 * the cheapest in-stock candidate (accumulateBestCandidates) is published in stock + offer.
 *
 * Products are matched on the GTIN-14 value (leading zeros dropped), like GS1 and Galaxus:
 * NER `198730461243` and STX `0198730461243` are the same sneaker.
 *
 * Full rebuilds see every supplier. Live patches only get the keys that changed (one STX
 * refresh), so they pull the same-product siblings in, or the patched loser is re-published
 * next to the winner.
 */

const SIBLING_LOOKUP_CHUNK = 2000;
const SNAPSHOT_LOOKUP_CHUNK = 5000;
const CLS_LOOKUP_CHUNK = 5000;
const GTIN_LENGTHS = [8, 12, 13, 14] as const;

/** GTIN-14 value without leading zeros. Null when `gtin` is not 8/12/13/14 digits. */
export function gtinCore(gtin: string | null | undefined): string | null {
  const raw = String(gtin ?? "").trim();
  if (!/^\d+$/.test(raw) || !(GTIN_LENGTHS as readonly number[]).includes(raw.length)) return null;
  const core = raw.replace(/^0+/, "");
  return core || null;
}

/** Every 8/12/13/14-digit spelling of the same GTIN. */
export function gtinSpellings(gtin: string | null | undefined): string[] {
  const core = gtinCore(gtin);
  if (!core) return [];
  return GTIN_LENGTHS.filter((len) => len >= core.length).map((len) => core.padStart(len, "0"));
}

/** `STX_0194513902217` → `0194513902217`. Null when the suffix is not a GTIN. */
export function gtinOfProviderKey(providerKey: string | null | undefined): string | null {
  const key = String(providerKey ?? "").trim();
  const idx = key.indexOf("_");
  if (idx <= 0) return null;
  const gtin = key.slice(idx + 1);
  return gtinCore(gtin) ? gtin : null;
}

export function gtinCoreOfProviderKey(providerKey: string | null | undefined): string | null {
  return gtinCore(gtinOfProviderKey(providerKey));
}

function prefixOfProviderKey(providerKey: string): string | null {
  const idx = providerKey.indexOf("_");
  return idx > 0 ? providerKey.slice(0, idx) : null;
}

/**
 * Requested keys plus every other key of the same product:
 * - `keys`: requested ∪ mapped siblings (any GTIN spelling) — what the export must elect over;
 * - `publishedSiblings`: extra keys already in the stock/offer snapshot (listing aliases)
 *   that the export cannot emit by themselves but may need retiring;
 * - `siblingsByKey`: per requested key, the other keys found for its product.
 */
export async function expandProviderKeysWithGtinSiblings(keys: string[]): Promise<{
  keys: string[];
  publishedSiblings: string[];
  siblingsByKey: Map<string, string[]>;
}> {
  const requested = Array.from(new Set(keys.map((k) => String(k ?? "").trim()).filter(Boolean)));
  const siblingsByKey = new Map<string, string[]>();
  const cores = new Set<string>();
  for (const key of requested) {
    const core = gtinCoreOfProviderKey(key);
    if (core) cores.add(core);
  }
  if (cores.size === 0) return { keys: requested, publishedSiblings: [], siblingsByKey };

  const spellings = Array.from(cores).flatMap((core) => gtinSpellings(core));
  const mappedByCore = new Map<string, Set<string>>();
  const prismaAny = prisma as any;
  for (let i = 0; i < spellings.length; i += SIBLING_LOOKUP_CHUNK) {
    const chunk = spellings.slice(i, i + SIBLING_LOOKUP_CHUNK);
    const rows: Array<{ gtin: string | null; providerKey: string | null }> =
      await prismaAny.variantMapping.findMany({
        where: { gtin: { in: chunk }, providerKey: { not: null } },
        select: { gtin: true, providerKey: true },
      });
    for (const row of rows) {
      const core = gtinCore(row.gtin);
      const pk = String(row.providerKey ?? "").trim();
      if (!core || !pk) continue;
      if (!mappedByCore.has(core)) mappedByCore.set(core, new Set());
      mappedByCore.get(core)!.add(pk);
    }
  }

  // Aliases keep the supplier prefix but may carry another GTIN spelling.
  const probeKeys = new Set<string>();
  for (const core of cores) {
    const prefixes = new Set<string>();
    for (const pk of mappedByCore.get(core) ?? []) {
      const p = prefixOfProviderKey(pk);
      if (p) prefixes.add(p);
    }
    for (const key of requested) {
      if (gtinCoreOfProviderKey(key) !== core) continue;
      const p = prefixOfProviderKey(key);
      if (p) prefixes.add(p);
    }
    for (const p of prefixes) {
      for (const spelling of gtinSpellings(core)) probeKeys.add(`${p}_${spelling}`);
    }
  }
  const publishedByCore = new Map<string, Set<string>>();
  const probe = Array.from(probeKeys);
  const probeModels = [prismaAny.galaxusFeedOfferSnapshot, prismaAny.galaxusFeedStockSnapshot].filter(
    (model) => typeof model?.findMany === "function"
  );
  for (let i = 0; i < probe.length; i += SNAPSHOT_LOOKUP_CHUNK) {
    const chunk = probe.slice(i, i + SNAPSHOT_LOOKUP_CHUNK);
    const results: Array<Array<{ providerKey: string }>> = await Promise.all(
      probeModels.map((model) =>
        model.findMany({ where: { providerKey: { in: chunk } }, select: { providerKey: true } })
      )
    );
    for (const row of results.flat()) {
      const core = gtinCoreOfProviderKey(row.providerKey);
      if (!core) continue;
      if (!publishedByCore.has(core)) publishedByCore.set(core, new Set());
      publishedByCore.get(core)!.add(row.providerKey);
    }
  }

  const exportKeys = new Set(requested);
  for (const mapped of mappedByCore.values()) for (const pk of mapped) exportKeys.add(pk);
  const published = new Set<string>();
  for (const keysOfCore of publishedByCore.values()) {
    for (const pk of keysOfCore) if (!exportKeys.has(pk)) published.add(pk);
  }

  for (const key of requested) {
    const core = gtinCoreOfProviderKey(key);
    if (!core) continue;
    const others = new Set<string>([
      ...(mappedByCore.get(core) ?? []),
      ...(publishedByCore.get(core) ?? []),
    ]);
    others.delete(key);
    if (others.size > 0) siblingsByKey.set(key, Array.from(others));
  }
  return { keys: Array.from(exportKeys), publishedSiblings: Array.from(published), siblingsByKey };
}

type CsvRow = Record<string, string>;

/**
 * GTIN core → ProviderKey really live in this export: offer row present AND stock row with
 * QuantityOnStock > 0. A winner without positive stock does not cover its product.
 */
export function liveWinnerKeyByGtin(stockRows: CsvRow[], offerRows: CsvRow[]): Map<string, string> {
  const offerKeys = new Set(offerRows.map((r) => String(r.ProviderKey ?? "").trim()).filter(Boolean));
  const out = new Map<string, string>();
  for (const row of stockRows) {
    const key = String(row.ProviderKey ?? "").trim();
    if (!key || !offerKeys.has(key)) continue;
    const qty = Number.parseFloat(String(row.QuantityOnStock ?? "0"));
    if (!(qty > 0)) continue;
    const core = gtinCoreOfProviderKey(key);
    if (core && !out.has(core)) out.set(core, key);
  }
  return out;
}

/**
 * Keys the export did not publish because another key of the same product is live.
 * That is an election result, not an export blip: those rows must leave the snapshot.
 */
export function findGtinElectionLosers(
  keys: string[],
  stockRows: CsvRow[],
  offerRows: CsvRow[]
): Set<string> {
  const winners = liveWinnerKeyByGtin(stockRows, offerRows);
  const offerKeys = new Set(offerRows.map((r) => String(r.ProviderKey ?? "").trim()).filter(Boolean));
  const losers = new Set<string>();
  for (const raw of keys) {
    const key = String(raw ?? "").trim();
    if (!key || offerKeys.has(key)) continue;
    const core = gtinCoreOfProviderKey(key);
    const winner = core ? winners.get(core) : undefined;
    if (winner && winner !== key) losers.add(key);
  }
  return losers;
}

/** Keys present in the master snapshot (Galaxus has product data for them). */
export async function loadMasterSnapshotKeySet(keys: Iterable<string>): Promise<Set<string>> {
  const list = Array.from(new Set(Array.from(keys).map((k) => String(k ?? "").trim()).filter(Boolean)));
  const out = new Set<string>();
  const prismaAny = prisma as any;
  for (let i = 0; i < list.length; i += SNAPSHOT_LOOKUP_CHUNK) {
    const chunk = list.slice(i, i + SNAPSHOT_LOOKUP_CHUNK);
    const rows: Array<{ providerKey: string }> = await prismaAny.galaxusFeedMasterSnapshot.findMany({
      where: { providerKey: { in: chunk } },
      select: { providerKey: true },
    });
    for (const row of rows) out.add(row.providerKey);
  }
  return out;
}

/** Galaxus keys still live (lastPushedStock > 0) per supplier variant — includes listing aliases. */
export async function loadLiveGalaxusKeysBySupplierVariant(
  supplierVariantIds: Iterable<string>
): Promise<Map<string, string[]>> {
  const ids = Array.from(
    new Set(Array.from(supplierVariantIds).map((id) => String(id ?? "").trim()).filter(Boolean))
  );
  const out = new Map<string, string[]>();
  const prismaAny = prisma as any;
  for (let i = 0; i < ids.length; i += CLS_LOOKUP_CHUNK) {
    const rows: Array<{ supplierVariantId: string | null; providerKey: string }> =
      await prismaAny.channelListingState.findMany({
        where: {
          channel: "GALAXUS",
          lastPushedStock: { gt: 0 },
          supplierVariantId: { in: ids.slice(i, i + CLS_LOOKUP_CHUNK) },
        },
        select: { supplierVariantId: true, providerKey: true },
      });
    for (const row of rows) {
      const svId = String(row.supplierVariantId ?? "").trim();
      const pk = String(row.providerKey ?? "").trim();
      if (!svId || !pk) continue;
      const list = out.get(svId) ?? [];
      if (!list.includes(pk)) list.push(pk);
      out.set(svId, list);
    }
  }
  return out;
}
