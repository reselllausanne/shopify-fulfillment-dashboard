import { prisma } from "@/app/lib/prisma";
import { attachAvailableStock } from "./availableStock";
import type { InventoryChannel } from "./types";

const ELIGIBLE_MAPPING_STATUSES = ["MATCHED", "SUPPLIER_GTIN", "PARTNER_GTIN"] as const;

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

  let upserted = 0;
  for (const mapping of deduped) {
    const providerKey = String(mapping?.providerKey ?? "").trim();
    const supplierVariantId = String(mapping?.supplierVariantId ?? "").trim() || null;
    if (!providerKey || !supplierVariantId) continue;
    const availableStock =
      stockMap.get(supplierVariantId) ??
      Math.max(0, Number.parseInt(String(mapping?.supplierVariant?.stock ?? 0), 10) || 0);
    const status = availableStock <= 0 ? "SOLD_OUT" : "ACTIVE";

    for (const channel of uniqueChannels) {
      await prismaAny.channelListingState.upsert({
        where: {
          channel_providerKey: {
            channel,
            providerKey,
          },
        },
        create: {
          channel,
          providerKey,
          supplierVariantId,
          gtin: mapping?.gtin ?? null,
          lastPushedStock: availableStock,
          status,
          lastSyncedAt: new Date(),
          soldOutAt: availableStock <= 0 ? new Date() : null,
          metadataJson: {
            source: "listing-snapshot",
          },
        },
        update: {
          supplierVariantId,
          gtin: mapping?.gtin ?? undefined,
          lastPushedStock: availableStock,
          status,
          lastSyncedAt: new Date(),
          soldOutAt: availableStock <= 0 ? new Date() : null,
          metadataJson: {
            source: "listing-snapshot",
          },
        },
      });
      upserted += 1;
    }
  }

  return {
    scanned: deduped.length,
    upserted,
  };
}
