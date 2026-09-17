/**
 * Rules for Shopify (and similar) scan fulfill: when a popup is required,
 * and how many units may ship from one AWB scan.
 */

export type FulfillOpenUnit = {
  lineItemId: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  remainingQuantity: number;
  /** True when this is the AWB-matched / scanned line. */
  isScannedLine?: boolean;
};

export type UnitSelectionDecision = {
  /** Single line, qty 1 → ship immediately, no popup. */
  requiresPopup: boolean;
  /** Total open units across the order (scanned + siblings). */
  totalOpenUnits: number;
  /** Open product lines (distinct lineItemIds with remaining > 0). */
  openLineCount: number;
  reason: "single_unit" | "multi_line" | "multi_qty" | "none_open";
};

/**
 * Popup required when more than one open unit exists on the order
 * (multiple lines OR quantity > 1 on the scanned line).
 */
export function decideFulfillUnitSelection(
  openUnits: FulfillOpenUnit[]
): UnitSelectionDecision {
  const open = openUnits.filter((u) => u.remainingQuantity > 0);
  const totalOpenUnits = open.reduce((n, u) => n + u.remainingQuantity, 0);
  const openLineCount = open.length;

  if (totalOpenUnits <= 0) {
    return {
      requiresPopup: false,
      totalOpenUnits: 0,
      openLineCount: 0,
      reason: "none_open",
    };
  }

  if (openLineCount === 1 && totalOpenUnits === 1) {
    return {
      requiresPopup: false,
      totalOpenUnits: 1,
      openLineCount: 1,
      reason: "single_unit",
    };
  }

  if (openLineCount > 1) {
    return {
      requiresPopup: true,
      totalOpenUnits,
      openLineCount,
      reason: "multi_line",
    };
  }

  return {
    requiresPopup: true,
    totalOpenUnits,
    openLineCount,
    reason: "multi_qty",
  };
}

export type SelectedFulfillUnit = {
  lineItemId: string;
  quantity: number;
};

/**
 * Validate operator selection against remaining open units.
 * Rejects empty, over-qty, unknown lines.
 */
export function validateFulfillUnitSelection(
  openUnits: FulfillOpenUnit[],
  selected: SelectedFulfillUnit[]
): { ok: true; selected: SelectedFulfillUnit[] } | { ok: false; error: string } {
  const remaining = new Map(
    openUnits.map((u) => [u.lineItemId, Math.max(0, u.remainingQuantity)])
  );
  const normalized: SelectedFulfillUnit[] = [];

  for (const row of selected ?? []) {
    const lineItemId = String(row.lineItemId ?? "").trim();
    const quantity = Math.floor(Number(row.quantity));
    if (!lineItemId) return { ok: false, error: "Missing lineItemId" };
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: `Invalid quantity for ${lineItemId}` };
    }
    const left = remaining.get(lineItemId);
    if (left == null) return { ok: false, error: `Unknown line ${lineItemId}` };
    if (quantity > left) {
      return {
        ok: false,
        error: `Quantity ${quantity} exceeds remaining ${left} for ${lineItemId}`,
      };
    }
    remaining.set(lineItemId, left - quantity);
    normalized.push({ lineItemId, quantity });
  }

  if (normalized.length === 0) {
    return { ok: false, error: "Select at least one unit" };
  }

  return { ok: true, selected: normalized };
}

/** Idempotency key for one physical parcel scan → one fulfill attempt. */
export function fulfillScanIdempotencyKey(params: {
  awb: string;
  shopifyOrderId: string;
  lineItemId: string;
  quantity: number;
}): string {
  return [
    "fulfill",
    String(params.awb).trim().toUpperCase(),
    String(params.shopifyOrderId).trim(),
    String(params.lineItemId).trim(),
    String(Math.max(1, Math.floor(params.quantity))),
  ].join(":");
}
