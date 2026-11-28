/**
 * A shipment that physically went out with the WRONG item (Galaxus "wrong delivery" ticket).
 * Row is kept for audit, but must never count as shipped / reusable draft / purgeable draft.
 */
export const SUPERSEDED_WRONG_ITEM_STATUS = "SUPERSEDED_WRONG_ITEM";
export const SHIPMENT_SUPERSEDED_EVENT = "SHIPMENT_SUPERSEDED_WRONG_ITEM";
/** OrderStatusEvent.type: block any new (line-based) INVO for this order. */
export const INVOICE_BLOCKED_EVENT = "INVOICE_BLOCKED";

export function isSupersededShipment(s: { status?: string | null } | null | undefined): boolean {
  return String(s?.status ?? "").toUpperCase() === SUPERSEDED_WRONG_ITEM_STATUS;
}

export function excludeSuperseded<T extends { status?: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => !isSupersededShipment(r));
}

type ShipmentSnapshot = {
  id: string;
  status: string | null;
  trackingNumber: string | null;
  delrStatus: string | null;
  delrSentAt: Date | null;
  delrFileName: string | null;
  galaxusShippedAt: Date | null;
  manualNote: string | null;
};

/** Pure: DB update for a superseded shipment + the audit snapshot to restore it. */
export function buildSupersedeUpdate(
  s: ShipmentSnapshot,
  info: { reason: string; ticket?: string | null; now?: Date }
) {
  const now = info.now ?? new Date();
  const snapshot = {
    status: s.status,
    trackingNumber: s.trackingNumber,
    delrStatus: s.delrStatus,
    delrSentAt: s.delrSentAt?.toISOString() ?? null,
    delrFileName: s.delrFileName,
    galaxusShippedAt: s.galaxusShippedAt?.toISOString() ?? null,
    manualNote: s.manualNote,
  };
  const note =
    `[${now.toISOString()}] SUPERSEDED_WRONG_ITEM${info.ticket ? ` (Galaxus ticket ${info.ticket})` : ""}: ${info.reason}. ` +
    `Old tracking ${s.trackingNumber ?? "-"}, DELR ${s.delrFileName ?? "-"} sent ${s.delrSentAt?.toISOString() ?? "-"}.` +
    (s.manualNote ? ` Prev note: ${s.manualNote}` : "");
  return {
    snapshot,
    data: {
      status: SUPERSEDED_WRONG_ITEM_STATUS,
      // enum has no VOID (no migration): PENDING + status SUPERSEDED + no tracking = inert
      delrStatus: "PENDING" as const,
      delrSentAt: null,
      galaxusShippedAt: null,
      trackingNumber: null,
      manualNote: note,
    },
  };
}
