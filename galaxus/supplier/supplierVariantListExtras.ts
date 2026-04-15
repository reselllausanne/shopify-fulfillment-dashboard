import type { PrismaClient, SupplierVariant } from "@prisma/client";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export type SupplierVariantListExtra = {
  displayProductName: string;
  partnerKeyResolved: string | null;
  partnerDisplayName: string | null;
  kickdbProductName: string | null;
};

/** Prefix before first ":" in `supplierVariantId` (e.g. `ner:…`, `stx:…`). */
export function partnerKeyFromSupplierVariantId(supplierVariantId: string): string | null {
  const id = String(supplierVariantId ?? "").trim();
  const idx = id.indexOf(":");
  if (idx <= 0) return null;
  const normalized = normalizeProviderKey(id.slice(0, idx));
  if (normalized) return normalized;
  const raw = id.slice(0, idx).trim().toUpperCase();
  return raw.length > 0 ? raw : null;
}

export function displayProductNameForVariant(
  v: Pick<SupplierVariant, "supplierProductName" | "supplierBrand" | "supplierSku">,
  kickdbProductName: string | null
): string {
  const n = String(v.supplierProductName ?? "").trim();
  if (n) return n;
  const k = String(kickdbProductName ?? "").trim();
  if (k) return k;
  const b = String(v.supplierBrand ?? "").trim();
  const sku = String(v.supplierSku ?? "").trim();
  if (b && sku) return `${b} ${sku}`;
  if (sku) return sku;
  return "—";
}

/**
 * Adds display name + partner label for warehouse / partner catalog tables.
 */
export async function enrichSupplierVariantsForListing(
  prisma: PrismaClient,
  items: SupplierVariant[]
): Promise<Array<SupplierVariant & SupplierVariantListExtra>> {
  if (items.length === 0) return [];

  const ids = items.map((i) => i.supplierVariantId);
  const mappings = await prisma.variantMapping.findMany({
    where: { supplierVariantId: { in: ids } },
    include: {
      kickdbVariant: { include: { product: true } },
    },
  });
  const kickNameByVariantId = new Map<string, string>();
  for (const m of mappings) {
    const sid = m.supplierVariantId ? String(m.supplierVariantId) : "";
    if (!sid) continue;
    const name = m.kickdbVariant?.product?.name;
    if (name && String(name).trim()) kickNameByVariantId.set(sid, String(name).trim());
  }

  const keySet = new Set<string>();
  for (const item of items) {
    const fromRow = normalizeProviderKey(item.providerKey);
    if (fromRow) keySet.add(fromRow);
    const fromId = partnerKeyFromSupplierVariantId(item.supplierVariantId);
    if (fromId) keySet.add(fromId);
  }
  const keys = [...keySet];
  const partners =
    keys.length > 0
      ? await prisma.partner.findMany({
          where: { OR: keys.map((k) => ({ key: { equals: k, mode: "insensitive" as const } })) },
          select: { key: true, name: true },
        })
      : [];
  const partnerNameByKey = new Map<string, string>();
  for (const p of partners) {
    const k = normalizeProviderKey(p.key);
    if (k) partnerNameByKey.set(k, p.name);
  }

  return items.map((item) => {
    const pk =
      normalizeProviderKey(item.providerKey) ?? partnerKeyFromSupplierVariantId(item.supplierVariantId);
    const kickdbProductName = kickNameByVariantId.get(item.supplierVariantId) ?? null;
    const displayProductName = displayProductNameForVariant(item, kickdbProductName);
    const partnerDisplayName = pk ? partnerNameByKey.get(pk) ?? pk : null;
    return {
      ...item,
      displayProductName,
      partnerKeyResolved: pk,
      partnerDisplayName,
      kickdbProductName,
    };
  });
}
