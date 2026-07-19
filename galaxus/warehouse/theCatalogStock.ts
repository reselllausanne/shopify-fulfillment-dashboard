import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import {
  galaxusLineWarehouseStockHint,
  isTheWarehouseSupplierSku,
  resolveGalaxusLineOfferSupplierSku,
} from "@/galaxus/warehouse/lineInventorySource";

export type GalaxusLineStockInput = {
  id?: string | null;
  gtin?: string | null;
  supplierVariantId?: string | null;
  supplierSku?: string | null;
  providerKey?: string | null;
  offerSupplierSku?: string | null;
  quantity?: number | null;
};

/** True when this Galaxus line is fulfilled from your THE warehouse stock (not StockX). */
export function isTheWarehouseGalaxusLine(line: GalaxusLineStockInput): boolean {
  return galaxusLineWarehouseStockHint(line) === "MAISON";
}

/**
 * Resolve `the_…` SupplierVariant for a Galaxus THE line (GTIN / THE_ offer sku / line id).
 */
export async function resolveTheSupplierVariantForGalaxusLine(
  tx: any,
  line: GalaxusLineStockInput
): Promise<string | null> {
  const svId = String(line.supplierVariantId ?? "").trim();
  if (isTheSupplierVariantId(svId)) return svId;

  const gtin = String(line.gtin ?? "").trim();
  const offerSku = resolveGalaxusLineOfferSupplierSku(line);
  const theVariantIdFilter = {
    OR: [
      { supplierVariantId: { startsWith: "the_", mode: "insensitive" as const } },
      { supplierVariantId: { startsWith: "the:", mode: "insensitive" as const } },
    ],
  };

  if (offerSku && isTheWarehouseSupplierSku(offerSku)) {
    const byOffer = await tx.supplierVariant.findFirst({
      where: {
        AND: [
          theVariantIdFilter,
          {
            OR: [
              { providerKey: offerSku },
              { supplierSku: offerSku },
              ...(gtin && validateGtin(gtin) ? [{ providerKey: `THE_${gtin}` }, { gtin }] : []),
            ],
          },
        ],
      },
      orderBy: { stock: "desc" },
    });
    if (byOffer?.supplierVariantId) return String(byOffer.supplierVariantId);
  }

  if (gtin && validateGtin(gtin)) {
    const byGtin = await tx.supplierVariant.findFirst({
      where: {
        AND: [theVariantIdFilter, { gtin }],
      },
      orderBy: { stock: "desc" },
    });
    if (byGtin?.supplierVariantId) return String(byGtin.supplierVariantId);
  }

  return null;
}

/** Catalog row ids: `the:sku-size` (partner style) or legacy `the_…`. */
export function isTheSupplierVariantId(supplierVariantId: string | null | undefined): boolean {
  const id = String(supplierVariantId ?? "")
    .trim()
    .toLowerCase();
  return id.startsWith("the_") || id.startsWith("the:");
}

/**
 * Apply a signed stock delta on a THE catalog row (sale = negative, return/release = positive).
 * Keeps `SupplierVariant.stock` aligned with inventory ledger so DB UI and feeds match.
 */
export async function applyTheCatalogStockDeltaInTx(
  tx: any,
  targetId: string,
  quantityDelta: number,
  lineRef: string,
  details: string[] = []
): Promise<boolean> {
  if (!isTheSupplierVariantId(targetId)) return false;
  const delta = Math.trunc(Number(quantityDelta));
  if (!Number.isFinite(delta) || delta === 0) return false;

  const variant = await tx.supplierVariant.findUnique({
    where: { supplierVariantId: targetId },
  });
  if (!variant) {
    details.push(`skip ${lineRef}: THE variant ${targetId} missing`);
    return false;
  }

  const current = Math.max(0, Math.round(Number(variant.stock ?? 0)));
  const manualLock = Boolean(variant.manualLock);
  const manualStock =
    variant.manualStock != null && Number.isFinite(Number(variant.manualStock))
      ? Math.max(0, Math.round(Number(variant.manualStock)))
      : null;
  const next = Math.max(0, current + delta);
  const nextManual =
    manualStock != null ? Math.max(0, manualStock + delta) : null;

  const updateData: Record<string, unknown> = {
    stock: manualLock && manualStock != null ? variant.stock : next,
    lastSyncAt: new Date(),
    updatedAt: new Date(),
  };
  if (manualLock && manualStock != null && nextManual != null) {
    updateData.manualStock = nextManual;
  }

  const effectiveBefore = manualLock && manualStock != null ? manualStock : current;
  const effectiveAfter =
    manualLock && nextManual != null ? nextManual : manualLock && manualStock != null ? manualStock : next;
  if (effectiveAfter === effectiveBefore) {
    if (details.length > 0) {
      details.push(`${targetId}: stock unchanged at ${effectiveBefore} (${lineRef})`);
    }
    return false;
  }

  await tx.supplierVariant.update({
    where: { supplierVariantId: targetId },
    data: updateData,
  });

  details.push(
    `${targetId}: stock ${effectiveBefore} → ${effectiveAfter} (${delta > 0 ? "+" : ""}${delta}) [THE]`
  );
  return true;
}

async function applyTheStockDeduction(
  tx: any,
  targetId: string,
  qty: number,
  details: string[],
  lineRef: string
): Promise<boolean> {
  return applyTheCatalogStockDeltaInTx(tx, targetId, -Math.abs(qty), lineRef, details);
}

/**
 * When a THE warehouse line ships on Galaxus, decrement the matching `the_` catalog row so
 * Decathlon/Galaxus feeds stop offering the same physical pair.
 */
export async function deductTheCatalogStockForGalaxusLines(params: {
  lines: Array<{ line: GalaxusLineStockInput; quantity?: number }>;
}): Promise<{ adjusted: number; details: string[] }> {
  const details: string[] = [];
  if (!params.lines.length) {
    return { adjusted: 0, details: ["no lines"] };
  }

  let adjusted = 0;
  await prisma.$transaction(async (tx) => {
    const txAny = tx as any;
    for (const { line, quantity } of params.lines) {
      if (!isTheWarehouseGalaxusLine(line)) continue;

      const lineRef = String(line.id ?? "?");
      const qty = Math.max(1, Math.round(Number(quantity ?? line.quantity ?? 1)));
      const targetId = await resolveTheSupplierVariantForGalaxusLine(txAny, line);
      if (!targetId) {
        details.push(`skip line ${lineRef}: no THE supplierVariantId (gtin=${line.gtin ?? "?"})`);
        continue;
      }

      const changed = await applyTheStockDeduction(txAny, targetId, qty, details, lineRef);
      if (changed) adjusted += 1;
    }
  });

  return { adjusted, details };
}
