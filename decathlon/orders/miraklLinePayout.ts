/**
 * Seller payout on a Mirakl order line from OR11-style payloads (same fields as Decathlon back-office).
 * Uses Mirakl’s own totals: line total_price minus line total_commission (commission + commission VAT).
 * @see Mirakl OR11 — orders.order_lines.total_price, total_commission
 */

function pickFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function miraklLineRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

/**
 * Full-line seller net amount from Mirakl (all units on the line), or null if the payload has no totals.
 */
export function decathlonMiraklSellerPayoutLineTotal(raw: unknown): number | null {
  const o = miraklLineRecord(raw);
  if (!o) return null;
  const totalPrice = pickFiniteNumber(o.total_price ?? o.totalPrice);
  const totalCommission = pickFiniteNumber(o.total_commission ?? o.totalCommission);
  if (totalPrice != null && totalCommission != null) {
    return totalPrice - totalCommission;
  }
  const price = pickFiniteNumber(o.price);
  const commissionFee = pickFiniteNumber(o.commission_fee ?? o.commissionFee);
  if (price != null && commissionFee != null) {
    let commissionTaxSum = 0;
    const taxes = o.commission_taxes ?? o.commissionTaxes;
    if (Array.isArray(taxes)) {
      for (const t of taxes) {
        if (t && typeof t === "object") {
          const a = pickFiniteNumber((t as Record<string, unknown>).amount);
          if (a != null) commissionTaxSum += a;
        }
      }
    } else {
      const legacyVat = pickFiniteNumber(o.commission_vat ?? o.commissionVat);
      if (legacyVat != null) commissionTaxSum = legacyVat;
    }
    return price - commissionFee - commissionTaxSum;
  }
  return null;
}

/** Prorate Mirakl line payout to shipped units (Mirakl amounts are for the full line quantity). */
export function decathlonMiraklSellerPayoutForShippedQty(
  raw: unknown,
  lineQuantity: number,
  shippedQuantity: number
): number | null {
  const full = decathlonMiraklSellerPayoutLineTotal(raw);
  if (full == null) return null;
  const q = Number(lineQuantity);
  const sq = Number(shippedQuantity);
  if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(sq) || sq <= 0) return null;
  return full * (sq / q);
}
