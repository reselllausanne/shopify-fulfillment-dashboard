import { prisma } from "@/app/lib/prisma";
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import { patchFeedSnapshotsForProviderKeys, invalidateFeedSnapshot } from "@/galaxus/exports/feedSnapshot";
import { startFeedPushAsync } from "@/galaxus/ops/feedPipelineCore";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";

const DEBOUNCE_MS = 45_000;
/** Above this, invalidate snapshot instead of per-key HTTP patch (full live until rebuild). */
const PATCH_KEY_CAP = 2_000;
const PATCH_CHUNK = 80;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingSupplierVariantIds = new Set<string>();

function cleanSvIds(ids: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (id) out.add(id);
  }
  return Array.from(out);
}

/**
 * Resolve Galaxus providerKeys for refreshed STX variants.
 * Includes both SupplierVariant.providerKey and VariantMapping.providerKey (GTIN drift).
 */
export async function resolveGalaxusProviderKeysForSupplierVariantIds(
  supplierVariantIds: string[]
): Promise<string[]> {
  const ids = cleanSvIds(supplierVariantIds);
  if (ids.length === 0) return [];

  const prismaAny = prisma as any;
  const [variants, mappings] = await Promise.all([
    prismaAny.supplierVariant.findMany({
      where: { supplierVariantId: { in: ids } },
      select: { providerKey: true, gtin: true, supplierVariantId: true },
    }),
    prismaAny.variantMapping.findMany({
      where: { supplierVariantId: { in: ids } },
      select: { providerKey: true, gtin: true, supplierVariantId: true },
    }),
  ]);

  const keys = new Set<string>();
  for (const row of variants as Array<{
    providerKey?: string | null;
    gtin?: string | null;
    supplierVariantId?: string;
  }>) {
    const pk = String(row.providerKey ?? "").trim();
    if (pk) keys.add(pk);
    const built = buildProviderKey(row.gtin, row.supplierVariantId);
    if (built) keys.add(built);
  }
  for (const row of mappings as Array<{
    providerKey?: string | null;
    gtin?: string | null;
    supplierVariantId?: string;
  }>) {
    const pk = String(row.providerKey ?? "").trim();
    if (pk) keys.add(pk);
    const built = buildProviderKey(row.gtin, row.supplierVariantId);
    if (built) keys.add(built);
  }
  return Array.from(keys);
}

/**
 * Prefer VariantMapping GTIN as Galaxus identity: copy mapping.gtin + providerKey onto SV
 * when they differ (DualSense-class orphan: SV.providerKey ≠ mapping.providerKey).
 */
export async function alignStxSupplierVariantKeysToMappings(
  supplierVariantIds: string[]
): Promise<{ aligned: number }> {
  const ids = cleanSvIds(supplierVariantIds);
  if (ids.length === 0) return { aligned: 0 };

  const prismaAny = prisma as any;
  const mappings = await prismaAny.variantMapping.findMany({
    where: {
      supplierVariantId: { in: ids },
      providerKey: { startsWith: "STX_" },
      gtin: { not: null },
    },
    select: { supplierVariantId: true, providerKey: true, gtin: true },
  });

  let aligned = 0;
  for (const m of mappings as Array<{
    supplierVariantId: string;
    providerKey: string | null;
    gtin: string | null;
  }>) {
    const svId = String(m.supplierVariantId ?? "").trim();
    const mapPk = String(m.providerKey ?? "").trim();
    const mapGtin = String(m.gtin ?? "").trim();
    if (!svId || !mapPk || !mapGtin) continue;

    const expected = buildProviderKey(mapGtin, svId) ?? mapPk;
    const updated = await prismaAny.supplierVariant.updateMany({
      where: {
        supplierVariantId: svId,
        OR: [{ providerKey: { not: expected } }, { gtin: { not: mapGtin } }],
      },
      data: { providerKey: expected, gtin: mapGtin },
    });
    aligned += Number(updated?.count ?? 0);
  }
  return { aligned };
}

async function patchKeysInChunks(origin: string, providerKeys: string[]): Promise<number> {
  let patched = 0;
  for (let i = 0; i < providerKeys.length; i += PATCH_CHUNK) {
    const chunk = providerKeys.slice(i, i + PATCH_CHUNK);
    const res = await patchFeedSnapshotsForProviderKeys({ origin, providerKeys: chunk });
    patched += res.patched;
  }
  return patched;
}

/**
 * After STX price/stock land in DB: patch Galaxus snapshots + one stock-price SFTP.
 * Debounced across refresh waves. Not dual stock+price; not fake manual-pricing.
 */
export function scheduleStxRefreshMarketplaceFeedPush(
  supplierVariantIds: Array<string | null | undefined>
): void {
  for (const id of cleanSvIds(supplierVariantIds)) {
    pendingSupplierVariantIds.add(id);
  }
  if (pendingSupplierVariantIds.size === 0) return;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const ids = Array.from(pendingSupplierVariantIds);
    pendingSupplierVariantIds.clear();
    void runStxRefreshMarketplaceFeedPush(ids).catch((err) => {
      console.error("[stx-refresh][galaxus-feed] unhandled", err);
    });
  }, DEBOUNCE_MS);
}

export async function runStxRefreshMarketplaceFeedPush(
  supplierVariantIds: string[]
): Promise<{
  ok: boolean;
  providerKeys: number;
  patched?: number;
  invalidated?: boolean;
  error?: string;
}> {
  const ids = cleanSvIds(supplierVariantIds);
  if (ids.length === 0) return { ok: true, providerKeys: 0 };

  try {
    const align = await alignStxSupplierVariantKeysToMappings(ids);
    if (align.aligned > 0) {
      console.info("[stx-refresh][galaxus-feed] aligned SV keys to mappings", align);
    }
  } catch (err: any) {
    console.warn("[stx-refresh][galaxus-feed] key align failed", err?.message ?? err);
  }

  const providerKeys = await resolveGalaxusProviderKeysForSupplierVariantIds(ids);
  if (providerKeys.length === 0) return { ok: true, providerKeys: 0 };

  const origin = resolveAppOriginForPartnerJobs(null) ?? "http://127.0.0.1:3000";

  try {
    let patched = 0;
    let invalidated = false;

    if (providerKeys.length > PATCH_KEY_CAP) {
      await invalidateFeedSnapshot();
      invalidated = true;
      console.info("[stx-refresh][galaxus-feed] invalidated snapshot (key cap)", {
        keys: providerKeys.length,
        cap: PATCH_KEY_CAP,
      });
    } else {
      patched = await patchKeysInChunks(origin, providerKeys);
    }

    // One combined upload (stock+offer), not two separate SFTP runs.
    const push = await startFeedPushAsync({
      origin,
      scope: "stock-price",
      triggerSource: "stx-refresh",
    });
    console.info("[stx-refresh][galaxus-feed] patched + stock-price push", {
      keys: providerKeys.length,
      patched,
      invalidated,
      pushOk: push.ok,
      queued: push.queued,
      runId: push.runId,
    });
    return {
      ok: Boolean(push.ok),
      providerKeys: providerKeys.length,
      patched,
      invalidated,
    };
  } catch (err: any) {
    console.error("[stx-refresh][galaxus-feed] failed", err);
    return { ok: false, providerKeys: providerKeys.length, error: err?.message ?? String(err) };
  }
}

/** @internal test helper */
export function resetStxRefreshFeedPushDebounceForTests(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  pendingSupplierVariantIds.clear();
}
