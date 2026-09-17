import { prisma } from "@/app/lib/prisma";
import {
  applySupplierStockPublishGate,
  defaultPolicyStatusForSupplier,
  loadEvidencePublishedQtyMap,
  loadPolicyStatusMap,
  resolveSupplierKeyFromIds,
  SCRAPER_SUPPLIER_KEYS,
  type SupplierStockPolicyStatus,
} from "@/inventory/supplierStock";

type SupplierVariantLike = {
  supplierVariantId?: string | null;
  stock?: number | string | null;
  manualLock?: boolean | null;
  manualStock?: number | string | null;
  providerKey?: string | null;
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
  // THE warehouse stock is decremented on SALE in SupplierVariant.stock — do not re-apply ledger.
  const id = String(variant?.supplierVariantId ?? "")
    .trim()
    .toLowerCase();
  if (id.startsWith("the_") || id.startsWith("the:")) {
    return base;
  }
  const sum = base + (Number.isFinite(delta) ? Math.trunc(delta) : 0);
  return Math.max(0, sum);
}

/** Postgres prepared-statement bind limit is 32767 — chunk large IN lists. */
const INVENTORY_DELTA_CHUNK_SIZE = 5000;

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
    for (let offset = 0; offset < ids.length; offset += INVENTORY_DELTA_CHUNK_SIZE) {
      const chunk = ids.slice(offset, offset + INVENTORY_DELTA_CHUNK_SIZE);
      const rows = await prismaAny.inventoryEvent.groupBy({
        by: ["supplierVariantId"],
        where: { supplierVariantId: { in: chunk } },
        _sum: { quantityDelta: true },
      });
      for (const row of rows ?? []) {
        const id = String(row?.supplierVariantId ?? "").trim();
        if (!id) continue;
        const delta = Number(row?._sum?.quantityDelta ?? 0);
        map.set(id, Number.isFinite(delta) ? Math.trunc(delta) : 0);
      }
    }
    return map;
  } catch (error: any) {
    const message = String(error?.message ?? "");
    if (
      message.includes("inventoryEvent") ||
      message.includes("relation") ||
      message.includes("does not exist") ||
      message.includes("too many bind variables")
    ) {
      console.warn("[inventory][availableStock] delta load failed — using base stock only", message.slice(0, 200));
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

  let policyMap = new Map<string, SupplierStockPolicyStatus>();
  let evidenceMap = new Map<string, { publishedQty: number; lastProofAt: Date | null }>();
  try {
    if (typeof loadPolicyStatusMap === "function") {
      policyMap = await loadPolicyStatusMap();
    }
    if (typeof loadEvidencePublishedQtyMap === "function") {
      evidenceMap = await loadEvidencePublishedQtyMap(ids);
    }
  } catch (err: any) {
    console.warn(
      "[inventory][availableStock] supplier-stock gate skipped",
      String(err?.message ?? err).slice(0, 200)
    );
  }

  for (const variant of variants) {
    const supplierVariantId = String(variant?.supplierVariantId ?? "").trim();
    if (!supplierVariantId) continue;
    const delta = deltas.get(supplierVariantId) ?? 0;
    let stock = resolveInventoryAvailableStock(variant, delta);

    if (!variant?.manualLock) {
      const supplierKey = resolveSupplierKeyFromIds(supplierVariantId);
      if (supplierKey && SCRAPER_SUPPLIER_KEYS.has(supplierKey)) {
        const policyStatus =
          (policyMap.get(supplierKey) as SupplierStockPolicyStatus | undefined) ??
          defaultPolicyStatusForSupplier(supplierKey);
        const evidence = evidenceMap.get(supplierVariantId);
        stock = applySupplierStockPublishGate({
          baseStock: stock,
          policyStatus,
          evidencePublishedQty: evidence?.publishedQty ?? null,
          lastProofAt: evidence?.lastProofAt ?? null,
          manualLock: false,
        });
      }
    }

    stockBySupplierVariantId.set(supplierVariantId, stock);
  }

  return stockBySupplierVariantId;
}
