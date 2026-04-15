import { prisma } from "@/app/lib/prisma";
import { enrichDecathlonOrderLinesWithSupplierCatalog } from "@/decathlon/orders/supplierCatalogLineEnrichment";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export type PartnerShippedBreakdown = {
  partnerKey: string;
  decathlonShippedChf: number;
  partnerCatalogChf: number;
  spreadChf: number;
  lines: number;
};

function isNerKey(key: string | null | undefined) {
  return String(key ?? "").trim().toLowerCase() === "ner";
}

function partnerKeyFromOfferSku(offerSku: string | null | undefined): string | null {
  const s = String(offerSku ?? "").trim();
  if (!s) return null;
  const u = s.toUpperCase();
  const idx = u.indexOf("_");
  if (idx <= 0) return null;
  return normalizeProviderKey(u.slice(0, idx));
}

function effectivePartnerKeyForLine(
  line: { offerSku?: string | null },
  order: { partnerKey?: string | null }
): string | null {
  return partnerKeyFromOfferSku(line.offerSku) ?? normalizeProviderKey(order.partnerKey);
}

function lineBelongsToPartner(
  line: { offerSku?: string | null },
  order: { partnerKey?: string | null },
  partnerKey: string
): boolean {
  const k = normalizeProviderKey(partnerKey);
  if (!k) return false;
  const pre = `${k.toUpperCase()}_`;
  if (String(line.offerSku ?? "").toUpperCase().startsWith(pre)) return true;
  const op = order.partnerKey ? normalizeProviderKey(order.partnerKey) : null;
  return Boolean(op && op === k);
}

/**
 * Aggregates shipped Decathlon units (Mirakl line unitPrice × qty) vs partner catalog buy price (SupplierVariant.price).
 */
export async function computeDecathlonPartnerShippedMetrics(options: {
  onlyPartnerKey?: string | null;
  since?: Date;
  maxRows?: number;
}): Promise<{
  currency: string;
  decathlonShippedChf: number;
  partnerCatalogChf: number;
  spreadChf: number;
  shippedLineCount: number;
  byPartner: PartnerShippedBreakdown[];
}> {
  const take = Math.min(Math.max(options.maxRows ?? 20000, 1), 50000);
  const shipmentWhere = options.since
    ? { shippedAt: { gte: options.since } }
    : { shippedAt: { not: null } };

  const rows = await prisma.decathlonShipmentLine.findMany({
    where: {
      quantity: { gt: 0 },
      shipment: shipmentWhere,
    },
    take,
    orderBy: { createdAt: "desc" },
    include: {
      orderLine: true,
      shipment: { include: { order: true } },
    },
  });

  const orderLines = rows.map((r) => r.orderLine).filter(Boolean);
  const uniqueLines = Array.from(new Map(orderLines.map((l) => [l.id, l])).values());
  const catalogByLineId = await enrichDecathlonOrderLinesWithSupplierCatalog(uniqueLines as any[]);

  let decathlonShippedChf = 0;
  let partnerCatalogChf = 0;
  let shippedLineCount = 0;
  let currency = "CHF";
  const byPartnerMap = new Map<
    string,
    { decathlonShippedChf: number; partnerCatalogChf: number; spreadChf: number; lines: number }
  >();

  for (const row of rows) {
    const line = row.orderLine;
    const order = row.shipment.order;
    if (!line || !order) continue;
    currency = String(order.currencyCode ?? line.currencyCode ?? "CHF") || currency;

    const pk = options.onlyPartnerKey ? normalizeProviderKey(options.onlyPartnerKey) : null;
    if (pk) {
      if (!lineBelongsToPartner(line, order, pk)) continue;
    } else {
      const eff = effectivePartnerKeyForLine(line, order);
      if (!eff || isNerKey(eff)) continue;
    }

    const qty = Number(row.quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const unitDec = Number(line.unitPrice ?? 0);
    const decPart = Number.isFinite(unitDec) ? unitDec * qty : 0;
    const cat = catalogByLineId.get(line.id);
    const unitBuy = cat?.catalogPrice != null && Number.isFinite(Number(cat.catalogPrice)) ? Number(cat.catalogPrice) : null;
    const buyPart = unitBuy != null ? unitBuy * qty : 0;

    decathlonShippedChf += decPart;
    partnerCatalogChf += buyPart;
    shippedLineCount += 1;

    const groupKey = pk ?? effectivePartnerKeyForLine(line, order);
    if (!groupKey || isNerKey(groupKey)) continue;
    const g = byPartnerMap.get(groupKey) ?? {
      decathlonShippedChf: 0,
      partnerCatalogChf: 0,
      spreadChf: 0,
      lines: 0,
    };
    g.decathlonShippedChf += decPart;
    g.partnerCatalogChf += buyPart;
    g.spreadChf += decPart - buyPart;
    g.lines += 1;
    byPartnerMap.set(groupKey, g);
  }

  const spreadChf = decathlonShippedChf - partnerCatalogChf;
  const byPartner: PartnerShippedBreakdown[] = Array.from(byPartnerMap.entries())
    .map(([partnerKey, v]) => ({
      partnerKey,
      decathlonShippedChf: v.decathlonShippedChf,
      partnerCatalogChf: v.partnerCatalogChf,
      spreadChf: v.spreadChf,
      lines: v.lines,
    }))
    .sort((a, b) => b.decathlonShippedChf - a.decathlonShippedChf);

  return {
    currency,
    decathlonShippedChf,
    partnerCatalogChf,
    spreadChf,
    shippedLineCount,
    byPartner,
  };
}
