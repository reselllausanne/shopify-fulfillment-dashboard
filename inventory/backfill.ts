import { prisma } from "@/app/lib/prisma";
import { applyInventoryOrderLine } from "./applyOrderLines";
import type { ApplyInventoryOrderLineResult, InventoryChannel } from "./types";

type BackfillSummary = {
  channel: InventoryChannel;
  scanned: number;
  applied: number;
  alreadyProcessed: number;
  unresolved: number;
  invalid: number;
};

type BackfillResult = {
  dryRun: boolean;
  limitPerChannel: number;
  channels: BackfillSummary[];
};

function createSummary(channel: InventoryChannel): BackfillSummary {
  return {
    channel,
    scanned: 0,
    applied: 0,
    alreadyProcessed: 0,
    unresolved: 0,
    invalid: 0,
  };
}

function bumpSummary(summary: BackfillSummary, result: ApplyInventoryOrderLineResult) {
  summary.scanned += 1;
  if (result.applied) {
    summary.applied += 1;
    return;
  }
  if (result.reason === "already_processed") {
    summary.alreadyProcessed += 1;
    return;
  }
  if (result.reason === "unresolved_variant") {
    summary.unresolved += 1;
    return;
  }
  summary.invalid += 1;
}

export async function backfillInventoryLedger(options?: {
  limitPerChannel?: number;
  dryRun?: boolean;
}): Promise<BackfillResult> {
  const limitPerChannelRaw = Number(options?.limitPerChannel ?? 500);
  const limitPerChannel = Number.isFinite(limitPerChannelRaw)
    ? Math.min(Math.max(Math.trunc(limitPerChannelRaw), 1), 5000)
    : 500;
  const dryRun = Boolean(options?.dryRun);
  const channels: BackfillSummary[] = [
    createSummary("DECATHLON"),
    createSummary("GALAXUS"),
    createSummary("SHOPIFY"),
  ];

  const decathlonRows = await prisma.decathlonOrderLine.findMany({
    orderBy: { createdAt: "asc" },
    take: limitPerChannel,
    select: {
      orderLineId: true,
      quantity: true,
      providerKey: true,
      offerSku: true,
      gtin: true,
      supplierSku: true,
      createdAt: true,
      order: {
        select: {
          orderId: true,
        },
      },
    },
  });

  for (const row of decathlonRows) {
    const input = {
      channel: "DECATHLON" as const,
      externalOrderId: row.order?.orderId ?? null,
      externalLineId: row.orderLineId,
      quantity: row.quantity ?? 1,
      providerKey: row.providerKey ?? row.offerSku ?? row.supplierSku ?? null,
      gtin: row.gtin ?? null,
      occurredAt: row.createdAt,
      payloadJson: { source: "backfill", orderLineId: row.orderLineId },
    };
    const result = dryRun
      ? ({
          applied: false,
          channel: "DECATHLON",
          externalLineId: input.externalLineId,
          reason: "already_processed",
        } as ApplyInventoryOrderLineResult)
      : await applyInventoryOrderLine(input);
    bumpSummary(channels[0], result);
  }

  const galaxusRows = await prisma.galaxusOrderLine.findMany({
    orderBy: { createdAt: "asc" },
    take: limitPerChannel,
    select: {
      id: true,
      lineNumber: true,
      quantity: true,
      providerKey: true,
      gtin: true,
      supplierVariantId: true,
      createdAt: true,
      order: {
        select: {
          galaxusOrderId: true,
        },
      },
    },
  });

  for (const row of galaxusRows) {
    const externalLineId = `GALAXUS:${row.id}`;
    const input = {
      channel: "GALAXUS" as const,
      externalOrderId: row.order?.galaxusOrderId ?? null,
      externalLineId,
      quantity: row.quantity ?? 1,
      providerKey: row.providerKey ?? null,
      supplierVariantId: row.supplierVariantId ?? null,
      gtin: row.gtin ?? null,
      occurredAt: row.createdAt,
      payloadJson: { source: "backfill", lineNumber: row.lineNumber },
    };
    const result = dryRun
      ? ({
          applied: false,
          channel: "GALAXUS",
          externalLineId,
          reason: "already_processed",
        } as ApplyInventoryOrderLineResult)
      : await applyInventoryOrderLine(input);
    bumpSummary(channels[1], result);
  }

  const shopifyRows = await prisma.orderMatch.findMany({
    orderBy: { createdAt: "asc" },
    take: limitPerChannel,
    select: {
      shopifyOrderId: true,
      shopifyLineItemId: true,
      shopifySku: true,
      stockxSkuKey: true,
      shopifyCreatedAt: true,
    },
  });

  for (const row of shopifyRows) {
    const externalLineId = row.shopifyLineItemId;
    const input = {
      channel: "SHOPIFY" as const,
      externalOrderId: row.shopifyOrderId,
      externalLineId,
      quantity: 1,
      providerKey: row.shopifySku ?? row.stockxSkuKey ?? null,
      sku: row.shopifySku ?? row.stockxSkuKey ?? null,
      occurredAt: row.shopifyCreatedAt ?? undefined,
      payloadJson: { source: "backfill", orderId: row.shopifyOrderId },
    };
    const result = dryRun
      ? ({
          applied: false,
          channel: "SHOPIFY",
          externalLineId,
          reason: "already_processed",
        } as ApplyInventoryOrderLineResult)
      : await applyInventoryOrderLine(input);
    bumpSummary(channels[2], result);
  }

  return {
    dryRun,
    limitPerChannel,
    channels,
  };
}
