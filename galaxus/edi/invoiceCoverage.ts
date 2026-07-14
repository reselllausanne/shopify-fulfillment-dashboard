import { prisma } from "@/app/lib/prisma";
import type { GalaxusOrderLine } from "@prisma/client";

export type InvoicePayloadItem = {
  orderLineId?: string | null;
  lineNumber?: number;
  quantity?: unknown;
  buyerPid?: string | null;
  supplierPid?: string | null;
  gtin?: string | null;
};

function toQty(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function extractItems(payloadJson: unknown): InvoicePayloadItem[] {
  if (!payloadJson || typeof payloadJson !== "object") return [];
  const items = (payloadJson as { items?: unknown }).items;
  return Array.isArray(items) ? (items as InvoicePayloadItem[]) : [];
}

/**
 * Map a stored payload line to a DB order line id (best-effort for legacy rows without orderLineId).
 */
export function matchPayloadItemToOrderLineId(
  item: InvoicePayloadItem,
  lines: GalaxusOrderLine[]
): string | null {
  const oid = item.orderLineId != null ? String(item.orderLineId).trim() : "";
  if (oid && lines.some((l) => l.id === oid)) {
    return oid;
  }
  const ln = item.lineNumber != null ? Number(item.lineNumber) : NaN;
  if (Number.isFinite(ln)) {
    const byNum = lines.filter((l) => l.lineNumber === ln);
    if (byNum.length === 1) return byNum[0].id;
  }
  const bp = String(item.buyerPid ?? "").trim();
  const sp = String(item.supplierPid ?? "").trim();
  const gt = String(item.gtin ?? "").trim();
  if (!bp && !sp && !gt) return null;
  const candidates = lines.filter((l) => {
    const lb = String(l.buyerPid ?? "").trim();
    const ls = String(l.supplierPid ?? "").trim();
    const lg = String(l.gtin ?? "").trim();
    if (bp && lb !== bp) return false;
    if (sp && ls !== sp) return false;
    if (gt && lg !== gt) return false;
    return true;
  });
  if (candidates.length === 1) return candidates[0].id;
  return null;
}

/**
 * Sum invoiced quantities per order line id from all successful OUT INVO files for this order.
 */
export async function getInvoicedQuantitiesByOrderLineId(
  orderId: string,
  lines: GalaxusOrderLine[]
): Promise<Map<string, number>> {
  const files = await prisma.galaxusEdiFile.findMany({
    where: {
      direction: "OUT",
      docType: "INVO",
      orderId,
      status: "uploaded",
    },
    select: { payloadJson: true },
  });
  const map = new Map<string, number>();
  for (const f of files) {
    for (const item of extractItems(f.payloadJson)) {
      const lineId = matchPayloadItemToOrderLineId(item, lines);
      if (!lineId) continue;
      map.set(lineId, (map.get(lineId) ?? 0) + toQty(item.quantity));
    }
  }
  return map;
}

function orderedQty(line: GalaxusOrderLine): number {
  const n = Number(line.quantity);
  return Number.isFinite(n) ? n : 0;
}

export type InvoiceLineProgress = {
  /** Order lines where invoiced quantity ≥ ordered quantity */
  linesFullyInvoiced: number;
  lineCount: number;
};

/**
 * Batch: how many order lines are fully covered by OUT INVO payloads (same rules as send validation).
 */
export async function getInvoiceLineProgressByOrderIds(orderIds: string[]): Promise<Map<string, InvoiceLineProgress>> {
  const result = new Map<string, InvoiceLineProgress>();
  if (orderIds.length === 0) return result;

  const lines = await prisma.galaxusOrderLine.findMany({
    where: { orderId: { in: orderIds } },
    select: {
      id: true,
      orderId: true,
      quantity: true,
      lineNumber: true,
      buyerPid: true,
      supplierPid: true,
      gtin: true,
    },
  });

  const files = await prisma.galaxusEdiFile.findMany({
    where: {
      direction: "OUT",
      docType: "INVO",
      status: "uploaded",
      orderId: { in: orderIds },
    },
    select: { orderId: true, payloadJson: true },
  });

  const linesByOrder = new Map<string, GalaxusOrderLine[]>();
  for (const line of lines) {
    const list = linesByOrder.get(line.orderId) ?? [];
    list.push(line as GalaxusOrderLine);
    linesByOrder.set(line.orderId, list);
  }

  const filesByOrder = new Map<string, typeof files>();
  for (const f of files) {
    const oid = f.orderId;
    if (!oid) continue;
    const list = filesByOrder.get(oid) ?? [];
    list.push(f);
    filesByOrder.set(oid, list);
  }

  for (const orderId of orderIds) {
    const orderLines = linesByOrder.get(orderId) ?? [];
    const orderFiles = filesByOrder.get(orderId) ?? [];
    const invoiced = new Map<string, number>();
    for (const f of orderFiles) {
      for (const item of extractItems(f.payloadJson)) {
        const lineId = matchPayloadItemToOrderLineId(item, orderLines);
        if (!lineId) continue;
        invoiced.set(lineId, (invoiced.get(lineId) ?? 0) + toQty(item.quantity));
      }
    }
    let linesFullyInvoiced = 0;
    for (const line of orderLines) {
      const ordered = orderedQty(line);
      const done = invoiced.get(line.id) ?? 0;
      if (ordered > 0 && done >= ordered) linesFullyInvoiced++;
    }
    result.set(orderId, { linesFullyInvoiced, lineCount: orderLines.length });
  }

  return result;
}

/**
 * Block invoice send if any line would exceed ordered quantity or is already fully invoiced.
 * `invoiceLines[].quantity` is the quantity to send on this invoice (may be less than the order line qty).
 */
export function assertOutgoingInvoiceAllowed(
  orderLines: GalaxusOrderLine[],
  invoiceLines: GalaxusOrderLine[],
  invoicedSoFar: Map<string, number>
): void {
  const orderLineById = new Map(orderLines.map((l) => [l.id, l]));
  const allowedIds = new Set(orderLines.map((l) => l.id));
  for (const inv of invoiceLines) {
    if (!allowedIds.has(inv.id)) {
      throw new Error(`Invoice references unknown order line id ${inv.id}.`);
    }
    const orig = orderLineById.get(inv.id)!;
    const ordered = orderedQty(orig);
    const already = invoicedSoFar.get(inv.id) ?? 0;
    const sendQty = orderedQty(inv);
    if (ordered <= 0) {
      throw new Error(`Order line ${inv.lineNumber} has no order quantity.`);
    }
    if (sendQty <= 0) {
      throw new Error(
        `Order line ${inv.lineNumber} (${inv.productName}): invoice quantity must be at least 1.`
      );
    }
    if (already >= ordered) {
      throw new Error(
        `Order line ${inv.lineNumber} (${inv.productName}): already fully invoiced (${already}/${ordered} units). Remove it from this invoice.`
      );
    }
    if (already + sendQty > ordered) {
      throw new Error(
        `Order line ${inv.lineNumber} (${inv.productName}): this invoice would exceed the order (${already} already invoiced + ${sendQty} in this run > ${ordered} ordered).`
      );
    }
  }
}

/** Apply selected line ids and optional per-line invoice quantities (defaults to not-yet-invoiced remainder). */
export function prepareOutgoingInvoiceLines(
  orderLines: GalaxusOrderLine[],
  selectedLineIds: string[] | null | undefined,
  lineQuantities: Record<string, number> | null | undefined,
  invoicedSoFar: Map<string, number>
): GalaxusOrderLine[] {
  const selected =
    selectedLineIds && selectedLineIds.length > 0
      ? orderLines.filter((l) => selectedLineIds.includes(String(l.id)))
      : [...orderLines];

  return selected.map((line) => {
    const ordered = orderedQty(line);
    const already = invoicedSoFar.get(line.id) ?? 0;
    const remaining = Math.max(0, ordered - already);
    const explicitRaw = lineQuantities?.[line.id];
    const explicit =
      explicitRaw != null && Number.isFinite(Number(explicitRaw)) ? Math.max(0, Number(explicitRaw)) : null;
    const qty = explicit ?? (remaining > 0 ? remaining : ordered);
    const unitNetPrice = Number(line.unitNetPrice);
    const lineNetAmount =
      Number.isFinite(unitNetPrice) && unitNetPrice > 0
        ? Number((unitNetPrice * qty).toFixed(2))
        : Number(line.lineNetAmount);
    return { ...line, quantity: qty, lineNetAmount } as unknown as GalaxusOrderLine;
  });
}

export function parseLineQuantitiesParam(raw: string | undefined | null): Record<string, number> | undefined {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return undefined;
  const out: Record<string, number> = {};
  for (const part of trimmed.split(",")) {
    const sep = part.indexOf(":");
    if (sep <= 0) continue;
    const id = part.slice(0, sep).trim();
    const qty = Number(part.slice(sep + 1));
    if (!id || !Number.isFinite(qty) || qty <= 0) continue;
    out[id] = qty;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function serializeLineQuantitiesParam(lineQuantities: Record<string, number> | undefined): string {
  if (!lineQuantities) return "";
  return Object.entries(lineQuantities)
    .filter(([, qty]) => Number.isFinite(qty) && qty > 0)
    .map(([id, qty]) => `${id}:${qty}`)
    .join(",");
}

export type CustomInvoiceLineLike = {
  quantity: number;
  orderLineId?: string | null;
  buyerPid?: string | null;
  supplierPid?: string | null;
  gtin?: string | null;
  description?: string;
};

/**
 * Same rules for warehouse custom INVO lines (matched to DB order lines by id or PIDs/GTIN).
 */
export function assertCustomInvoiceAllowed(
  orderLines: GalaxusOrderLine[],
  customLines: CustomInvoiceLineLike[],
  invoicedSoFar: Map<string, number>
): void {
  for (const cl of customLines) {
    const q = toQty(cl.quantity);
    if (q <= 0) {
      throw new Error(`Invalid quantity for line "${cl.description ?? "?"}" (${q}).`);
    }
    let lineId = cl.orderLineId != null ? String(cl.orderLineId).trim() : "";
    if (!lineId || !orderLines.some((l) => l.id === lineId)) {
      lineId =
        matchPayloadItemToOrderLineId(
          {
            buyerPid: cl.buyerPid,
            supplierPid: cl.supplierPid,
            gtin: cl.gtin,
          },
          orderLines
        ) ?? "";
    }
    if (!lineId) {
      throw new Error(
        `Custom line "${cl.description ?? "?"}" does not match a unique order line. Set buyer PID, supplier PID, and GTIN exactly as on the order line (or pass orderLineId).`
      );
    }
    const ol = orderLines.find((l) => l.id === lineId);
    if (!ol) {
      throw new Error(`Unknown order line for custom invoice: ${lineId}`);
    }
    const ordered = orderedQty(ol);
    const already = invoicedSoFar.get(lineId) ?? 0;
    if (already >= ordered) {
      throw new Error(
        `Order line ${ol.lineNumber} (${ol.productName}): already fully invoiced (${already}/${ordered}).`
      );
    }
    if (already + q > ordered) {
      throw new Error(
        `Order line ${ol.lineNumber} (${ol.productName}): quantity ${q} would exceed remaining ${ordered - already} not yet invoiced.`
      );
    }
  }
}
