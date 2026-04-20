import { prisma } from "@/app/lib/prisma";
import { normalizeSize, normalizeSku, validateGtin } from "@/app/lib/normalize";
import { buildSupplierVariantId } from "@/app/lib/partnerImport";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";

export function roundToCents(value: number | null): number | null {
  if (!Number.isFinite(value as number)) return null;
  return Math.round((value as number) * 100) / 100;
}

export function extractGtinFromOfferSku(offerSku: string | null): string | null {
  if (!offerSku) return null;
  const parts = offerSku.split("_");
  if (parts.length < 2) return null;
  const candidate = parts.slice(1).join("_").trim();
  return validateGtin(candidate) ? candidate : null;
}

export async function applyReturnRestock(params: {
  returnLine: any;
  orderLine: any | null;
  offerSku: string | null;
  basePrice: number | null;
}): Promise<{ applied: boolean; supplierVariantId?: string | null }> {
  const offerSku = params.offerSku;
  if (!offerSku) return { applied: false };
  const offerSkuLower = offerSku.toLowerCase();
  const isStx = offerSkuLower.startsWith("stx_");
  const isThe = offerSkuLower.startsWith("the_");
  if (!isStx && !isThe) return { applied: false };

  const quantity = Number(params.returnLine?.quantity ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return { applied: false };

  const orderLine = params.orderLine;
  const lineSkuRaw =
    orderLine?.supplierSku ?? orderLine?.productSku ?? orderLine?.offerSku ?? offerSku ?? "RETURN";
  const normalizedSku = normalizeSku(String(lineSkuRaw));
  const sku = normalizedSku ?? (String(lineSkuRaw).trim() || "RETURN");
  const sizeRaw = normalizeSize(orderLine?.size ?? "") ?? "ONESIZE";
  const gtin =
    orderLine?.gtin ??
    extractGtinFromOfferSku(offerSku) ??
    extractGtinFromOfferSku(orderLine?.offerSku ?? null) ??
    null;
  const validGtin = gtin && validateGtin(gtin) ? gtin : null;

  let supplierVariantId: string | null = null;
  try {
    supplierVariantId = buildSupplierVariantId("THE", sku, sizeRaw);
  } catch {
    supplierVariantId = null;
  }

  const providerKey = validGtin && supplierVariantId ? buildProviderKey(validGtin, supplierVariantId) : null;
  const priceBase = params.basePrice;
  const restockPrice =
    priceBase != null && Number.isFinite(priceBase) && priceBase > 0
      ? roundToCents(priceBase * (isStx ? 0.88 : 1))
      : null;

  const prismaAny = prisma as any;
  let existing: any | null = null;
  if (providerKey && validGtin) {
    existing = await prismaAny.supplierVariant.findFirst({
      where: { providerKey, gtin: validGtin },
    });
  }
  if (!existing && supplierVariantId) {
    existing = await prismaAny.supplierVariant.findUnique({
      where: { supplierVariantId },
    });
  }

  const applyPrice =
    (isStx || isThe) &&
    restockPrice != null &&
    Number.isFinite(restockPrice) &&
    restockPrice > 0 &&
    (!existing || !existing.manualLock);

  if (!existing) {
    if (!supplierVariantId || !providerKey || !validGtin || restockPrice == null) {
      return { applied: false };
    }
    const created = await prismaAny.supplierVariant.create({
      data: {
        supplierVariantId,
        supplierSku: sku,
        providerKey,
        gtin: validGtin,
        sizeRaw,
        sizeNormalized: sizeRaw,
        stock: quantity,
        price: restockPrice,
        lastSyncAt: new Date(),
      },
    });
    await prismaAny.variantMapping.upsert({
      where: { supplierVariantId: created.supplierVariantId },
      create: {
        supplierVariantId: created.supplierVariantId,
        gtin: validGtin,
        providerKey,
        status: "MATCHED",
      },
      update: {
        gtin: validGtin,
        providerKey,
        status: "MATCHED",
      },
    });
    return { applied: true, supplierVariantId: created.supplierVariantId };
  }

  const useManual = Boolean(existing.manualLock) && existing.manualStock != null;
  const currentStock = useManual ? Number(existing.manualStock ?? 0) : Number(existing.stock ?? 0);
  const nextStock = Math.max(currentStock + quantity, 0);

  const updateData: Record<string, unknown> = {
    stock: useManual ? existing.stock : nextStock,
    manualStock: useManual ? nextStock : existing.manualStock,
    lastSyncAt: new Date(),
    updatedAt: new Date(),
  };
  if (applyPrice && restockPrice != null) {
    const cur = Number(existing.price ?? 0);
    const next = Number.isFinite(cur) && cur > 0 ? Math.min(cur, restockPrice) : restockPrice;
    updateData.price = roundToCents(next);
  }
  await prismaAny.supplierVariant.update({
    where: { supplierVariantId: existing.supplierVariantId },
    data: updateData,
  });

  return { applied: true, supplierVariantId: existing.supplierVariantId };
}
