import { prisma } from "@/app/lib/prisma";
import { expandGtinsForDbLookup, normalizeGtinKey } from "@/galaxus/stx/purchaseUnits";
import { pickMiraklLineGtin, pickMiraklLineSkuCandidates } from "@/decathlon/mirakl/orderLineFields";

/** Live supplier feed row for Decathlon line UI (buy price, size, keys). */
export type DecathlonLineCatalog = {
  supplierVariantId: string | null;
  providerKey: string | null;
  supplierSku: string | null;
  sizeRaw: string | null;
  /** Feed/catalog buy price (e.g. StockX ask you sync). */
  catalogPrice: number | null;
  supplierBrand: string | null;
  supplierProductName: string | null;
  lastSyncAt: string | null;
};

function rowToCatalog(r: {
  supplierVariantId: string;
  providerKey: string | null;
  supplierSku: string;
  gtin: string | null;
  sizeRaw: string | null;
  price: unknown;
  supplierBrand: string | null;
  supplierProductName: string | null;
  lastSyncAt: Date | null;
}): DecathlonLineCatalog {
  const p = r.price != null ? Number(r.price) : NaN;
  return {
    supplierVariantId: r.supplierVariantId,
    providerKey: r.providerKey != null ? String(r.providerKey).trim() || null : null,
    supplierSku: r.supplierSku != null ? String(r.supplierSku).trim() || null : null,
    sizeRaw: r.sizeRaw != null ? String(r.sizeRaw).trim() || null : null,
    catalogPrice: Number.isFinite(p) ? p : null,
    supplierBrand: r.supplierBrand != null ? String(r.supplierBrand).trim() || null : null,
    supplierProductName: r.supplierProductName != null ? String(r.supplierProductName).trim() || null : null,
    lastSyncAt: r.lastSyncAt ? r.lastSyncAt.toISOString() : null,
  };
}

function collectSkuCandidates(line: any): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of pickMiraklLineSkuCandidates(line)) {
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  for (const c of pickMiraklLineSkuCandidates(line?.rawJson)) {
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/** Match each order line to `SupplierVariant` (GTIN, providerKey, supplier SKU / id). */
export async function enrichDecathlonOrderLinesWithSupplierCatalog(
  lines: any[]
): Promise<Map<string, DecathlonLineCatalog>> {
  const out = new Map<string, DecathlonLineCatalog>();
  if (!Array.isArray(lines) || lines.length === 0) return out;

  const gtinNorms = new Set<string>();
  const skuCand = new Set<string>();
  for (const line of lines) {
    const g = normalizeGtinKey(pickMiraklLineGtin(line) ?? line?.gtin);
    if (g) gtinNorms.add(g);
    const gRaw = normalizeGtinKey(pickMiraklLineGtin(line?.rawJson));
    if (gRaw) gtinNorms.add(gRaw);
    for (const c of collectSkuCandidates(line)) skuCand.add(c);
  }

  const expandedGtins = expandGtinsForDbLookup(gtinNorms);
  const skuList = Array.from(skuCand);

  type OrRow = {
    gtin?: { in: string[] };
    supplierSku?: { in: string[] };
    supplierVariantId?: { in: string[] };
    providerKey?: { in: string[] };
  };
  const orClause: OrRow[] = [];
  if (expandedGtins.length > 0) orClause.push({ gtin: { in: expandedGtins } });
  if (skuList.length > 0) {
    orClause.push({ supplierSku: { in: skuList } });
    orClause.push({ supplierVariantId: { in: skuList } });
    orClause.push({ providerKey: { in: skuList } });
  }
  if (orClause.length === 0) return out;

  const rows = await prisma.supplierVariant.findMany({
    where: { OR: orClause },
    select: {
      supplierVariantId: true,
      providerKey: true,
      supplierSku: true,
      gtin: true,
      sizeRaw: true,
      price: true,
      supplierBrand: true,
      supplierProductName: true,
      lastSyncAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const bySupplierSku = new Map<string, (typeof rows)[0]>();
  const bySupplierVariantId = new Map<string, (typeof rows)[0]>();
  const byProviderKey = new Map<string, (typeof rows)[0]>();
  const byNormGtin = new Map<string, (typeof rows)[0]>();
  for (const r of rows) {
    const sku = String(r.supplierSku ?? "").trim();
    if (sku && !bySupplierSku.has(sku)) bySupplierSku.set(sku, r);
    const id = String(r.supplierVariantId ?? "").trim();
    if (id && !bySupplierVariantId.has(id)) bySupplierVariantId.set(id, r);
    const pk = String(r.providerKey ?? "").trim();
    if (pk && !byProviderKey.has(pk)) byProviderKey.set(pk, r);
    const n = normalizeGtinKey(r.gtin);
    if (n && !byNormGtin.has(n)) byNormGtin.set(n, r);
  }

  for (const line of lines) {
    const lineId = String(line?.id ?? "").trim();
    if (!lineId) continue;

    let r: (typeof rows)[0] | undefined;
    for (const c of collectSkuCandidates(line)) {
      r = byProviderKey.get(c) ?? bySupplierVariantId.get(c) ?? bySupplierSku.get(c);
      if (r) break;
    }
    if (!r) {
      const g = normalizeGtinKey(pickMiraklLineGtin(line) ?? line?.gtin);
      if (g) r = byNormGtin.get(g);
    }
    if (!r) {
      const g2 = normalizeGtinKey(pickMiraklLineGtin(line?.rawJson));
      if (g2) r = byNormGtin.get(g2);
    }

    if (r) out.set(lineId, rowToCatalog(r));
  }

  return out;
}
