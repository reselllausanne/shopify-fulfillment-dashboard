import { prisma } from "@/app/lib/prisma";
import { extractGtinFromOfferSku } from "@/decathlon/returns/restockFromReturnLine";
import { pickMiraklLineGtin, pickMiraklLineSkuCandidates } from "@/decathlon/mirakl/orderLineFields";
import { normalizeGtinKey } from "@/galaxus/stx/purchaseUnits";

export type DecathlonLineSaleSnapshot = {
  providerKey: string | null;
  gtin: string | null;
  supplierVariantId: string | null;
  sizeRaw: string | null;
};

function pickProviderKeyFromLine(line: any): string | null {
  for (const c of pickMiraklLineSkuCandidates(line)) {
    const upper = String(c ?? "").trim().toUpperCase();
    if (upper.startsWith("STX_") || upper.startsWith("NER_") || upper.startsWith("GLD_")) {
      return upper;
    }
  }
  return null;
}

/** GTIN from Mirakl payload, line column, or STX_* offer sku. */
export function resolveDecathlonLineGtin(line: any): string | null {
  const fromMirakl = pickMiraklLineGtin(line) ?? pickMiraklLineGtin(line?.rawJson);
  if (fromMirakl) return fromMirakl;
  const fromDb = String(line?.gtin ?? "").trim();
  if (fromDb) return fromDb;
  for (const c of pickMiraklLineSkuCandidates(line)) {
    const g = extractGtinFromOfferSku(c);
    if (g) return g;
  }
  for (const c of pickMiraklLineSkuCandidates(line?.rawJson)) {
    const g = extractGtinFromOfferSku(c);
    if (g) return g;
  }
  return null;
}

/** Sale-time identity from OrderLineSyncState + optional live size on SupplierVariant. */
export async function loadDecathlonLineSaleSnapshots(
  lines: any[]
): Promise<Map<string, DecathlonLineSaleSnapshot>> {
  const out = new Map<string, DecathlonLineSaleSnapshot>();
  if (!Array.isArray(lines) || lines.length === 0) return out;

  const externalLineIds = lines
    .map((line) => String(line?.orderLineId ?? "").trim())
    .filter(Boolean);

  const syncRows =
    externalLineIds.length > 0
      ? await (prisma as any).orderLineSyncState.findMany({
          where: { channel: "DECATHLON", externalLineId: { in: externalLineIds } },
          select: {
            externalLineId: true,
            providerKey: true,
            supplierVariantId: true,
          },
        })
      : [];

  const syncByExternalLineId = new Map<string, (typeof syncRows)[0]>();
  for (const row of syncRows) {
    const id = String(row?.externalLineId ?? "").trim();
    if (id && !syncByExternalLineId.has(id)) syncByExternalLineId.set(id, row);
  }

  const providerKeys = new Set<string>();
  for (const line of lines) {
    const pk = pickProviderKeyFromLine(line) ?? pickProviderKeyFromLine(line?.rawJson);
    if (pk) providerKeys.add(pk);
    const sync = syncByExternalLineId.get(String(line?.orderLineId ?? "").trim());
    if (sync?.providerKey) providerKeys.add(String(sync.providerKey).trim().toUpperCase());
  }

  const channelRows =
    providerKeys.size > 0
      ? await (prisma as any).channelListingState.findMany({
          where: {
            channel: "DECATHLON",
            providerKey: { in: Array.from(providerKeys) },
          },
          select: {
            providerKey: true,
            gtin: true,
            supplierVariantId: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

  const channelByProviderKey = new Map<string, (typeof channelRows)[0]>();
  for (const row of channelRows) {
    const pk = String(row?.providerKey ?? "").trim().toUpperCase();
    if (pk && !channelByProviderKey.has(pk)) channelByProviderKey.set(pk, row);
  }

  const supplierIds = new Set<string>();
  for (const line of lines) {
    const sync = syncByExternalLineId.get(String(line?.orderLineId ?? "").trim());
    if (sync?.supplierVariantId) supplierIds.add(String(sync.supplierVariantId));
    const pk =
      pickProviderKeyFromLine(line) ??
      (String(sync?.providerKey ?? "").trim().toUpperCase() || null);
    const ch = pk ? channelByProviderKey.get(pk) : null;
    if (ch?.supplierVariantId) supplierIds.add(String(ch.supplierVariantId));
  }

  const supplierRows =
    supplierIds.size > 0
      ? await prisma.supplierVariant.findMany({
          where: { supplierVariantId: { in: Array.from(supplierIds) } },
          select: { supplierVariantId: true, sizeRaw: true, gtin: true, providerKey: true },
        })
      : [];
  const supplierById = new Map(supplierRows.map((r) => [r.supplierVariantId, r]));

  for (const line of lines) {
    const lineId = String(line?.id ?? "").trim();
    if (!lineId) continue;

    const externalLineId = String(line?.orderLineId ?? "").trim();
    const sync = externalLineId ? syncByExternalLineId.get(externalLineId) : undefined;
    const offerPk = pickProviderKeyFromLine(line) ?? pickProviderKeyFromLine(line?.rawJson);
    const providerKey =
      String(sync?.providerKey ?? offerPk ?? "").trim().toUpperCase() || null;
    const channel = providerKey ? channelByProviderKey.get(providerKey) : null;

    const gtinRaw =
      resolveDecathlonLineGtin(line) ??
      (String(channel?.gtin ?? "").trim() || extractGtinFromOfferSku(providerKey) || null);
    const gtin = gtinRaw ? normalizeGtinKey(gtinRaw) || gtinRaw : null;

    const supplierVariantId =
      String(sync?.supplierVariantId ?? channel?.supplierVariantId ?? "").trim() || null;
    const supplier = supplierVariantId ? supplierById.get(supplierVariantId) : null;

    out.set(lineId, {
      providerKey,
      gtin,
      supplierVariantId,
      sizeRaw: supplier?.sizeRaw ?? line?.size ?? null,
    });
  }

  return out;
}

/** Merge sale snapshot onto lines for UI + StockX target resolution. */
export function applyDecathlonLineSaleSnapshots(
  lines: any[],
  snapshots: Map<string, DecathlonLineSaleSnapshot>
): any[] {
  return lines.map((line) => {
    const snap = snapshots.get(String(line?.id ?? "").trim());
    if (!snap) return line;
    return {
      ...line,
      gtin: line?.gtin ?? snap.gtin,
      providerKey: line?.providerKey ?? snap.providerKey,
      size: line?.size ?? snap.sizeRaw,
      saleSnapshot: snap,
    };
  });
}
