import type { ReturnAuditEntry } from "./config";

export function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function extractReturnsList(payload: any): any[] {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.returns)) return payload.returns;
  if (Array.isArray(payload?.return_list)) return payload.return_list;
  if (Array.isArray(payload)) return payload;
  return [];
}

export function extractReturnLines(ret: any): any[] {
  const lines = ret?.return_lines ?? ret?.returnLines ?? ret?.lines;
  return Array.isArray(lines) ? lines : [];
}

export function normalizeMiraklReturnStatus(ret: any): string {
  return String(
    ret?.status ?? ret?.return_status ?? ret?.returnStatus ?? ret?.state ?? ret?.return_state ?? ""
  )
    .trim()
    .toUpperCase();
}

export function pickReturnLabelNumber(ret: any): string | null {
  return pickString(
    ret?.tracking?.tracking_number,
    ret?.tracking?.trackingNumber,
    ret?.label_number,
    ret?.labelNumber,
    ret?.rma,
    ret?.rma_id,
    ret?.rmaId,
    ret?.channel_return_id,
    ret?.channelReturnId
  );
}

/** Digits-only compare for scanner input vs stored Swiss Post labels. */
export function normalizeReturnLabelDigits(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

export function formatSwissPostLabel(digits: string): string | null {
  const d = digits.replace(/\D/g, "");
  if (d.length === 18 && d.startsWith("99")) {
    return `${d.slice(0, 2)}.${d.slice(2, 4)}.${d.slice(4, 10)}.${d.slice(10, 18)}`;
  }
  return null;
}

export function pickReturnLabelUrl(ret: any): string | null {
  return pickString(ret?.label_url, ret?.labelUrl);
}

export function pickReturnReason(ret: any, line?: any): { code: string | null; label: string | null } {
  const code = pickString(
    line?.reason_code,
    line?.reasonCode,
    line?.reason,
    ret?.reason_code,
    ret?.reasonCode,
    ret?.reason
  );
  const label = pickString(line?.reason_label, line?.reasonLabel, ret?.reason_label, ret?.reasonLabel, code);
  return { code, label };
}

/**
 * Resolve refundable line amount from Mirakl order line payload (never invent).
 * Prefer total_price / price × returned qty when unit price is known.
 */
export function resolveReturnAmountFromOrderLine(options: {
  orderLine: any | null;
  returnedQuantity: number;
}): number | null {
  const { orderLine, returnedQuantity } = options;
  if (!orderLine) return null;
  const qty =
    Number.isFinite(returnedQuantity) && returnedQuantity > 0 ? Math.floor(returnedQuantity) : 1;

  const explicitLineTotal =
    toFiniteNumber(orderLine.total_price) ??
    toFiniteNumber(orderLine.totalPrice) ??
    toFiniteNumber(orderLine.price) ??
    toFiniteNumber(orderLine.line_total) ??
    toFiniteNumber(orderLine.lineTotal);

  const orderQty =
    toFiniteNumber(orderLine.quantity) ?? toFiniteNumber(orderLine.qty) ?? null;

  if (explicitLineTotal != null && orderQty != null && orderQty > 0 && qty < orderQty) {
    return Number(((explicitLineTotal / orderQty) * qty).toFixed(2));
  }
  if (explicitLineTotal != null && (orderQty == null || orderQty === qty)) {
    return Number(explicitLineTotal.toFixed(2));
  }

  const unit =
    toFiniteNumber(orderLine.unit_price) ??
    toFiniteNumber(orderLine.unitPrice) ??
    toFiniteNumber(orderLine.price_unit) ??
    null;
  if (unit != null) {
    return Number((unit * qty).toFixed(2));
  }

  return explicitLineTotal != null ? Number(explicitLineTotal.toFixed(2)) : null;
}

export function findOrderLineInOrder(order: any, orderLineId: string | null): any | null {
  if (!order || !orderLineId) return null;
  const lines = Array.isArray(order?.order_lines)
    ? order.order_lines
    : Array.isArray(order?.lines)
      ? order.lines
      : [];
  for (const line of lines) {
    const id = pickString(line?.id, line?.order_line_id, line?.orderLineId);
    if (id === orderLineId) return line;
  }
  return null;
}

export function appendAuditLog(
  existing: unknown,
  entry: ReturnAuditEntry
): ReturnAuditEntry[] {
  const prev = Array.isArray(existing) ? (existing as ReturnAuditEntry[]) : [];
  return [...prev, entry].slice(-50);
}

export function mapConnectStatusToLocalPending(miraklStatus: string): boolean {
  const s = miraklStatus.toUpperCase();
  return s === "OPENED" || s === "RECEIVED" || s === "IN_PROGRESS" || s === "WAITING_ACCEPTANCE";
}
