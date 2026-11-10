import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { attachAvailableStock } from "./availableStock";
import type { InventoryChannel } from "./types";
import { isDecathlonSalesPaused } from "@/decathlon/exports/catalogPolicy";

const ELIGIBLE_MAPPING_STATUSES = ["MATCHED", "SUPPLIER_GTIN", "PARTNER_GTIN"] as const;

/** Rows per set-based upsert statement (≈ 1 round trip per 1000 listings). */
export const LISTING_SNAPSHOT_UPSERT_CHUNK = 1000;

type SnapshotRow = {
  providerKey: string;
  supplierVariantId: string;
  gtin: string | null;
  stock: number;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Upsert one chunk of listing rows for a channel with a single statement.
 *
 * This replaces ~40,000 sequential `channelListingState.upsert()` calls per run
 * (20k mappings × 2 channels, ~2 h wall time through the pooler, every 2 h — i.e. the
 * DB was being hammered 24/7 by this job alone). Column semantics are identical to the
 * old per-row upsert; the INNER JOIN on SupplierVariant keeps it FK-safe
 * (`ChannelListingState_supplierVariantId_fkey` used to abort whole runs).
 */
export async function upsertChannelListingChunk(
  channel: InventoryChannel,
  rows: SnapshotRow[],
  now: Date
): Promise<number> {
  if (rows.length === 0) return 0;
  const decathlonPaused = channel === "DECATHLON" && isDecathlonSalesPaused();
  const providerKeys = rows.map((r) => r.providerKey);
  const supplierVariantIds = rows.map((r) => r.supplierVariantId);
  const gtins = rows.map((r) => r.gtin);
  const stocks = rows.map((r) => (decathlonPaused ? 0 : Math.max(0, r.stock)));

  const affected = await (prisma as any).$executeRaw(Prisma.sql`
    INSERT INTO "public"."ChannelListingState" (
      "id",
      "channel",
      "providerKey",
      "supplierVariantId",
      "gtin",
      "lastPushedStock",
      "status",
      "lastSyncedAt",
      "soldOutAt",
      "metadataJson",
      "createdAt",
      "updatedAt"
    )
    SELECT
      gen_random_uuid()::text,
      ${channel}::"public"."MarketplaceChannel",
      v."providerKey",
      v."supplierVariantId",
      v."gtin",
      v."stock",
      CASE WHEN v."stock" <= 0 THEN 'SOLD_OUT' ELSE 'ACTIVE' END,
      ${now}::timestamp,
      CASE WHEN v."stock" <= 0 THEN ${now}::timestamp ELSE NULL END,
      '{"source":"listing-snapshot"}'::jsonb,
      ${now}::timestamp,
      ${now}::timestamp
    FROM unnest(
      ${providerKeys}::text[],
      ${supplierVariantIds}::text[],
      ${gtins}::text[],
      ${stocks}::int[]
    ) AS v("providerKey", "supplierVariantId", "gtin", "stock")
    INNER JOIN "public"."SupplierVariant" sv
      ON sv."supplierVariantId" = v."supplierVariantId"
    ON CONFLICT ("channel", "providerKey") DO UPDATE SET
      "supplierVariantId" = EXCLUDED."supplierVariantId",
      "gtin" = COALESCE(EXCLUDED."gtin", "ChannelListingState"."gtin"),
      "lastPushedStock" = EXCLUDED."lastPushedStock",
      "status" = EXCLUDED."status",
      "lastSyncedAt" = EXCLUDED."lastSyncedAt",
      "soldOutAt" = EXCLUDED."soldOutAt",
      "metadataJson" = EXCLUDED."metadataJson",
      "updatedAt" = EXCLUDED."updatedAt"
  `);
  return Number(affected ?? 0);
}

export async function refreshChannelListingSnapshots(
  channels: InventoryChannel[] = ["DECATHLON", "GALAXUS"]
) {
  const uniqueChannels = Array.from(new Set(channels));
  if (uniqueChannels.length === 0) {
    return { scanned: 0, upserted: 0 };
  }

  const prismaAny = prisma as any;
  const mappings = await prismaAny.variantMapping.findMany({
    where: {
      status: { in: ELIGIBLE_MAPPING_STATUSES as unknown as string[] },
      providerKey: { not: null },
      supplierVariantId: { not: null },
    },
    select: {
      providerKey: true,
      gtin: true,
      supplierVariantId: true,
      supplierVariant: {
        select: {
          supplierVariantId: true,
          stock: true,
          manualStock: true,
          manualLock: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 20000,
  });

  const dedupedByProviderKey = new Map<string, any>();
  for (const mapping of mappings) {
    const providerKey = String(mapping?.providerKey ?? "").trim();
    if (!providerKey || dedupedByProviderKey.has(providerKey)) continue;
    dedupedByProviderKey.set(providerKey, mapping);
  }
  const deduped = Array.from(dedupedByProviderKey.values());
  const stockMap = await attachAvailableStock(
    deduped
      .map((mapping: any) => mapping?.supplierVariant)
      .filter((variant: any) => Boolean(variant))
  );

  const snapshotRows: SnapshotRow[] = [];
  for (const mapping of deduped) {
    const providerKey = String(mapping?.providerKey ?? "").trim();
    const supplierVariantId = String(mapping?.supplierVariantId ?? "").trim();
    if (!providerKey || !supplierVariantId) continue;
    const availableStock =
      stockMap.get(supplierVariantId) ??
      Math.max(0, Number.parseInt(String(mapping?.supplierVariant?.stock ?? 0), 10) || 0);
    snapshotRows.push({
      providerKey,
      supplierVariantId,
      gtin: mapping?.gtin ?? null,
      stock: availableStock,
    });
  }

  const now = new Date();
  let upserted = 0;
  for (const channel of uniqueChannels) {
    for (const batch of chunk(snapshotRows, LISTING_SNAPSHOT_UPSERT_CHUNK)) {
      upserted += await upsertChannelListingChunk(channel, batch, now);
    }
  }

  return {
    scanned: deduped.length,
    upserted,
  };
}
