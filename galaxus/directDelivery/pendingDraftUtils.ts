export type PendingManualDraft = {
  shipmentDbId: string;
  quantity: number;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

/** Local draft parcel not yet accepted by Galaxus (safe to drop on repack). */
export function isUnfinalizedDraftShipment(shipment: {
  delrSentAt?: Date | null;
  delrStatus?: string | null;
  status?: string | null;
}): boolean {
  if (shipment?.delrSentAt) return false;
  const delrStatus = normalizeText(shipment?.delrStatus).toUpperCase();
  if (delrStatus === "UPLOADED" || delrStatus === "SENT") return false;
  return true;
}

/** MANUAL parcel with no Post tracking — safe to drop on repack retry (label never applied). */
export function isStaleManualDraftShipment(shipment: {
  delrSentAt?: Date | null;
  delrStatus?: string | null;
  status?: string | null;
  trackingNumber?: string | null;
}): boolean {
  if (!isUnfinalizedDraftShipment(shipment)) return false;
  if (normalizeText(shipment?.status).toUpperCase() !== "MANUAL") return false;
  if (normalizeText(shipment?.trackingNumber)) return false;
  return true;
}

function digitsOnlyGtin(s: string): string {
  return String(s ?? "").replace(/\D/g, "");
}

function sameGtinKey(a: string, b: string): boolean {
  const da = digitsOnlyGtin(a);
  const db = digitsOnlyGtin(b);
  if (!da || !db) return false;
  if (da === db) return true;
  const na = da.padStart(14, "0").slice(-14);
  const nb = db.padStart(14, "0").slice(-14);
  return na === nb;
}

function lineMatchesShipmentItem(
  orderId: string,
  line: { id?: string; buyerPid?: string | null; supplierPid?: string | null; gtin?: string | null },
  item: {
    orderId?: unknown;
    buyerPid?: unknown;
    supplierPid?: unknown;
    gtin14?: unknown;
  }
): boolean {
  if (String(item?.orderId ?? "") !== String(orderId)) return false;
  const buyerPid = normalizeText(line.buyerPid);
  const supplierPid = normalizeText(line.supplierPid);
  const supplierPidKey = supplierPid.toLowerCase();
  const gtin = normalizeText(line.gtin);
  const itemBuyerPid = normalizeText(item?.buyerPid);
  if (buyerPid && itemBuyerPid) {
    return itemBuyerPid === buyerPid;
  }
  const itemSupplierPid = normalizeText(item?.supplierPid);
  const itemSupplierPidKey = itemSupplierPid.toLowerCase();
  const itemGtin = normalizeText(item?.gtin14);
  const canComparePid = Boolean(supplierPid && itemSupplierPid);
  const canCompareGtin = Boolean(gtin && itemGtin);
  if (canComparePid && canCompareGtin) {
    return supplierPidKey === itemSupplierPidKey && sameGtinKey(itemGtin, gtin);
  }
  if (canComparePid) return supplierPidKey === itemSupplierPidKey;
  if (canCompareGtin) return sameGtinKey(itemGtin, gtin);
  return false;
}

/** First unlabeled MANUAL draft for a direct line (pack created, label pending). */
export function findPendingManualDraftForLine(
  orderId: string,
  line: { id?: string; buyerPid?: string | null; supplierPid?: string | null; gtin?: string | null },
  existingItems: Array<{
    orderId?: unknown;
    shipmentId?: unknown;
    buyerPid?: unknown;
    supplierPid?: unknown;
    gtin14?: unknown;
    quantity?: unknown;
    shipment?: {
      delrSentAt?: Date | null;
      delrStatus?: string | null;
      status?: string | null;
      trackingNumber?: string | null;
    } | null;
  }>
): PendingManualDraft | null {
  const qtyByShipment = new Map<string, number>();
  for (const item of existingItems) {
    if (!lineMatchesShipmentItem(orderId, line, item)) continue;
    if (!isStaleManualDraftShipment(item?.shipment ?? {})) continue;
    const shipmentDbId = normalizeText(item?.shipmentId);
    if (!shipmentDbId) continue;
    const qty = Math.max(0, Number(item?.quantity ?? 0));
    qtyByShipment.set(shipmentDbId, (qtyByShipment.get(shipmentDbId) ?? 0) + qty);
  }
  for (const [shipmentDbId, quantity] of qtyByShipment) {
    if (quantity > 0) return { shipmentDbId, quantity };
  }
  return null;
}

/** Pick first stale MANUAL draft on an order (single-line REI partial ship). */
export function findFirstPendingManualDraftFromShipments(
  shipments: Array<{
    id?: string;
    status?: string | null;
    delrStatus?: string | null;
    delrSentAt?: Date | null;
    trackingNumber?: string | null;
  }>
): { shipmentDbId: string } | null {
  for (const shipment of shipments) {
    if (!isStaleManualDraftShipment(shipment)) continue;
    const shipmentDbId = normalizeText(shipment?.id);
    if (shipmentDbId) return { shipmentDbId };
  }
  return null;
}
