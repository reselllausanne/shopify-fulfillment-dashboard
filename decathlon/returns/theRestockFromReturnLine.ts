import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";

export function extractGtinFromOfferSku(offerSku: string | null): string | null {
  if (!offerSku) return null;
  const parts = offerSku.split("_");
  if (parts.length < 2) return null;
  const candidate = parts.slice(1).join("_").trim();
  return validateGtin(candidate) ? candidate : null;
}

export function roundToCents(value: number | null): number | null {
  if (!Number.isFinite(value as number)) return null;
  return Math.round((value as number) * 100) / 100;
}

/** Restock: new catalog price = restock source price × this factor (25% off). */
export const RESTOCK_PRICE_FROM_LAST = 0.75;

/** Decathlon / DB: same tail as offer, `STX_` → `the_` (matches `stx_` / `ner:` style ids). */
export function stxOfferSkuToTheCatalogOfferSku(offerSku: string): string {
  const t = String(offerSku ?? "").trim();
  if (!t) return t;
  return t.replace(/^stx_/i, "the_");
}

function uniqueKeys(...candidates: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function expandCaseKeys(ids: string[]): string[] {
  return uniqueKeys(...ids.flatMap((id) => [id, id.toUpperCase(), id.toLowerCase()]));
}

async function findSupplierVariantByKeys(prismaAny: any, keys: string[]) {
  if (keys.length === 0) return null;
  return prismaAny.supplierVariant.findFirst({
    where: {
      OR: keys.flatMap((k) => [
        { supplierVariantId: k },
        { supplierSku: k },
        { providerKey: k },
      ]),
    },
  });
}

/** STX row tied to this sale (Mirakl offer SKU or GTIN fallback). */
async function findStxSupplierVariantForOfferSku(prismaAny: any, offerSku: string) {
  const raw = String(offerSku ?? "").trim();
  if (!raw) return null;
  const keys = uniqueKeys(raw, raw.toUpperCase(), raw.toLowerCase());
  const or = keys.flatMap((k) => [
    { supplierVariantId: k },
    { supplierSku: k },
    { providerKey: k },
  ]);
  const byKey = await prismaAny.supplierVariant.findFirst({
    where: {
      AND: [{ OR: or }, { supplierVariantId: { startsWith: "stx_", mode: "insensitive" } }],
    },
  });
  if (byKey) return byKey;

  const gtin = extractGtinFromOfferSku(raw);
  if (!gtin || !validateGtin(gtin)) return null;
  return prismaAny.supplierVariant.findFirst({
    where: { gtin, supplierVariantId: { startsWith: "stx_", mode: "insensitive" } },
    orderBy: { updatedAt: "desc" },
  });
}

function theCandidateIdsFromStxRowAndOffer(stxRow: { supplierVariantId: string }, offerSkuRaw: string): string[] {
  const fromOffer = stxOfferSkuToTheCatalogOfferSku(offerSkuRaw);
  const fromInternal = String(stxRow.supplierVariantId ?? "").replace(/^stx_/i, "the_");
  const out: string[] = [];
  if (fromOffer && fromOffer.toLowerCase().startsWith("the_")) out.push(fromOffer);
  if (fromInternal && !out.includes(fromInternal)) out.push(fromInternal);
  return out;
}

async function upsertVariantMappingForThe(
  prismaAny: any,
  params: {
    supplierVariantId: string;
    gtin: string | null;
    providerKey: string | null;
    kickdbVariantId?: string | null;
  }
) {
  await prismaAny.variantMapping.upsert({
    where: { supplierVariantId: params.supplierVariantId },
    create: {
      supplierVariantId: params.supplierVariantId,
      gtin: params.gtin,
      providerKey: params.providerKey,
      status: "MATCHED",
      kickdbVariantId: params.kickdbVariantId ?? null,
    },
    update: {
      gtin: params.gtin,
      providerKey: params.providerKey,
      status: "MATCHED",
      ...(params.kickdbVariantId != null ? { kickdbVariantId: params.kickdbVariantId } : {}),
    },
  });
}

function resolveRestockSourcePrice(preferredPrice: number | null, fallbackPrice: number | null): number | null {
  if (preferredPrice != null && Number.isFinite(preferredPrice) && preferredPrice > 0) return preferredPrice;
  if (fallbackPrice != null && Number.isFinite(fallbackPrice) && fallbackPrice > 0) return fallbackPrice;
  return null;
}

/**
 * Return restock → YOUR (THE) catalog:
 * - `the_` / `THE_` row exists: add qty; if not `manualLock`, set price to 75% of the return/restock price.
 * - Else STX return: clone STX row with `the_…` id/sku at 75% of the return/restock price.
 * - DB catalog price is only a fallback if the return line has no usable price.
 */
export async function applyReturnRestock(params: {
  returnLine: any;
  orderLine: any | null;
  offerSku: string | null;
  basePrice: number | null;
}): Promise<{
  applied: boolean;
  supplierVariantId?: string | null;
  /** Set when a restock price was written (25% off restock source price). */
  newPrice?: number | null;
}> {
  const offerSkuRaw = String(params.offerSku ?? "").trim();
  if (!offerSkuRaw) return { applied: false };
  const offerLower = offerSkuRaw.toLowerCase();
  if (!offerLower.startsWith("stx_") && !offerLower.startsWith("the_")) {
    return { applied: false };
  }

  const quantity = Number(params.returnLine?.quantity ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0) return { applied: false };

  const prismaAny = prisma as any;
  const isStxReturn = offerLower.startsWith("stx_");

  const catalogTheFromOffer = stxOfferSkuToTheCatalogOfferSku(offerSkuRaw);
  const keysFromOffer = expandCaseKeys([catalogTheFromOffer]);

  let target = await findSupplierVariantByKeys(prismaAny, keysFromOffer);

  let stxRow: any = null;
  if (!target && isStxReturn) {
    stxRow = await findStxSupplierVariantForOfferSku(prismaAny, offerSkuRaw);
    if (stxRow?.supplierVariantId) {
      const altIds = theCandidateIdsFromStxRowAndOffer(stxRow, offerSkuRaw);
      const altKeys = expandCaseKeys(altIds);
      target = await findSupplierVariantByKeys(prismaAny, altKeys);
    }
  }

  if (!target && isStxReturn && stxRow?.supplierVariantId) {
    const candidateIds = theCandidateIdsFromStxRowAndOffer(stxRow, offerSkuRaw);
    const primaryTheId =
      candidateIds.find((id) => id.toLowerCase().startsWith("the_")) ?? candidateIds[0] ?? null;
    if (!primaryTheId) return { applied: false };

    const existingByCloneId = await prismaAny.supplierVariant.findUnique({
      where: { supplierVariantId: primaryTheId },
    });
    if (existingByCloneId) {
      target = existingByCloneId;
    } else {
      const newProviderKey = buildProviderKey(stxRow.gtin, primaryTheId);
      const lastForClone = resolveRestockSourcePrice(
        params.basePrice,
        Number(stxRow.price ?? 0)
      );
      const lastForCloneNum = Number(lastForClone);
      const price =
        Number.isFinite(lastForCloneNum) && lastForCloneNum > 0
          ? roundToCents(lastForCloneNum * RESTOCK_PRICE_FROM_LAST) ?? 0
          : 0;

      const createData: Record<string, unknown> = {
        supplierVariantId: primaryTheId,
        supplierSku: primaryTheId,
        providerKey: newProviderKey,
        gtin: stxRow.gtin ?? null,
        price,
        stock: quantity,
        sizeRaw: stxRow.sizeRaw ?? null,
        sizeNormalized: stxRow.sizeNormalized ?? stxRow.sizeRaw ?? null,
        supplierBrand: stxRow.supplierBrand ?? null,
        supplierProductName: stxRow.supplierProductName ?? null,
        weightGrams: stxRow.weightGrams ?? null,
        leadTimeDays: stxRow.leadTimeDays ?? null,
        deliveryType: stxRow.deliveryType ?? null,
        lastSyncAt: new Date(),
      };
      if (stxRow.images != null) createData.images = stxRow.images;
      if (stxRow.sourceImageUrl != null) createData.sourceImageUrl = stxRow.sourceImageUrl;
      if (stxRow.hostedImageUrl != null) createData.hostedImageUrl = stxRow.hostedImageUrl;

      await prismaAny.supplierVariant.create({ data: createData });

      const srcMap = await prismaAny.variantMapping.findFirst({
        where: { supplierVariantId: stxRow.supplierVariantId },
      });
      await upsertVariantMappingForThe(prismaAny, {
        supplierVariantId: primaryTheId,
        gtin: stxRow.gtin ?? null,
        providerKey: newProviderKey,
        kickdbVariantId: srcMap?.kickdbVariantId ?? null,
      });

      return {
        applied: true,
        supplierVariantId: primaryTheId,
        newPrice: price > 0 ? price : null,
      };
    }
  }

  if (!target?.supplierVariantId) return { applied: false };

  const curDb = Number(target.price ?? 0);
  const restockSourcePrice = resolveRestockSourcePrice(params.basePrice, curDb);
  const restockPrice =
    restockSourcePrice != null ? roundToCents(restockSourcePrice * RESTOCK_PRICE_FROM_LAST) : null;

  const applyPrice =
    restockPrice != null &&
    Number.isFinite(restockPrice) &&
    restockPrice > 0 &&
    !target.manualLock;

  const useManual = Boolean(target.manualLock) && target.manualStock != null;
  const currentStock = useManual ? Number(target.manualStock ?? 0) : Number(target.stock ?? 0);
  const nextStock = Math.max(currentStock + quantity, 0);

  const updateData: Record<string, unknown> = {
    stock: useManual ? target.stock : nextStock,
    manualStock: useManual ? nextStock : target.manualStock,
    lastSyncAt: new Date(),
    updatedAt: new Date(),
  };
  let newPrice: number | null = null;
  if (applyPrice && restockPrice != null) {
    const rounded = roundToCents(restockPrice);
    if (rounded != null) {
      updateData.price = rounded;
      newPrice = rounded;
    }
  }
  await prismaAny.supplierVariant.update({
    where: { supplierVariantId: target.supplierVariantId },
    data: updateData,
  });

  return { applied: true, supplierVariantId: target.supplierVariantId, newPrice };
}
