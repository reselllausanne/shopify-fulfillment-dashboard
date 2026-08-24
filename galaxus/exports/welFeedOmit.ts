/**
 * Temporary WEL feed omit helpers (Aug 2026 hotfix).
 *
 * Used by `scripts/galaxus-push-omit-wel-cards.ts` to strip WEL card SKUs from
 * full StockData/PriceData uploads without VPS-only one-offs.
 *
 * FOLLOW-UP (durable management — do not leave as script-only forever):
 * - Decide policy: keep live on Galaxus, force qty 0, or block price updates only.
 * - Prefer export-time filter in stock/offer routes (or runFeedUpload) driven by
 *   classification (`classifyWelProductKind` → tradingcard) / allowlist, not ad-hoc regex.
 * - Snapshot rebuild must apply the same omit so post-sale pushes stay consistent.
 */
import { prisma } from "@/app/lib/prisma";

/** WEL title/brand match for temporary card-SKU omit. */
export function isWelCardOmitTitle(name: string, brand: string): boolean {
  const text = `${name} ${brand}`.toLowerCase();
  return /pok[eé]mon/.test(text);
}

export async function loadWelCardOmitProviderKeys(): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ providerKey: string | null; supplierProductName: string | null; supplierBrand: string | null }>
  >(
    `SELECT "providerKey", "supplierProductName", "supplierBrand"
     FROM "SupplierVariant"
     WHERE "providerKey" ILIKE 'WEL\\_%'
       AND (
         COALESCE("supplierProductName",'') ~* 'pok.?mon'
         OR COALESCE("supplierBrand",'') ~* 'pok.?mon'
       )`
  );
  const out = new Set<string>();
  for (const row of rows) {
    const key = String(row.providerKey ?? "").trim();
    if (!key) continue;
    if (isWelCardOmitTitle(String(row.supplierProductName ?? ""), String(row.supplierBrand ?? ""))) {
      out.add(key);
    }
  }
  return out;
}
