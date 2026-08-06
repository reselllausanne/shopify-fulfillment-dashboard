import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import { ALTERNATIVE_PARTNER_KEY } from "@/app/lib/alternativeProducts";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import {
  galaxusLineWarehouseStockHint,
  isNerWarehouseSupplierSku,
} from "@/galaxus/warehouse/lineInventorySource";

/** Packing always. Shipping tier by unit count in DELR. */
export const GALAXUS_DELR_PACK_CHF = 4.5;
export const GALAXUS_DELR_SHIP_UNDER_CHF = 6.5;
export const GALAXUS_DELR_SHIP_OVER_CHF = 9.5;
/** Strictly greater than this → large-parcel ship rate. */
export const GALAXUS_DELR_SHIP_OVER_UNITS = 6;

export const GALAXUS_DELR_PACK_MARKER_PREFIX = "[SYSTEM:GALAXUS_DELR_PACK:";
export const GALAXUS_DELR_SHIP_MARKER_PREFIX = "[SYSTEM:GALAXUS_DELR_SHIP:";

const PACK_CATEGORY_NAME = "Packaging Materials";
const SHIP_CATEGORY_NAME = "Shipping Costs";
const DEFAULT_ACCOUNT_NAME = "Other";

export function galaxusDelrPackMarker(shipmentDbId: string): string {
  return `${GALAXUS_DELR_PACK_MARKER_PREFIX}${shipmentDbId}]`;
}

export function galaxusDelrShipMarker(shipmentDbId: string): string {
  return `${GALAXUS_DELR_SHIP_MARKER_PREFIX}${shipmentDbId}]`;
}

export function extractGalaxusDelrShipmentIdFromNote(note?: string | null): string | null {
  if (!note) return null;
  const m = note.match(/\[SYSTEM:GALAXUS_DELR_(?:PACK|SHIP):([^\]]+)\]/);
  return m?.[1] ?? null;
}

/**
 * NER partner fulfillments — maison does not pack/ship these boxes.
 * Detect via shipment.providerKey=NER, NER_ offer SKU, or all items NER_STOCK.
 */
export function isNerGalaxusDelrShipment(shipment: {
  providerKey?: string | null;
  items?: Array<{ supplierPid?: string | null }>;
}): boolean {
  const pk = normalizeProviderKey(shipment.providerKey ?? null);
  if (pk === ALTERNATIVE_PARTNER_KEY) return true;
  if (isNerWarehouseSupplierSku(shipment.providerKey)) return true;

  const items = shipment.items ?? [];
  if (items.length === 0) return false;

  let known = 0;
  let ner = 0;
  for (const item of items) {
    const pid = String(item.supplierPid ?? "").trim();
    if (!pid) continue;
    const hint = galaxusLineWarehouseStockHint({
      supplierSku: pid,
      providerKey: pid,
      supplierPid: pid,
    });
    if (hint === "NER_STOCK" || isNerWarehouseSupplierSku(pid)) {
      known += 1;
      ner += 1;
      continue;
    }
    if (hint === "MAISON" || hint === "GOLDEN") {
      known += 1;
      continue;
    }
    const itemPk = normalizeProviderKey(pid);
    if (itemPk === "STX" || itemPk === "THE" || itemPk === "GLD" || itemPk === "TRM") {
      known += 1;
    }
  }
  return known > 0 && ner === known;
}

export function galaxusDelrShipAmountChf(unitCount: number): number {
  const units = Math.max(0, Math.floor(unitCount));
  return units > GALAXUS_DELR_SHIP_OVER_UNITS
    ? GALAXUS_DELR_SHIP_OVER_CHF
    : GALAXUS_DELR_SHIP_UNDER_CHF;
}

export function galaxusDelrFeeBreakdown(unitCount: number): {
  units: number;
  packChf: number;
  shipChf: number;
  totalChf: number;
  tier: "under" | "over";
} {
  const units = Math.max(0, Math.floor(unitCount));
  const shipChf = galaxusDelrShipAmountChf(units);
  const packChf = GALAXUS_DELR_PACK_CHF;
  return {
    units,
    packChf,
    shipChf,
    totalChf: packChf + shipChf,
    tier: units > GALAXUS_DELR_SHIP_OVER_UNITS ? "over" : "under",
  };
}

function toUtcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function resolveCategoryId(name: string): Promise<string> {
  const row = await prisma.expenseCategory.findUnique({ where: { name } });
  if (!row) throw new Error(`Expense category missing: ${name}`);
  return row.id;
}

async function resolveAccountId(): Promise<string> {
  const preferred =
    String(process.env.GALAXUS_DELR_FEE_ACCOUNT_NAME ?? "").trim() || DEFAULT_ACCOUNT_NAME;
  const byName = await prisma.paymentAccount.findUnique({ where: { name: preferred } });
  if (byName) return byName.id;
  const fallback = await prisma.paymentAccount.findUnique({ where: { name: DEFAULT_ACCOUNT_NAME } });
  if (!fallback) throw new Error(`Payment account missing: ${preferred} / ${DEFAULT_ACCOUNT_NAME}`);
  return fallback.id;
}

export type UpsertGalaxusDelrFeesResult = {
  shipmentDbId: string;
  units: number;
  packChf: number;
  shipChf: number;
  pack: "created" | "updated" | "unchanged" | "skipped";
  ship: "created" | "updated" | "unchanged" | "skipped";
  eventDate: string;
  skippedReason?: "ner";
};

async function upsertExpenseLine(args: {
  marker: string;
  amount: number;
  categoryId: string;
  accountId: string;
  eventDate: Date;
  noteBody: string;
  sourceId: string;
  description: string;
}): Promise<"created" | "updated" | "unchanged"> {
  const amount = new Prisma.Decimal(args.amount.toFixed(2));
  const existing = await prisma.personalExpense.findFirst({
    where: { note: { contains: args.marker } },
    select: { id: true, amount: true, date: true, categoryId: true, accountId: true, isBusiness: true },
  });

  const note = `${args.marker} ${args.noteBody}`.trim();
  let status: "created" | "updated" | "unchanged" = "unchanged";

  if (!existing) {
    await prisma.personalExpense.create({
      data: {
        date: args.eventDate,
        amount,
        currencyCode: "CHF",
        categoryId: args.categoryId,
        accountId: args.accountId,
        note,
        isBusiness: true,
      },
    });
    status = "created";
  } else {
    const sameAmount = toNumberSafe(existing.amount, 0) === args.amount;
    const sameDate = existing.date.getTime() === args.eventDate.getTime();
    const sameCat = existing.categoryId === args.categoryId;
    const sameAcc = existing.accountId === args.accountId;
    const sameBiz = existing.isBusiness === true;
    if (!sameAmount || !sameDate || !sameCat || !sameAcc || !sameBiz) {
      await prisma.personalExpense.update({
        where: { id: existing.id },
        data: {
          date: args.eventDate,
          amount,
          categoryId: args.categoryId,
          accountId: args.accountId,
          note,
          isBusiness: true,
        },
      });
      status = "updated";
    }
  }

  // Keep one ManualFinanceEvent per sourceId (drop stale dates if DELR date changes).
  await prisma.manualFinanceEvent.deleteMany({
    where: {
      sourceType: "IMPORT",
      sourceId: args.sourceId,
      NOT: { eventDate: args.eventDate },
    },
  });

  await prisma.manualFinanceEvent.upsert({
    where: {
      sourceType_sourceId_eventDate: {
        sourceType: "IMPORT",
        sourceId: args.sourceId,
        eventDate: args.eventDate,
      },
    },
    update: {
      amount,
      currencyCode: "CHF",
      direction: "OUT",
      category: "OTHER",
      expenseCategoryId: args.categoryId,
      description: args.description,
      metadataJson: { system: "GALAXUS_DELR_FEE", marker: args.marker },
    },
    create: {
      eventDate: args.eventDate,
      amount,
      currencyCode: "CHF",
      direction: "OUT",
      category: "OTHER",
      expenseCategoryId: args.categoryId,
      sourceType: "IMPORT",
      sourceId: args.sourceId,
      description: args.description,
      metadataJson: { system: "GALAXUS_DELR_FEE", marker: args.marker },
    },
  });

  return status;
}

/**
 * Idempotent: one Business pack expense + one Business ship expense per uploaded DELR.
 * Recoverable year-end via note markers / ManualFinanceEvent sourceId.
 * NER partner DELRs are skipped (and any prior auto rows removed).
 */
export async function upsertGalaxusDelrFulfillmentExpenses(args: {
  shipmentDbId: string;
  unitCount: number;
  delrSentAt?: Date | null;
  dispatchNotificationId?: string | null;
  delrFileName?: string | null;
  shipmentLabel?: string | null;
  /** When already loaded (upload/sync path); otherwise fetched. */
  shipmentHint?: {
    providerKey?: string | null;
    items?: Array<{ supplierPid?: string | null }>;
  } | null;
}): Promise<UpsertGalaxusDelrFeesResult> {
  const shipment =
    args.shipmentHint ??
    (await prisma.shipment.findUnique({
      where: { id: args.shipmentDbId },
      select: {
        providerKey: true,
        items: { select: { supplierPid: true } },
      },
    }));

  if (shipment && isNerGalaxusDelrShipment(shipment)) {
    await removeGalaxusDelrFulfillmentExpenses(args.shipmentDbId);
    const eventDate = toUtcDateOnly(args.delrSentAt ?? new Date());
    return {
      shipmentDbId: args.shipmentDbId,
      units: Math.max(0, Math.floor(args.unitCount)),
      packChf: 0,
      shipChf: 0,
      pack: "skipped",
      ship: "skipped",
      eventDate: eventDate.toISOString().slice(0, 10),
      skippedReason: "ner",
    };
  }

  const breakdown = galaxusDelrFeeBreakdown(args.unitCount);
  const eventDate = toUtcDateOnly(args.delrSentAt ?? new Date());
  const [packCategoryId, shipCategoryId, accountId] = await Promise.all([
    resolveCategoryId(PACK_CATEGORY_NAME),
    resolveCategoryId(SHIP_CATEGORY_NAME),
    resolveAccountId(),
  ]);

  const gdn = String(args.dispatchNotificationId ?? "").trim() || "—";
  const shipLabel = String(args.shipmentLabel ?? args.shipmentDbId).trim();
  const file = String(args.delrFileName ?? "").trim();
  const tierLabel = breakdown.tier === "over" ? `>${GALAXUS_DELR_SHIP_OVER_UNITS}u` : `≤${GALAXUS_DELR_SHIP_OVER_UNITS}u`;
  const common = `Galaxus DELR ${gdn} · ${shipLabel} · units=${breakdown.units} (${tierLabel})${file ? ` · ${file}` : ""}`;

  const packMarker = galaxusDelrPackMarker(args.shipmentDbId);
  const shipMarker = galaxusDelrShipMarker(args.shipmentDbId);

  const pack = await upsertExpenseLine({
    marker: packMarker,
    amount: breakdown.packChf,
    categoryId: packCategoryId,
    accountId,
    eventDate,
    noteBody: `pack CHF ${breakdown.packChf.toFixed(2)} · ${common}`,
    sourceId: `galaxus-delr-pack:${args.shipmentDbId}`,
    description: `Galaxus DELR packing (${gdn})`,
  });

  const ship = await upsertExpenseLine({
    marker: shipMarker,
    amount: breakdown.shipChf,
    categoryId: shipCategoryId,
    accountId,
    eventDate,
    noteBody: `ship CHF ${breakdown.shipChf.toFixed(2)} · ${common}`,
    sourceId: `galaxus-delr-ship:${args.shipmentDbId}`,
    description: `Galaxus DELR shipping (${gdn})`,
  });

  return {
    shipmentDbId: args.shipmentDbId,
    units: breakdown.units,
    packChf: breakdown.packChf,
    shipChf: breakdown.shipChf,
    pack,
    ship,
    eventDate: eventDate.toISOString().slice(0, 10),
  };
}

export async function removeGalaxusDelrFulfillmentExpenses(shipmentDbId: string): Promise<{
  deletedExpenses: number;
  deletedManualEvents: number;
}> {
  const packMarker = galaxusDelrPackMarker(shipmentDbId);
  const shipMarker = galaxusDelrShipMarker(shipmentDbId);

  const expenses = await prisma.personalExpense.deleteMany({
    where: {
      OR: [{ note: { contains: packMarker } }, { note: { contains: shipMarker } }],
    },
  });

  const events = await prisma.manualFinanceEvent.deleteMany({
    where: {
      sourceType: "IMPORT",
      sourceId: {
        in: [`galaxus-delr-pack:${shipmentDbId}`, `galaxus-delr-ship:${shipmentDbId}`],
      },
    },
  });

  return {
    deletedExpenses: expenses.count,
    deletedManualEvents: events.count,
  };
}

export async function syncGalaxusDelrFulfillmentExpensesForUploaded(options?: {
  since?: Date | null;
  limit?: number;
}): Promise<{
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedNer: number;
  errors: Array<{ shipmentDbId: string; message: string }>;
}> {
  const where: any = {
    delrSentAt: options?.since ? { gte: options.since } : { not: null },
  };

  const shipments = await prisma.shipment.findMany({
    where,
    select: {
      id: true,
      shipmentId: true,
      providerKey: true,
      dispatchNotificationId: true,
      delrSentAt: true,
      delrFileName: true,
      items: { select: { quantity: true, supplierPid: true } },
    },
    orderBy: [{ delrSentAt: "asc" }, { createdAt: "asc" }],
    take: options?.limit && options.limit > 0 ? options.limit : undefined,
  });

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skippedNer = 0;
  const errors: Array<{ shipmentDbId: string; message: string }> = [];

  for (const s of shipments) {
    try {
      const units = (s.items ?? []).reduce((sum, it) => sum + Math.max(0, Number(it.quantity ?? 0)), 0);
      const res = await upsertGalaxusDelrFulfillmentExpenses({
        shipmentDbId: s.id,
        unitCount: units,
        delrSentAt: s.delrSentAt,
        dispatchNotificationId: s.dispatchNotificationId,
        delrFileName: s.delrFileName,
        shipmentLabel: s.shipmentId,
        shipmentHint: { providerKey: s.providerKey, items: s.items },
      });
      if (res.skippedReason === "ner") {
        skippedNer += 1;
        continue;
      }
      for (const st of [res.pack, res.ship]) {
        if (st === "created") created += 1;
        else if (st === "updated") updated += 1;
        else unchanged += 1;
      }
    } catch (e: any) {
      errors.push({ shipmentDbId: s.id, message: e?.message ?? String(e) });
    }
  }

  return { scanned: shipments.length, created, updated, unchanged, skippedNer, errors };
}

/** Delete auto pack/ship Business expenses that were wrongly created for NER DELRs. */
export async function cleanupNerGalaxusDelrFulfillmentExpenses(): Promise<{
  shipmentCount: number;
  deletedExpenses: number;
  deletedManualEvents: number;
  amountChf: number;
  shipmentIds: string[];
}> {
  const expenses = await prisma.personalExpense.findMany({
    where: {
      OR: [
        { note: { contains: GALAXUS_DELR_PACK_MARKER_PREFIX } },
        { note: { contains: GALAXUS_DELR_SHIP_MARKER_PREFIX } },
      ],
    },
    select: { id: true, amount: true, note: true },
  });

  const shipmentIds = new Set<string>();
  for (const row of expenses) {
    const id = extractGalaxusDelrShipmentIdFromNote(row.note);
    if (id) shipmentIds.add(id);
  }

  if (shipmentIds.size === 0) {
    return {
      shipmentCount: 0,
      deletedExpenses: 0,
      deletedManualEvents: 0,
      amountChf: 0,
      shipmentIds: [],
    };
  }

  const shipments = await prisma.shipment.findMany({
    where: { id: { in: Array.from(shipmentIds) } },
    select: {
      id: true,
      providerKey: true,
      items: { select: { supplierPid: true } },
    },
  });

  const nerIds = shipments.filter((s) => isNerGalaxusDelrShipment(s)).map((s) => s.id);
  // Orphan markers whose shipment is gone but note looked NER-tagged via supplierPid in note — skip;
  // only delete for confirmed NER shipment rows.
  let deletedExpenses = 0;
  let deletedManualEvents = 0;
  let amountChf = 0;

  for (const shipmentDbId of nerIds) {
    const before = expenses.filter((e) => extractGalaxusDelrShipmentIdFromNote(e.note) === shipmentDbId);
    for (const e of before) amountChf += toNumberSafe(e.amount, 0);
    const removed = await removeGalaxusDelrFulfillmentExpenses(shipmentDbId);
    deletedExpenses += removed.deletedExpenses;
    deletedManualEvents += removed.deletedManualEvents;
  }

  return {
    shipmentCount: nerIds.length,
    deletedExpenses,
    deletedManualEvents,
    amountChf: Number(amountChf.toFixed(2)),
    shipmentIds: nerIds,
  };
}
