import { prisma } from "@/app/lib/prisma";

type SupplierVariantLike = {
  supplierVariantId?: string | null;
  stock?: number | string | null;
  manualLock?: boolean | null;
  manualStock?: number | string | null;
};

function toInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveBaseStock(variant: SupplierVariantLike): number {
  const manualLock = Boolean(variant?.manualLock);
  const manualStock = toInt(variant?.manualStock);
  const stock = toInt(variant?.stock) ?? 0;
  if (manualLock && manualStock !== null) return Math.max(0, manualStock);
  return Math.max(0, stock);
}

export function resolveInventoryAvailableStock(variant: SupplierVariantLike, delta = 0): number {
  const base = resolveBaseStock(variant);
  const sum = base + (Number.isFinite(delta) ? Math.trunc(delta) : 0);
  return Math.max(0, sum);
}

export async function loadInventoryDeltasBySupplierVariantId(
  supplierVariantIds: string[]
): Promise<Map<string, number>> {
  const ids = Array.from(new Set(supplierVariantIds.map((id) => String(id ?? "").trim()).filter(Boolean)));
  const map = new Map<string, number>();
  if (ids.length === 0) return map;

  const prismaAny = prisma as any;
  if (!prismaAny.inventoryEvent?.groupBy) {
    return map;
  }

  try {
    const rows = await prismaAny.inventoryEvent.groupBy({
      by: ["supplierVariantId"],
      where: { supplierVariantId: { in: ids } },
      _sum: { quantityDelta: true },
    });
    for (const row of rows ?? []) {
      const id = String(row?.supplierVariantId ?? "").trim();
      if (!id) continue;
      const delta = Number(row?._sum?.quantityDelta ?? 0);
      map.set(id, Number.isFinite(delta) ? Math.trunc(delta) : 0);
    }
    return map;
  } catch (error: any) {
    const message = String(error?.message ?? "");
    if (
      message.includes("inventoryEvent") ||
      message.includes("relation") ||
      message.includes("does not exist")
    ) {
      return map;
    }
    throw error;
  }
}

export async function attachAvailableStock<T extends SupplierVariantLike>(
  variants: T[]
): Promise<Map<string, number>> {
  const ids = variants
    .map((variant) => String(variant?.supplierVariantId ?? "").trim())
    .filter(Boolean);
  const deltas = await loadInventoryDeltasBySupplierVariantId(ids);
  const stockBySupplierVariantId = new Map<string, number>();

  for (const variant of variants) {
    const supplierVariantId = String(variant?.supplierVariantId ?? "").trim();
    if (!supplierVariantId) continue;
    const delta = deltas.get(supplierVariantId) ?? 0;
    stockBySupplierVariantId.set(
      supplierVariantId,
      resolveInventoryAvailableStock(variant, delta)
    );
  }

  return stockBySupplierVariantId;
}
