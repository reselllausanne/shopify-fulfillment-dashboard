/**
 * Galaxus shipment “shipped” semantics for list UI, archive gate, and ops totals.
 *
 * A tracking number alone often exists before the parcel is actually dispatched
 * (e.g. StockX / label purchase). Treating that as “fully shipped” was misleading.
 */

function hasTruthyDate(d: unknown): boolean {
  if (d == null) return false;
  const t = d instanceof Date ? d.getTime() : new Date(String(d)).getTime();
  return !Number.isNaN(t);
}

export type GalaxusShipmentDispatchFields = {
  status?: string | null;
  shippedAt?: Date | string | null;
  galaxusShippedAt?: Date | string | null;
  trackingNumber?: string | null;
  delrSentAt?: Date | string | null;
  delrStatus?: string | null;
};

/**
 * Parcel considered dispatched / confirmed (manual mark, shippedAt, or Galaxus confirmation).
 * Does NOT count tracking-only rows.
 */
export function isGalaxusShipmentDispatchConfirmed(
  shipment: GalaxusShipmentDispatchFields | null | undefined
): boolean {
  if (!shipment) return false;
  const status = String(shipment.status ?? "").toUpperCase();
  const delrStatus = String(shipment.delrStatus ?? "").toUpperCase();
  if (delrStatus === "SENT" || delrStatus === "UPLOADED") return true;
  if (hasTruthyDate(shipment.delrSentAt)) return true;
  if (hasTruthyDate(shipment.galaxusShippedAt)) return true;
  return status === "FULFILLED";
}

/** Non-empty tracking string — informational (label / carrier ref), not “shipped”. */
export function galaxusShipmentHasTrackingSignal(
  shipment: GalaxusShipmentDispatchFields | null | undefined
): boolean {
  if (!shipment) return false;
  return String(shipment.trackingNumber ?? "").trim().length > 0;
}
