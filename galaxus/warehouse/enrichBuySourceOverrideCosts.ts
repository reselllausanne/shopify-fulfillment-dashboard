import { prisma } from "@/app/lib/prisma";

/** Refresh buySourceOverride.buyPriceChf from live SupplierVariant.price when present. */
export async function enrichBuySourceOverrideCosts(lines: any[]): Promise<any[]> {
  const ids = Array.from(
    new Set(
      lines
        .map((l) => String(l?.procurement?.buySourceOverride?.buySupplierVariantId ?? "").trim())
        .filter(Boolean)
    )
  );
  if (ids.length === 0) return lines;

  const rows = await prisma.supplierVariant.findMany({
    where: { supplierVariantId: { in: ids } },
    select: { supplierVariantId: true, price: true, stock: true, providerKey: true },
  });
  const byId = new Map(rows.map((r) => [r.supplierVariantId, r]));

  return lines.map((line) => {
    const ov = line?.procurement?.buySourceOverride;
    if (!ov?.buySupplierVariantId) return line;
    const live = byId.get(String(ov.buySupplierVariantId));
    if (!live) return line;
    const buy = Number(live.price);
    if (!Number.isFinite(buy) || buy <= 0) return line;
    const qty = Math.max(Number(line.quantity ?? 1), 1);
    const units = Array.isArray(line.procurement?.units)
      ? line.procurement.units.map((u: any) => ({
          ...u,
          stockxAmount: buy,
          stockxCurrencyCode: "CHF",
        }))
      : line.procurement?.units;
    return {
      ...line,
      procurement: {
        ...line.procurement,
        stockxCostChf: buy,
        stockxCostCurrency: "CHF",
        units,
        buySourceOverride: {
          ...ov,
          buyPriceChf: buy,
          buyProviderKey: ov.buyProviderKey ?? live.providerKey ?? null,
          gldStock: live.stock ?? null,
        },
      },
    };
  });
}
