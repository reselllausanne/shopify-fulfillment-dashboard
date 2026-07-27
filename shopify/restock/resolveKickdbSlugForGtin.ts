import { prisma } from "@/app/lib/prisma";
import { findShopifyVariantByGtin } from "@/shopify/restock/shopifyRestockInventory";
import { gtinCandidates } from "@/shopify/restock/gtinNormalize";

/**
 * KickDB / StockX slug for physical restock + STX import.
 * Never reads NER SupplierVariant — KickDB variant or Shopify handle only.
 */
export async function resolveKickdbSlugForGtin(gtin: string): Promise<string | null> {
  const clean = String(gtin ?? "").trim();
  if (!clean) return null;
  const cands = gtinCandidates(clean);

  const kv = await prisma.kickDBVariant.findFirst({
    where: { OR: [{ gtin: { in: cands } }, { ean: { in: cands } }] },
    select: { product: { select: { urlKey: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const fromKick = String(kv?.product?.urlKey ?? "").trim();
  if (fromKick) return fromKick;

  try {
    const { match } = await findShopifyVariantByGtin(clean);
    const handle = String(match?.productHandle ?? "").trim();
    if (handle) return handle;
  } catch {
    // Non-fatal.
  }

  return null;
}
