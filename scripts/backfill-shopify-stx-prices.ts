#!/usr/bin/env npx tsx
/**
 * Backfill Shopify STX sale prices from DB truth.
 *
 * Dry-run:
 *   npx tsx scripts/backfill-shopify-stx-prices.ts
 *
 * Apply:
 *   npx tsx scripts/backfill-shopify-stx-prices.ts --write
 *
 * Options:
 *   --all          sync every in-stock stx_ DB row, not only stale rows
 *   --limit=5000   max SupplierVariant rows to scan
 *   --batch=50     Shopify sync batch size
 *   --sleep=1500   ms between Shopify batches
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import {
  computeShopifyStxSellPrices,
  syncShopifyStxPricesForGtins,
  syncShopifyStxPricesForSupplierVariantIds,
} from "@/shopify/stx/syncShopifyStxPrices";

type Args = {
  write: boolean;
  all: boolean;
  limit: number;
  batchSize: number;
  sleepMs: number;
};

type DbRow = {
  supplierVariantId: string;
  providerKey: string | null;
  gtin: string | null;
  stock: number;
  deliveryType: string | null;
  price: unknown;
  standardBuyPrice: unknown;
  expressBuyPrice: unknown;
  supplierProductName: string | null;
  supplierBrand: string | null;
  updatedAt: Date;
  channelListings?: Array<{
    lastPushedPrice: unknown;
    lastSyncedAt: Date | null;
  }>;
  mappings?: Array<{
    kickdbVariant?: {
      product?: { urlKey: string | null } | null;
    } | null;
  }>;
};

type BackfillCandidate = {
  supplierVariantId: string;
  providerKey: string | null;
  gtin: string | null;
  productHandle: string | null;
  lastPushedPrice: number | null;
  targetNormalPrice: number;
  targetExpressPrice: number | null;
  reason: string;
};

function argValue(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]!;
  return fallback;
}

function parsePositiveInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(argValue(name, String(fallback)), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  return {
    write: argv.includes("--write") || argv.includes("--apply"),
    all: argv.includes("--all"),
    limit: parsePositiveInt("limit", 5000),
    batchSize: parsePositiveInt("batch", 50),
    sleepMs: Math.max(0, parsePositiveInt("sleep", 1500)),
  };
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadRows(limit: number): Promise<DbRow[]> {
  return (prisma as any).supplierVariant.findMany({
    where: {
      supplierVariantId: { startsWith: "stx_" },
      stock: { gt: 0 },
      manualLock: false,
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      supplierVariantId: true,
      providerKey: true,
      gtin: true,
      stock: true,
      deliveryType: true,
      price: true,
      standardBuyPrice: true,
      expressBuyPrice: true,
      supplierProductName: true,
      supplierBrand: true,
      updatedAt: true,
      channelListings: {
        where: { channel: "SHOPIFY" },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          lastPushedPrice: true,
          lastSyncedAt: true,
        },
      },
      mappings: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          kickdbVariant: {
            select: {
              product: { select: { urlKey: true } },
            },
          },
        },
      },
    },
  });
}

function staleReason(row: DbRow, targetNormalPrice: number, all: boolean): {
  stale: boolean;
  reason: string;
  lastPushedPrice: number | null;
} {
  const listing = row.channelListings?.[0] ?? null;
  const lastPushedPrice = toNumber(listing?.lastPushedPrice);

  if (all) return { stale: true, reason: "forced_all", lastPushedPrice };
  if (!listing) return { stale: true, reason: "missing_listing_state", lastPushedPrice };
  if (lastPushedPrice == null) {
    return { stale: true, reason: "missing_last_pushed_price", lastPushedPrice };
  }
  if (Math.abs(lastPushedPrice - targetNormalPrice) > 0.005) {
    return { stale: true, reason: "price_drift", lastPushedPrice };
  }
  if (!listing.lastSyncedAt || row.updatedAt > listing.lastSyncedAt) {
    return { stale: true, reason: "db_newer_than_shopify_state", lastPushedPrice };
  }
  return { stale: false, reason: "fresh", lastPushedPrice };
}

function buildCandidates(rows: DbRow[], all: boolean): {
  candidates: BackfillCandidate[];
  skippedNoPrice: number;
} {
  const candidates: BackfillCandidate[] = [];
  let skippedNoPrice = 0;

  for (const row of rows) {
    const productHandle = row.mappings?.[0]?.kickdbVariant?.product?.urlKey ?? null;
    const prices = computeShopifyStxSellPrices({
      stxRow: {
        deliveryType: row.deliveryType ?? null,
        price: row.price,
        standardBuyPrice: row.standardBuyPrice,
        expressBuyPrice: row.expressBuyPrice,
        supplierProductName: row.supplierProductName ?? null,
        supplierBrand: row.supplierBrand ?? null,
      },
      productHandle,
    });
    if (prices.normalSell == null) {
      skippedNoPrice += 1;
      continue;
    }

    const stale = staleReason(row, prices.normalSell, all);
    if (!stale.stale) continue;

    candidates.push({
      supplierVariantId: row.supplierVariantId,
      providerKey: row.providerKey,
      gtin: row.gtin,
      productHandle,
      lastPushedPrice: stale.lastPushedPrice,
      targetNormalPrice: prices.normalSell,
      targetExpressPrice: prices.expressSell,
      reason: stale.reason,
    });
  }

  return { candidates, skippedNoPrice };
}

async function applyCandidates(candidates: BackfillCandidate[], args: Args): Promise<{
  synced: number;
  skipped: number;
  failed: number;
  failReasons: Record<string, number>;
}> {
  const gtins = Array.from(
    new Set(candidates.map((c) => c.gtin).filter((gtin): gtin is string => Boolean(gtin)))
  );
  const pendingIds = Array.from(
    new Set(
      candidates
        .filter((c) => !c.gtin)
        .map((c) => c.supplierVariantId)
        .filter(Boolean)
    )
  );

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  const failReasons = new Map<string, number>();
  const batches: Array<{ kind: "gtin" | "supplierVariantId"; values: string[] }> = [
    ...chunk(gtins, args.batchSize).map((values) => ({ kind: "gtin" as const, values })),
    ...chunk(pendingIds, args.batchSize).map((values) => ({
      kind: "supplierVariantId" as const,
      values,
    })),
  ];

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i]!;
    const result =
      batch.kind === "gtin"
        ? await syncShopifyStxPricesForGtins(batch.values)
        : await syncShopifyStxPricesForSupplierVariantIds(batch.values);

    synced += result.synced;
    skipped += result.skipped;
    failed += result.failed;
    for (const row of result.results) {
      if (row.ok) continue;
      const reason = row.reason ?? "unknown";
      failReasons.set(reason, (failReasons.get(reason) ?? 0) + 1);
    }

    console.info("[backfill-shopify-stx-prices] batch", {
      index: i + 1,
      batches: batches.length,
      kind: batch.kind,
      rows: batch.values.length,
      synced: result.synced,
      skipped: result.skipped,
      failed: result.failed,
    });

    if (args.sleepMs > 0 && i < batches.length - 1) {
      await sleep(args.sleepMs);
    }
  }

  return { synced, skipped, failed, failReasons: Object.fromEntries(failReasons) };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const startedAt = Date.now();
  const rows = await loadRows(args.limit);
  const { candidates, skippedNoPrice } = buildCandidates(rows, args.all);
  const byReason = candidates.reduce<Record<string, number>>((acc, row) => {
    acc[row.reason] = (acc[row.reason] ?? 0) + 1;
    return acc;
  }, {});

  console.info("[backfill-shopify-stx-prices] scan", {
    mode: args.write ? "WRITE" : "DRY_RUN",
    scanned: rows.length,
    candidates: candidates.length,
    skippedNoPrice,
    byReason,
    sample: candidates.slice(0, 20),
  });

  if (!args.write) {
    console.info("[backfill-shopify-stx-prices] dry-run only; pass --write to update Shopify");
    return;
  }

  const applied = await applyCandidates(candidates, args);
  console.info("[backfill-shopify-stx-prices] done", {
    scanned: rows.length,
    candidates: candidates.length,
    ...applied,
    durationMs: Date.now() - startedAt,
  });
}

main()
  .catch((err: unknown) => {
    console.error("[backfill-shopify-stx-prices] fatal", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
