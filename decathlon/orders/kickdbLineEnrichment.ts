import { prisma } from "@/app/lib/prisma";
import { expandGtinsForDbLookup, normalizeGtinKey } from "@/galaxus/stx/purchaseUnits";
import { pickMiraklLineGtin, pickMiraklLineSkuCandidates } from "@/decathlon/mirakl/orderLineFields";

/** Minimal KickDB fields for Decathlon line UI (size + variant name + style id). */
export type DecathlonLineKickdb = {
  /** Brand + product title (no size — size is separate). */
  variantName: string | null;
  /** EU / US combined for display (from `KickDBVariant.sizeEu` / `sizeUs`). */
  sizeRaw: string | null;
  /** Stored KickDB EU size (see `KickDBVariant.sizeEu`). */
  sizeEu: string | null;
  /** Stored KickDB US size (see `KickDBVariant.sizeUs`). */
  sizeUs: string | null;
  /** KickDB product `styleId` (StockX-style product SKU). */
  styleId: string | null;
};

function buildKickdbSizeRaw(variant: { sizeEu?: string | null; sizeUs?: string | null }): string | null {
  const eu = String(variant.sizeEu ?? "").trim();
  const us = String(variant.sizeUs ?? "").trim();
  if (eu && us) return `${us} US / ${eu} EU`;
  if (eu) return eu;
  if (us) return `${us} US`;
  return null;
}

function mappingToKickdb(m: any, supplierSizeRaw?: string | null): DecathlonLineKickdb | null {
  const kv = m.kickdbVariant;
  if (!kv) return null;
  const p = kv.product;
  const sizeEu = kv.sizeEu != null ? String(kv.sizeEu).trim() || null : null;
  const sizeUs = kv.sizeUs != null ? String(kv.sizeUs).trim() || null : null;
  const sizeRaw =
    buildKickdbSizeRaw({ sizeEu, sizeUs }) ?? (supplierSizeRaw?.trim() ? supplierSizeRaw.trim() : null);
  const brand = p?.brand?.trim() || null;
  const name = p?.name?.trim() || null;
  const variantName = [brand, name].filter(Boolean).join(" ").trim() || null;
  const styleId = p?.styleId != null ? String(p.styleId).trim() || null : null;

  return {
    variantName,
    sizeRaw,
    sizeEu,
    sizeUs,
    styleId,
  };
}

/** Resolve KickDB product/variant per line: prefer `SupplierVariant` → `VariantMapping` (per-size), then GTIN / providerKey. */
export async function enrichDecathlonOrderLinesWithKickdb(lines: any[]): Promise<Map<string, DecathlonLineKickdb>> {
  const out = new Map<string, DecathlonLineKickdb>();
  if (!Array.isArray(lines) || lines.length === 0) return out;

  const gtinNorms = new Set<string>();
  const skuCand = new Set<string>();
  for (const line of lines) {
    const g = normalizeGtinKey(pickMiraklLineGtin(line) ?? line?.gtin);
    if (g) gtinNorms.add(g);
    for (const c of pickMiraklLineSkuCandidates(line)) skuCand.add(c);
  }

  const expandedGtins = expandGtinsForDbLookup(gtinNorms);
  const skuList = Array.from(skuCand);
  const orClause: Array<{ gtin?: { in: string[] }; providerKey?: { in: string[] } }> = [];
  if (expandedGtins.length > 0) orClause.push({ gtin: { in: expandedGtins } });
  if (skuList.length > 0) orClause.push({ providerKey: { in: skuList } });

  const supplierVariants =
    skuList.length > 0
      ? await prisma.supplierVariant.findMany({
          where: {
            OR: [{ supplierSku: { in: skuList } }, { supplierVariantId: { in: skuList } }],
          },
          select: {
            supplierVariantId: true,
            supplierSku: true,
            sizeRaw: true,
          },
        })
      : [];

  const skuToSupplierVariantId = new Map<string, string>();
  const supplierSizeRawByVariantId = new Map<string, string | null>();
  for (const sv of supplierVariants) {
    supplierSizeRawByVariantId.set(sv.supplierVariantId, sv.sizeRaw ?? null);
    skuToSupplierVariantId.set(sv.supplierSku, sv.supplierVariantId);
    skuToSupplierVariantId.set(sv.supplierVariantId, sv.supplierVariantId);
  }

  const supplierIds = [...new Set(supplierVariants.map((s) => s.supplierVariantId))];
  const mappingsBySupplierId =
    supplierIds.length > 0
      ? await prisma.variantMapping.findMany({
          where: {
            supplierVariantId: { in: supplierIds },
            kickdbVariantId: { not: null },
          },
          include: {
            kickdbVariant: { include: { product: true } },
          },
          orderBy: { updatedAt: "desc" },
        })
      : [];

  const bySupplierVariantId = new Map<string, (typeof mappingsBySupplierId)[0]>();
  for (const m of mappingsBySupplierId) {
    const sid = m.supplierVariantId;
    if (sid && !bySupplierVariantId.has(sid)) bySupplierVariantId.set(sid, m);
  }

  const mappings =
    orClause.length > 0
      ? await prisma.variantMapping.findMany({
          where: {
            kickdbVariantId: { not: null },
            OR: orClause,
          },
          include: {
            kickdbVariant: { include: { product: true } },
          },
          orderBy: { updatedAt: "desc" },
        })
      : [];

  const byNormGtin = new Map<string, (typeof mappings)[0]>();
  const byProviderKey = new Map<string, (typeof mappings)[0]>();
  for (const m of mappings) {
    const n = normalizeGtinKey(m.gtin);
    if (n && !byNormGtin.has(n)) byNormGtin.set(n, m);
    const pk = String(m.providerKey ?? "").trim();
    if (pk && !byProviderKey.has(pk)) byProviderKey.set(pk, m);
  }

  for (const line of lines) {
    const lineId = String(line?.id ?? "").trim();
    if (!lineId) continue;

    let m: (typeof mappings)[0] | undefined;
    let supplierSizeRaw: string | null | undefined;

    for (const c of pickMiraklLineSkuCandidates(line)) {
      const svId = skuToSupplierVariantId.get(c);
      if (svId) {
        m = bySupplierVariantId.get(svId);
        if (m) {
          supplierSizeRaw = supplierSizeRawByVariantId.get(svId) ?? null;
          break;
        }
      }
    }

    if (!m) {
      for (const c of pickMiraklLineSkuCandidates(line)) {
        m = byProviderKey.get(c);
        if (m) break;
      }
    }
    if (!m) {
      const g = normalizeGtinKey(pickMiraklLineGtin(line) ?? line?.gtin);
      if (g) m = byNormGtin.get(g);
    }
    if (!m) continue;
    const payload = mappingToKickdb(m, supplierSizeRaw ?? null);
    if (payload) out.set(lineId, payload);
  }

  return out;
}
