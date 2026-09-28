type ShipmentLike = {
  status?: string | null;
  delrSentAt?: Date | string | null;
  delrStatus?: string | null;
  items?: Array<{ supplierPid?: string | null; gtin14?: string | null; quantity?: number | null }>;
};

type LineLike = {
  id: string;
  supplierPid?: string | null;
  gtin?: string | null;
  quantity?: number | null;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function isFinalizedPartnerShipment(shipment: ShipmentLike): boolean {
  const delrStatus = clean(shipment.delrStatus).toUpperCase();
  return Boolean(shipment.delrSentAt) || delrStatus === "UPLOADED" || delrStatus === "SENT";
}

/** Same accounting as createManualShipmentsForOrder: finalized + open MANUAL drafts consume line qty. */
function consumesLineQty(shipment: ShipmentLike): boolean {
  if (isFinalizedPartnerShipment(shipment)) return true;
  return clean(shipment.status).toUpperCase() === "MANUAL";
}

export function remainingPartnerLineSelection(
  partnerLines: LineLike[],
  shipments: ShipmentLike[]
): Array<{ lineId: string; quantity: number }> {
  const used = new Map<string, number>();
  for (const shipment of shipments) {
    if (!consumesLineQty(shipment)) continue;
    for (const item of shipment.items ?? []) {
      const key = `${clean(item.supplierPid)}|${clean(item.gtin14)}`;
      used.set(key, (used.get(key) ?? 0) + Math.max(0, Number(item.quantity ?? 0)));
    }
  }
  const out: Array<{ lineId: string; quantity: number }> = [];
  for (const line of partnerLines) {
    const key = `${clean(line.supplierPid)}|${clean(line.gtin)}`;
    const available = used.get(key) ?? 0;
    const lineQty = Math.max(0, Number(line.quantity ?? 0));
    const take = Math.min(available, lineQty);
    if (take > 0) used.set(key, available - take);
    const remaining = lineQty - take;
    if (remaining > 0) out.push({ lineId: line.id, quantity: remaining });
  }
  return out;
}

/** Partner-facing view: only the partner's own shipments count toward "fulfilled" / "shipped". */
export function filterPartnerShipments<T extends { providerKey?: string | null }>(
  shipments: T[],
  providerKeyUpper: string
): T[] {
  const pk = providerKeyUpper.toUpperCase();
  return shipments.filter((shipment) => clean(shipment.providerKey).toUpperCase() === pk);
}
