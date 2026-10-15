import { prisma } from "@/app/lib/prisma";
import { expandGtinCandidates } from "@/lib/gtinCandidates";

/** Resolve Shopify / catalog SKUs from product barcode GTINs (scan box label). */
export async function resolveShopifySkusForGtinCandidates(
  gtinCandidates: string[]
): Promise<string[]> {
  const gtins = expandGtinCandidates(gtinCandidates);
  if (gtins.length === 0) return [];

  const skus = new Set<string>();
  const [locationRows, supplierRows, localLots, mappingRows] = await Promise.all([
    prisma.shopifyVariantLocationStock.findMany({
      where: { gtin: { in: gtins }, sku: { not: null } },
      select: { sku: true },
      take: 80,
    }),
    prisma.supplierVariant.findMany({
      where: { gtin: { in: gtins } },
      select: { supplierSku: true },
      take: 80,
    }),
    prisma.localStockLot.findMany({
      where: { gtin: { in: gtins }, qtyAvailable: { gt: 0 }, status: "OPEN" },
      select: { sku: true },
      take: 40,
    }),
    prisma.variantMapping.findMany({
      where: { gtin: { in: gtins } },
      select: { providerKey: true },
      take: 80,
    }),
  ]);

  for (const row of locationRows) {
    const sku = String(row.sku ?? "").trim();
    if (sku) skus.add(sku);
  }
  for (const row of supplierRows) {
    const sku = String(row.supplierSku ?? "").trim();
    if (sku) skus.add(sku);
  }
  for (const row of localLots) {
    const sku = String(row.sku ?? "").trim();
    if (sku) skus.add(sku);
  }
  for (const row of mappingRows) {
    const key = String(row.providerKey ?? "").trim();
    if (key) skus.add(key);
  }

  return Array.from(skus);
}
