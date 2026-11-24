import { prisma } from "@/app/lib/prisma";
import { normalizeGtinKey } from "@/galaxus/stx/purchaseUnits";

/** One physical scan of one unit. `unitIndex` is unique per line. */
export type UnitScanInput = {
  sourceOrderId: string;
  lineId: string;
  unitIndex: number;
  /** Scanned GTIN. Empty only allowed for source "packing_session" (AWB/pid resolved scan). */
  gtin?: string | null;
  source?: string | null;
};

export type ValidatedUnitScan = {
  orderId: string;
  galaxusOrderLineId: string;
  unitIndex: number;
  gtin: string;
  source: string;
};

export const SCAN_SOURCE_PACKING_SESSION = "packing_session";
export const SCAN_SOURCE_WAREHOUSE_PAGE = "warehouse_page";

export function parseUnitScans(raw: unknown): UnitScanInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r: any) => ({
      sourceOrderId: String(r?.sourceOrderId ?? "").trim(),
      lineId: String(r?.lineId ?? "").trim(),
      unitIndex: Number(r?.unitIndex),
      gtin: r?.gtin ? String(r.gtin).trim() : null,
      source: r?.source ? String(r.source).trim() : null,
    }))
    .filter(
      (r) => r.sourceOrderId && r.lineId && Number.isInteger(r.unitIndex) && r.unitIndex >= 0
    );
}

/**
 * Pure: every packed line needs >= quantity distinct unit scans whose GTIN matches the line.
 * Returns error message or validated rows to persist (exactly `quantity` per line).
 */
export function validateUnitScansForLines(
  lines: Array<{ lineId: string; sourceOrderId: string; quantity: number; gtin: string | null | undefined }>,
  scans: UnitScanInput[]
): { ok: true; rows: ValidatedUnitScan[] } | { ok: false; message: string } {
  const rows: ValidatedUnitScan[] = [];
  for (const line of lines) {
    const lineKey = normalizeGtinKey(line.gtin);
    const seen = new Set<number>();
    const picked: ValidatedUnitScan[] = [];
    for (const s of scans) {
      if (s.lineId !== line.lineId || s.sourceOrderId !== line.sourceOrderId) continue;
      if (seen.has(s.unitIndex)) continue;
      const source = s.source || SCAN_SOURCE_WAREHOUSE_PAGE;
      const scanKey = normalizeGtinKey(s.gtin);
      if (scanKey) {
        if (lineKey && scanKey !== lineKey) continue;
      } else if (source !== SCAN_SOURCE_PACKING_SESSION) {
        continue;
      }
      seen.add(s.unitIndex);
      picked.push({
        orderId: line.sourceOrderId,
        galaxusOrderLineId: line.lineId,
        unitIndex: s.unitIndex,
        gtin: scanKey || lineKey || "",
        source,
      });
    }
    if (picked.length < line.quantity) {
      return {
        ok: false,
        message: `Scan required for every unit: line ${line.lineId} has ${picked.length}/${line.quantity} scanned units`,
      };
    }
    rows.push(...picked.slice(0, line.quantity));
  }
  return { ok: true, rows };
}

/** Pure: stored scans must cover each shipment item quantity (matching order + gtin). */
export function findUnitScanShortfall(
  items: Array<{ orderId: string | null; gtin14: string; quantity: number }>,
  scans: Array<{ orderId: string; gtin: string; galaxusOrderLineId: string; unitIndex: number }>
): string | null {
  for (const item of items) {
    const itemKey = normalizeGtinKey(item.gtin14);
    const have = new Set(
      scans
        .filter(
          (s) =>
            s.orderId === String(item.orderId ?? "") &&
            (!itemKey || normalizeGtinKey(s.gtin) === itemKey)
        )
        .map((s) => `${s.galaxusOrderLineId}|${s.unitIndex}`)
    ).size;
    if (have < item.quantity) {
      return `Unit scans incomplete for GTIN ${item.gtin14}: ${have}/${item.quantity} scanned`;
    }
  }
  return null;
}

/**
 * Throws-free guard. Shipments without requiresUnitScans (legacy) pass.
 * Returns error message when scans < item quantity, else null.
 */
export async function getUnitScanGuardError(shipmentId: string): Promise<string | null> {
  const shipment = await (prisma as any).shipment.findUnique({
    where: { id: shipmentId },
    select: {
      requiresUnitScans: true,
      items: { select: { orderId: true, gtin14: true, quantity: true } },
      unitScans: {
        select: { orderId: true, gtin: true, galaxusOrderLineId: true, unitIndex: true },
      },
    },
  });
  if (!shipment || !shipment.requiresUnitScans) return null;
  return findUnitScanShortfall(shipment.items ?? [], shipment.unitScans ?? []);
}
