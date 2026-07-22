import { prisma } from "@/app/lib/prisma";
import {
  applyTheCatalogStockDeltaInTx,
  isTheSupplierVariantId,
} from "@/galaxus/warehouse/theCatalogStock";
import { isTheWarehouseSupplierSku } from "@/galaxus/warehouse/lineInventorySource";
import { routeMarketplacePhysicalSale } from "@/shopify/inventory/marketplacePhysicalSale";
import { resolveSupplierVariantForInventoryLine } from "./resolveSupplierVariant";
import { scheduleTheSaleChannelSync } from "./theSaleChannelSync";
import type {
  ApplyInventoryOrderLineInput,
  ApplyInventoryOrderLineResult,
  InventoryEventKind,
} from "./types";

type ApplyInventoryOrderLineOptions = {
  /** When false, caller batches channel sync (see applyInventoryOrderLines). Default true. */
  syncChannels?: boolean;
};

function shouldScheduleTheSaleSync(result: ApplyInventoryOrderLineResult): boolean {
  if (!result.applied) return false;
  if ((result.quantityDelta ?? 0) >= 0) return false;
  if (!isTheSupplierVariantId(result.supplierVariantId)) return false;
  return isTheWarehouseSupplierSku(result.providerKey);
}

function normalizePositiveQuantity(quantity: number): number | null {
  if (!Number.isFinite(quantity)) return null;
  const rounded = Math.trunc(Math.abs(quantity));
  return rounded > 0 ? rounded : null;
}

function resolveQuantityDelta(eventType: InventoryEventKind, quantity: number): number {
  if (eventType === "RETURN" || eventType === "RELEASE") return Math.abs(quantity);
  return -Math.abs(quantity);
}

export async function applyInventoryOrderLine(
  input: ApplyInventoryOrderLineInput,
  options?: ApplyInventoryOrderLineOptions
): Promise<ApplyInventoryOrderLineResult> {
  const externalLineId = String(input.externalLineId ?? "").trim();
  if (!externalLineId) {
    return {
      applied: false,
      channel: input.channel,
      externalLineId,
      reason: "invalid_line",
    };
  }

  const quantity = normalizePositiveQuantity(input.quantity);
  if (!quantity) {
    return {
      applied: false,
      channel: input.channel,
      externalLineId,
      reason: "invalid_line",
    };
  }

  const resolvedVariant = await resolveSupplierVariantForInventoryLine(input);
  if (!resolvedVariant) {
    return {
      applied: false,
      channel: input.channel,
      externalLineId,
      reason: "unresolved_variant",
    };
  }

  const eventType = input.eventType ?? "SALE";
  const quantityDelta = resolveQuantityDelta(eventType, quantity);
  const externalOrderId = input.externalOrderId ? String(input.externalOrderId).trim() : null;
  const occurredAt = input.occurredAt ?? new Date();
  const channel = input.channel;
  const providerKey = resolvedVariant.providerKey ?? null;
  const idempotencyKey = `${channel}:${externalLineId}`;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const txAny = tx as any;
      const existing = await txAny.orderLineSyncState.findUnique({
        where: {
          channel_externalLineId: {
            channel,
            externalLineId,
          },
        },
        select: {
          id: true,
          eventId: true,
        },
      });

      if (existing) {
        await txAny.orderLineSyncState.update({
          where: { id: existing.id },
          data: {
            lastSeenAt: new Date(),
            payloadJson: input.payloadJson ?? undefined,
          },
        });
        return {
          applied: false as const,
          channel,
          externalLineId,
          supplierVariantId: resolvedVariant.supplierVariantId,
          providerKey,
          reason: "already_processed" as const,
        };
      }

      const event = await txAny.inventoryEvent.create({
        data: {
          eventType,
          channel,
          externalOrderId,
          externalLineId,
          supplierVariantId: resolvedVariant.supplierVariantId,
          providerKey,
          quantityDelta,
          occurredAt,
          processedAt: new Date(),
          idempotencyKey,
          payloadJson: input.payloadJson ?? null,
        },
      });

      await txAny.orderLineSyncState.create({
        data: {
          channel,
          externalOrderId,
          externalLineId,
          supplierVariantId: resolvedVariant.supplierVariantId,
          providerKey,
          quantity,
          eventType,
          eventId: event.id,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          payloadJson: input.payloadJson ?? null,
        },
      });

      if (providerKey) {
        await txAny.channelListingState.upsert({
          where: { channel_providerKey: { channel, providerKey } },
          update: {
            supplierVariantId: resolvedVariant.supplierVariantId,
            gtin: resolvedVariant.gtin ?? undefined,
            updatedAt: new Date(),
          },
          create: {
            channel,
            providerKey,
            supplierVariantId: resolvedVariant.supplierVariantId,
            gtin: resolvedVariant.gtin ?? null,
            status: "PENDING",
          },
        });
      }

      if (isTheSupplierVariantId(resolvedVariant.supplierVariantId)) {
        await applyTheCatalogStockDeltaInTx(
          txAny,
          resolvedVariant.supplierVariantId,
          quantityDelta,
          `${channel}:${externalLineId}`
        );
      }

      return {
        applied: true as const,
        channel,
        externalLineId,
        supplierVariantId: resolvedVariant.supplierVariantId,
        providerKey,
        quantityDelta,
        eventId: event.id,
      };
    });

    if (options?.syncChannels !== false && shouldScheduleTheSaleSync(result)) {
      scheduleTheSaleChannelSync({ providerKeys: [result.providerKey] });
    }

    if (
      result.applied &&
      (eventType === "SALE" || eventType === undefined) &&
      (result.quantityDelta ?? 0) < 0
    ) {
      const gtin = String(resolvedVariant.gtin ?? input.gtin ?? "").trim();
      if (gtin) {
        try {
          const route = await routeMarketplacePhysicalSale({
            channel,
            externalLineId,
            externalOrderId,
            gtin,
            quantity: quantity,
          });
          if (route.warnings.length) {
            console.warn("[inventory][marketplace-physical-sale]", {
              channel,
              externalLineId,
              gtin,
              warnings: route.warnings,
            });
          }
          if (route.routed) {
            console.info("[inventory][marketplace-physical-sale] routed", {
              channel,
              externalLineId,
              gtin,
              decremented: route.decremented,
              locations: route.locations,
            });
          }
        } catch (err: any) {
          console.error("[inventory][marketplace-physical-sale] failed", {
            channel,
            externalLineId,
            gtin,
            error: err?.message ?? err,
          });
        }
      }
    }

    return result;
  } catch (error: any) {
    const message = String(error?.message ?? "");
    if (message.includes("OrderLineSyncState_channel_externalLineId_key")) {
      return {
        applied: false,
        channel,
        externalLineId,
        supplierVariantId: resolvedVariant.supplierVariantId,
        providerKey,
        reason: "already_processed",
      };
    }
    throw error;
  }
}

export async function applyInventoryOrderLines(
  lines: ApplyInventoryOrderLineInput[]
): Promise<ApplyInventoryOrderLineResult[]> {
  const results: ApplyInventoryOrderLineResult[] = [];
  const theSaleKeys: string[] = [];
  for (const line of lines) {
    const result = await applyInventoryOrderLine(line, { syncChannels: false });
    results.push(result);
    if (shouldScheduleTheSaleSync(result) && result.providerKey) {
      theSaleKeys.push(result.providerKey);
    }
  }
  if (theSaleKeys.length > 0) {
    scheduleTheSaleChannelSync({ providerKeys: theSaleKeys });
  }
  return results;
}
