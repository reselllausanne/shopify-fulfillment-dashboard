import { prisma } from "@/app/lib/prisma";
import { normalizeGtinKey } from "@/galaxus/stx/purchaseUnits";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { pickMiraklLineGtin } from "@/decathlon/mirakl/orderLineFields";

export type DecathlonLineStockHint = {
  partnerKey: string;
  supplierVariantId: string;
  stock: number;
};

function extractPartnerKey(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const token = raw.split(/[:_]/)[0] ?? "";
  return normalizeProviderKey(token);
}

function resolvePartnerKeyFromVariant(
  variant: { supplierVariantId: string; providerKey?: string | null; supplierSku?: string | null },
  allowedKeys: Set<string>
): string | null {
  const candidates = [variant.providerKey, variant.supplierSku, variant.supplierVariantId];
  for (const candidate of candidates) {
    const pk = extractPartnerKey(candidate);
    if (pk && allowedKeys.has(pk)) return pk;
  }
  return null;
}

function resolveEffectiveStock(row: {
  stock?: number | null;
  manualLock?: boolean | null;
  manualStock?: number | null;
}): number {
  if (row.manualLock && row.manualStock != null) {
    return Math.max(0, Math.round(Number(row.manualStock)));
  }
  const stock = Number(row.stock ?? 0);
  return Number.isFinite(stock) ? Math.max(0, Math.round(stock)) : 0;
}

export async function buildDecathlonLineStockHints(
  lines: any[],
  partnerKeys: string[]
): Promise<Map<string, DecathlonLineStockHint[]>> {
  const out = new Map<string, DecathlonLineStockHint[]>();
  if (!Array.isArray(lines) || lines.length === 0) return out;

  const gtins = new Set<string>();
  for (const line of lines) {
    const g = normalizeGtinKey(pickMiraklLineGtin(line) ?? line?.gtin);
    if (g) gtins.add(g);
  }
  const gtinList = Array.from(gtins);
  if (gtinList.length === 0) return out;

  const allowedKeys = new Set(
    partnerKeys
      .map((k) => normalizeProviderKey(k))
      .filter((k): k is string => Boolean(k))
  );
  allowedKeys.add("THE");

  const rows = await prisma.supplierVariant.findMany({
    where: { gtin: { in: gtinList } },
    select: {
      supplierVariantId: true,
      providerKey: true,
      supplierSku: true,
      gtin: true,
      stock: true,
      manualLock: true,
      manualStock: true,
    },
  });

  const byGtin = new Map<string, DecathlonLineStockHint[]>();
  for (const row of rows) {
    const pk = resolvePartnerKeyFromVariant(row, allowedKeys);
    if (!pk) continue;
    const stock = resolveEffectiveStock(row);
    if (stock <= 0) continue;
    const g = normalizeGtinKey(row.gtin);
    if (!g) continue;
    const list = byGtin.get(g) ?? [];
    list.push({
      partnerKey: pk,
      supplierVariantId: row.supplierVariantId,
      stock,
    });
    byGtin.set(g, list);
  }

  for (const line of lines) {
    const lineId = String(line?.id ?? "").trim();
    if (!lineId) continue;
    const g = normalizeGtinKey(pickMiraklLineGtin(line) ?? line?.gtin);
    if (!g) continue;
    const hints = byGtin.get(g) ?? [];
    if (hints.length === 0) continue;
    hints.sort((a, b) => {
      if (a.partnerKey === "THE" && b.partnerKey !== "THE") return -1;
      if (b.partnerKey === "THE" && a.partnerKey !== "THE") return 1;
      return b.stock - a.stock;
    });
    out.set(lineId, hints);
  }

  return out;
}
