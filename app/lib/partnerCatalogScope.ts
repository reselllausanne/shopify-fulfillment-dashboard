import type { Prisma } from "@prisma/client";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

/**
 * Partner "catalog" rows: CSV inbox (`ner:sku-size`) and Mirakl-style (`NER_gtin`, `the_gtin`, …).
 */
export function partnerCatalogVariantWhere(partnerKeyRaw: string): Prisma.SupplierVariantWhereInput {
  const pk = normalizeProviderKey(partnerKeyRaw);
  if (!pk) {
    return { supplierVariantId: { in: [] } };
  }
  const pU = pk.toUpperCase();
  const pL = pk.toLowerCase();
  return {
    OR: [
      { supplierVariantId: { startsWith: `${pL}:`, mode: "insensitive" } },
      { supplierVariantId: { startsWith: `${pU}_`, mode: "insensitive" } },
      { supplierSku: { startsWith: `${pU}_`, mode: "insensitive" } },
      { providerKey: { startsWith: `${pU}_`, mode: "insensitive" } },
    ],
  };
}

export function partnerOwnsSupplierVariant(supplierVariantId: string, partnerKeyRaw: string): boolean {
  const pk = normalizeProviderKey(partnerKeyRaw);
  if (!pk) return false;
  const low = String(supplierVariantId ?? "").trim().toLowerCase();
  if (low.startsWith(`${pk.toLowerCase()}:`)) return true;
  return low.startsWith(`${pk.toUpperCase()}_`.toLowerCase());
}
