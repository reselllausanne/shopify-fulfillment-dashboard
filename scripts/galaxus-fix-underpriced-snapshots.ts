#!/usr/bin/env npx tsx
/**
 * One-shot: find STX Galaxus offer snapshot rows priced below locked floor
 * (or below buy), patch/delete via live export, then enqueue stock+price push.
 *
 * Usage:
 *   npx tsx scripts/galaxus-fix-underpriced-snapshots.ts
 *   npx tsx scripts/galaxus-fix-underpriced-snapshots.ts --dry-run
 *   npx tsx scripts/galaxus-fix-underpriced-snapshots.ts --limit=500
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import { calcGalaxusStxSellFromSourceCost } from "@/galaxus/exports/pricing";
import { patchFeedSnapshotsForProviderKeys } from "@/galaxus/exports/feedSnapshot";
import { startFeedPushAsync } from "@/galaxus/ops/feedPipelineCore";
import {
  alignStxSupplierVariantKeysToMappings,
  resolveGalaxusProviderKeysForSupplierVariantIds,
} from "@/galaxus/ops/stxRefreshFeedPush";

type UnderpricedRow = {
  providerKey: string;
  sellEx: number;
  buy: number | null;
  floorEx: number | null;
  supplierVariantId: string | null;
};

function argFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argNum(name: string, fallback: number): number {
  const prefix = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return fallback;
  const n = Number(hit.slice(prefix.length));
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

async function loadUnderpriced(limit: number): Promise<UnderpricedRow[]> {
  const prismaAny = prisma as any;
  const snaps: Array<{ providerKey: string; rowJson: Record<string, string> }> =
    await prismaAny.galaxusFeedOfferSnapshot.findMany({
      where: { providerKey: { startsWith: "STX_" } },
      select: { providerKey: true, rowJson: true },
    });

  const keys = snaps.map((s) => s.providerKey);
  const svByPk = new Map<string, { buy: number; supplierVariantId: string }>();
  const mapByPk = new Map<string, string>();

  for (let i = 0; i < keys.length; i += 2000) {
    const chunk = keys.slice(i, i + 2000);
    const [variants, mappings] = await Promise.all([
      prismaAny.supplierVariant.findMany({
        where: { providerKey: { in: chunk } },
        select: { providerKey: true, price: true, supplierVariantId: true },
      }),
      prismaAny.variantMapping.findMany({
        where: { providerKey: { in: chunk } },
        select: { providerKey: true, supplierVariantId: true },
      }),
    ]);
    for (const v of variants as Array<{
      providerKey: string | null;
      price: unknown;
      supplierVariantId: string;
    }>) {
      const pk = String(v.providerKey ?? "").trim();
      const buy = Number(v.price);
      if (!pk || !Number.isFinite(buy) || buy <= 0) continue;
      svByPk.set(pk, { buy, supplierVariantId: String(v.supplierVariantId) });
    }
    for (const m of mappings as Array<{ providerKey: string | null; supplierVariantId: string | null }>) {
      const pk = String(m.providerKey ?? "").trim();
      const svId = String(m.supplierVariantId ?? "").trim();
      if (pk && svId) mapByPk.set(pk, svId);
    }
  }

  // Resolve buys via mapping → SV when snapshot key ≠ SV.providerKey (GTIN drift).
  const orphanSvIds = Array.from(
    new Set(
      snaps
        .filter((s) => !svByPk.has(s.providerKey) && mapByPk.has(s.providerKey))
        .map((s) => mapByPk.get(s.providerKey)!)
    )
  );
  const buyBySvId = new Map<string, number>();
  for (let i = 0; i < orphanSvIds.length; i += 2000) {
    const chunk = orphanSvIds.slice(i, i + 2000);
    const rows = await prismaAny.supplierVariant.findMany({
      where: { supplierVariantId: { in: chunk } },
      select: { supplierVariantId: true, price: true },
    });
    for (const r of rows as Array<{ supplierVariantId: string; price: unknown }>) {
      const buy = Number(r.price);
      if (Number.isFinite(buy) && buy > 0) buyBySvId.set(String(r.supplierVariantId), buy);
    }
  }

  const out: UnderpricedRow[] = [];
  for (const snap of snaps) {
    const sellRaw = snap.rowJson?.PurchasePriceExclVat_CHF ?? snap.rowJson?.["PurchasePriceExclVat_CHF"];
    const sellEx = Number(sellRaw);
    if (!Number.isFinite(sellEx) || sellEx <= 0) continue;

    const direct = svByPk.get(snap.providerKey) ?? null;
    const viaMap = mapByPk.get(snap.providerKey) ?? null;
    const buy = direct?.buy ?? (viaMap ? buyBySvId.get(viaMap) ?? null : null);
    if (buy == null) continue;

    const floorEx = calcGalaxusStxSellFromSourceCost(buy);
    const underBuy = sellEx < buy;
    const underFloor = floorEx != null && sellEx < floorEx * 0.95;
    if (!underBuy && !underFloor) continue;

    out.push({
      providerKey: snap.providerKey,
      sellEx,
      buy,
      floorEx,
      supplierVariantId: direct?.supplierVariantId ?? viaMap,
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function main() {
  const dryRun = argFlag("--dry-run");
  const limit = argNum("--limit", 50_000);
  console.info("[galaxus-fix-underpriced] start", { dryRun, limit });

  const rows = await loadUnderpriced(limit);
  const belowBuy = rows.filter((r) => r.buy != null && r.sellEx < r.buy).length;
  console.info("[galaxus-fix-underpriced] found", {
    total: rows.length,
    belowBuy,
    sample: rows.slice(0, 10).map((r) => ({
      key: r.providerKey,
      sell: r.sellEx,
      buy: r.buy,
      floor: r.floorEx,
    })),
  });

  if (dryRun || rows.length === 0) {
    console.info("[galaxus-fix-underpriced] done (dry-run or empty)");
    await prisma.$disconnect();
    return;
  }

  const svIds = Array.from(
    new Set(rows.map((r) => r.supplierVariantId).filter((id): id is string => Boolean(id)))
  );
  const align = await alignStxSupplierVariantKeysToMappings(svIds);
  console.info("[galaxus-fix-underpriced] aligned keys", align);

  const keysFromRows = rows.map((r) => r.providerKey);
  const keysFromSv = await resolveGalaxusProviderKeysForSupplierVariantIds(svIds);
  const providerKeys = Array.from(new Set([...keysFromRows, ...keysFromSv]));

  const origin = resolveAppOriginForPartnerJobs(null) ?? "http://127.0.0.1:3000";
  const CHUNK = 80;
  let patched = 0;
  for (let i = 0; i < providerKeys.length; i += CHUNK) {
    const chunk = providerKeys.slice(i, i + CHUNK);
    const res = await patchFeedSnapshotsForProviderKeys({ origin, providerKeys: chunk });
    patched += res.patched;
    console.info("[galaxus-fix-underpriced] patch chunk", {
      i,
      chunk: chunk.length,
      patched: res.patched,
    });
  }

  // One stock-price upload (not dual stock+price). stx-refresh is MANUAL_ONLY-allowlisted.
  const push = await startFeedPushAsync({
    origin,
    scope: "stock-price",
    triggerSource: "stx-refresh",
  });

  console.info("[galaxus-fix-underpriced] DONE", {
    keys: providerKeys.length,
    patched,
    push,
  });
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
