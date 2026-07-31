import { prisma } from "@/app/lib/prisma";
import { gtinCandidates } from "@/shopify/restock/gtinNormalize";

/**
 * Expand a scanned GTIN to sibling barcodes on the same KickDB variant (UPC ↔ EAN).
 * Feed keys stay UPC-first; EAN scans still resolve Shopify / slug lookups.
 */
export async function expandGtinLookupCandidates(rawGtin: string): Promise<string[]> {
  const set = new Set(gtinCandidates(rawGtin));
  const cands = [...set];
  if (cands.length === 0) return [];

  const kv = await prisma.kickDBVariant.findFirst({
    where: { OR: [{ gtin: { in: cands } }, { ean: { in: cands } }] },
    select: { gtin: true, ean: true },
    orderBy: { updatedAt: "desc" },
  });
  if (kv?.gtin) {
    for (const candidate of gtinCandidates(kv.gtin)) set.add(candidate);
  }
  if (kv?.ean) {
    for (const candidate of gtinCandidates(kv.ean)) set.add(candidate);
  }
  return [...set].filter(Boolean);
}
