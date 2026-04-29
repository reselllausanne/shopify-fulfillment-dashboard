import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import { isValidProviderKeyWithGtin } from "@/galaxus/supplier/providerKey";
import type { InventoryLineRef } from "./types";

export type ResolvedSupplierVariant = {
  supplierVariantId: string;
  providerKey: string | null;
  gtin: string | null;
};

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeProviderKey(value: string | null): string | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  return isValidProviderKeyWithGtin(upper) ? upper : null;
}

async function findBySupplierVariantId(
  supplierVariantId: string | null
): Promise<ResolvedSupplierVariant | null> {
  if (!supplierVariantId) return null;
  const row = await prisma.supplierVariant.findUnique({
    where: { supplierVariantId },
    select: { supplierVariantId: true, providerKey: true, gtin: true },
  });
  if (!row) return null;
  return {
    supplierVariantId: row.supplierVariantId,
    providerKey: row.providerKey ?? null,
    gtin: row.gtin ?? null,
  };
}

async function findByProviderKey(
  providerKey: string | null
): Promise<ResolvedSupplierVariant | null> {
  if (!providerKey) return null;
  const row = await prisma.supplierVariant.findFirst({
    where: { providerKey },
    orderBy: [{ updatedAt: "desc" }],
    select: { supplierVariantId: true, providerKey: true, gtin: true },
  });
  if (!row) return null;
  return {
    supplierVariantId: row.supplierVariantId,
    providerKey: row.providerKey ?? null,
    gtin: row.gtin ?? null,
  };
}

async function findByGtin(gtin: string | null): Promise<ResolvedSupplierVariant | null> {
  if (!gtin) return null;
  const row = await prisma.supplierVariant.findFirst({
    where: { gtin },
    orderBy: [{ updatedAt: "desc" }],
    select: { supplierVariantId: true, providerKey: true, gtin: true },
  });
  if (!row) return null;
  return {
    supplierVariantId: row.supplierVariantId,
    providerKey: row.providerKey ?? null,
    gtin: row.gtin ?? null,
  };
}

export async function resolveSupplierVariantForInventoryLine(
  ref: InventoryLineRef
): Promise<ResolvedSupplierVariant | null> {
  const supplierVariantId = clean(ref.supplierVariantId);
  const direct = await findBySupplierVariantId(supplierVariantId);
  if (direct) return direct;

  const providerKeyFromField = normalizeProviderKey(clean(ref.providerKey));
  const providerKeyFromSku = normalizeProviderKey(clean(ref.sku));
  const providerKey = providerKeyFromField ?? providerKeyFromSku;

  if (providerKey) {
    const byProvider = await findByProviderKey(providerKey);
    if (byProvider) return byProvider;
  }

  const gtin = clean(ref.gtin);
  if (gtin && validateGtin(gtin)) {
    const byGtin = await findByGtin(gtin);
    if (byGtin) return byGtin;
  }

  return null;
}
