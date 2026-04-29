import { prisma } from "@/app/lib/prisma";
import { resolveSupplierVariantForInventoryLine } from "./resolveSupplierVariant";
import type {
  ApplyInventoryOrderLineInput,
  ApplyInventoryOrderLineResult,
  InventoryEventKind,
} from "./types";

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
  input: ApplyInventoryOrderLineInput
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
  for (const line of lines) {
    const result = await applyInventoryOrderLine(line);
    results.push(result);
  }
  return results;
}
