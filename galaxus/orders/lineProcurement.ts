import {
  galaxusLineWarehouseStockHint,
  isGalaxusStxSupplierLine,
} from "@/galaxus/warehouse/lineInventorySource";
import { sameGtinKey } from "@/galaxus/orders/gtinKey";
import { expandGtinsForDbLookup } from "@/galaxus/stx/purchaseUnits";

function unitMatchesLine(line: any, unit: any): boolean {
  if (!unit?.stockxOrderId || unit?.cancelledAt) return false;
  const gtinKeys = expandGtinsForDbLookup([String(line?.gtin ?? "")]);
  const unitGtin = String(unit?.gtin ?? "").trim();
  if (gtinKeys.length > 0 && unitGtin && gtinKeys.some((g) => sameGtinKey(g, unitGtin))) return true;
  const lineSv = String(line?.supplierVariantId ?? "").trim();
  const unitSv = String(unit?.supplierVariantId ?? "").trim();
  return Boolean(lineSv && unitSv && lineSv === unitSv);
}

export function pickStxPurchaseUnitForLine(line: any, stxUnits: any[]) {
  const gtin = String(line?.gtin ?? "").trim();
  const sv = String(line?.supplierVariantId ?? "").trim();
  if (!gtin) return null;
  const byGtinSv = stxUnits.find(
    (u: any) =>
      unitMatchesLine(line, u) &&
      String(u?.supplierVariantId ?? "").trim() === sv &&
      u?.stockxOrderId
  );
  if (byGtinSv) return byGtinSv;
  return stxUnits.find((u: any) => unitMatchesLine(line, u) && u?.stockxOrderId) ?? null;
}

/** Per-line procurement: DB match rows (one per unit) and/or STX purchase units (sync + AWB). */
export function attachProcurementToLines(lines: any[], stx: any, stockxMatches: any[], stxUnits: any[]) {
  const matchesByLineId = new Map<string, any[]>();
  for (const m of stockxMatches ?? []) {
    const lid = String(m?.galaxusOrderLineId ?? "").trim();
    if (!lid) continue;
    const arr = matchesByLineId.get(lid) ?? [];
    arr.push(m);
    matchesByLineId.set(lid, arr);
  }

  const resolveSavedMatch = (line: any) => {
    const lineMatches = matchesByLineId.get(String(line?.id ?? "")) ?? [];
    if (lineMatches.length > 0) return lineMatches[0];
    const gtinKeys = expandGtinsForDbLookup([String(line?.gtin ?? "")]);
    if (gtinKeys.length === 0) return null;
    for (const m of stockxMatches ?? []) {
      const mg = String(m?.galaxusGtin ?? "").trim();
      if (!mg) continue;
      if (gtinKeys.some((g) => sameGtinKey(g, mg)) && String(m?.stockxOrderNumber ?? "").trim()) {
        return m;
      }
    }
    return null;
  };

  return lines.map((line) => {
    const qty = Math.max(Number(line.quantity ?? 1), 1);
    const whHint = galaxusLineWarehouseStockHint(line);
    /** Own / partner / Golden (THE_/NER_/GLD_): not fulfilled via StockX buy link. */
    if (whHint) {
      const source =
        whHint === "MAISON"
          ? ("maison_stock" as const)
          : whHint === "NER_STOCK"
            ? ("ner_stock" as const)
            : ("golden_manual" as const);
      const units = Array.from({ length: qty }, (_, i) => ({
        unitIndex: i,
        linked: true,
        source,
        stockxOrderNumber: null as string | null,
        stockxOrderId: null as string | null,
        stockxAmount: null as number | null,
        stockxCurrencyCode: null as string | null,
        awb: null as string | null,
      }));
      return {
        ...line,
        procurement: {
          ok: true,
          source,
          stockxOrderNumber: null,
          stockxOrderId: null,
          awb: null,
          stockxCostChf: null,
          stockxCostCurrency: null,
          units,
          warehouseStockHint: whHint,
        },
      };
    }

    const gtin = String(line?.gtin ?? "").trim();
    const lineMatches = matchesByLineId.get(String(line?.id ?? "")) ?? [];
    const match = lineMatches[0] ?? resolveSavedMatch(line);
    const orderNum = match ? String(match.stockxOrderNumber ?? "").trim() : "";

    let ok = false;
    let source: "galaxus_match" | "stx_sync" | null = null;
    let stockxOrderNumber: string | null = orderNum || null;
    let stockxOrderId: string | null = null;
    let awb: string | null = null;
    let stockxCostChf: number | null = null;
    let stockxCostCurrency: string | null = null;

    if (orderNum) {
      ok = true;
      source = "galaxus_match";
      awb = match?.stockxAwb != null ? String(match.stockxAwb) : null;
      stockxOrderId = match?.stockxOrderId != null ? String(match.stockxOrderId).trim() || null : null;
      const amt = match?.stockxAmount != null ? Number(match.stockxAmount) : null;
      if (amt != null && Number.isFinite(amt)) {
        stockxCostChf = amt;
        stockxCostCurrency =
          match?.stockxCurrencyCode != null ? String(match.stockxCurrencyCode).trim() : null;
      }
      const unit = pickStxPurchaseUnitForLine(line, stxUnits);
      if (unit) {
        if (!awb && unit.awb != null) awb = String(unit.awb);
        if (!stockxOrderId && unit.stockxOrderId != null) stockxOrderId = String(unit.stockxOrderId);
        if (stockxCostChf == null && unit.stockxSettledAmount != null) {
          const n = Number(unit.stockxSettledAmount);
          if (Number.isFinite(n)) {
            stockxCostChf = n;
            stockxCostCurrency =
              unit.stockxSettledCurrency != null ? String(unit.stockxSettledCurrency).trim() : null;
          }
        }
      }
    } else if (gtin && stx?.buckets?.length && isGalaxusStxSupplierLine(line)) {
      const sv = String(line?.supplierVariantId ?? "").trim();
      const bucket =
        stx.buckets.find(
          (b: any) => sameGtinKey(gtin, String(b?.gtin ?? "")) && String(b?.supplierVariantId ?? "").trim() === sv
        ) ?? stx.buckets.find((b: any) => sameGtinKey(gtin, String(b?.gtin ?? "")));
      if (bucket && Number(bucket.needed) > 0 && Number(bucket.linked) >= Number(bucket.needed)) {
        ok = true;
        source = "stx_sync";
        const bu = stxUnits.find(
          (u: any) =>
            unitMatchesLine(line, u) &&
            String(u?.supplierVariantId ?? "").trim() === String(bucket.supplierVariantId ?? "").trim()
        );
        const buLoose = bu ?? stxUnits.find((u: any) => unitMatchesLine(line, u));
        stockxOrderId = buLoose?.stockxOrderId != null ? String(buLoose.stockxOrderId) : null;
        awb = buLoose?.awb != null ? String(buLoose.awb) : null;
        const numFromUnit =
          buLoose?.stockxSettledAmount != null ? Number(buLoose.stockxSettledAmount) : null;
        if (numFromUnit != null && Number.isFinite(numFromUnit)) {
          stockxCostChf = numFromUnit;
          stockxCostCurrency =
            buLoose?.stockxSettledCurrency != null
              ? String(buLoose.stockxSettledCurrency).trim()
              : null;
        }
        stockxOrderNumber =
          (buLoose?.stockxOrderNumber != null && String(buLoose.stockxOrderNumber).trim()) ||
          stockxOrderId;
      }
    }

    const relevantStxUnits = gtin
      ? stxUnits.filter((u: any) => unitMatchesLine(line, u) && u?.stockxOrderId && !u?.cancelledAt)
      : [];

    const units = Array.from({ length: qty }, (_, i) => {
      const unitMatch = lineMatches.find((m: any) => Number(m?.unitIndex ?? 0) === i) ?? null;
      if (unitMatch) {
        return {
          unitIndex: i,
          linked: true,
          source: "galaxus_match" as const,
          stockxOrderNumber: unitMatch.stockxOrderNumber ?? null,
          stockxOrderId: unitMatch.stockxOrderId ?? null,
          stockxAmount: unitMatch.stockxAmount != null ? Number(unitMatch.stockxAmount) : null,
          stockxCurrencyCode: unitMatch.stockxCurrencyCode ?? null,
          awb: unitMatch.stockxAwb ?? null,
        };
      }
      if (i === 0 && match && orderNum) {
        return {
          unitIndex: i,
          linked: true,
          source: "galaxus_match" as const,
          stockxOrderNumber: match.stockxOrderNumber ?? null,
          stockxOrderId: match.stockxOrderId ?? null,
          stockxAmount: match.stockxAmount != null ? Number(match.stockxAmount) : null,
          stockxCurrencyCode: match.stockxCurrencyCode ?? null,
          awb: match.stockxAwb ?? null,
        };
      }
      const stxUnit =
        relevantStxUnits[i] ?? (i === 0 ? pickStxPurchaseUnitForLine(line, stxUnits) : null);
      if (stxUnit) {
        return {
          unitIndex: i,
          linked: true,
          source: "stx_sync" as const,
          stockxOrderNumber: stxUnit.stockxOrderNumber ?? stxUnit.stockxOrderId ?? null,
          stockxOrderId: stxUnit.stockxOrderId ?? null,
          stockxAmount: stxUnit.stockxSettledAmount != null ? Number(stxUnit.stockxSettledAmount) : null,
          stockxCurrencyCode: stxUnit.stockxSettledCurrency ?? null,
          awb: stxUnit.awb ?? null,
        };
      }
      return { unitIndex: i, linked: false, source: null as string | null };
    });
    const allLinked = units.every((u) => u.linked);
    const lineOk = allLinked || ok;

    const sumLinkedUnitAmounts = units
      .filter((u: any) => u.linked && u.stockxAmount != null && Number.isFinite(Number(u.stockxAmount)))
      .reduce((s: number, u: any) => s + Math.max(0, Number(u.stockxAmount)), 0);
    const resolvedStockxCostChf =
      sumLinkedUnitAmounts > 0
        ? sumLinkedUnitAmounts
        : stockxCostChf != null && Number.isFinite(stockxCostChf) && stockxCostChf > 0
          ? stockxCostChf
          : null;

    return {
      ...line,
      procurement: {
        ok: lineOk,
        source: allLinked ? (units[0]?.source ?? source) : source,
        stockxOrderNumber,
        stockxOrderId,
        awb,
        stockxCostChf: resolvedStockxCostChf,
        stockxCostCurrency,
        units,
      },
    };
  });
}

/** Same “linked” rule as order detail (`procurement.ok`), for left-list linkedCount. */
export function countLinkedLinesForList(
  lines: any[],
  stockxMatches: any[],
  stxUnits: any[],
  stx: any = null
): number {
  if (!Array.isArray(lines) || lines.length === 0) return 0;
  return attachProcurementToLines(lines, stx, stockxMatches ?? [], stxUnits ?? []).filter((line) =>
    Boolean(line?.procurement?.ok)
  ).length;
}

/**
 * Batch linkedCounts for `/api/galaxus/orders` list.
 * Counts GalaxusStockxMatch, StxPurchaseUnit (stx_sync), and warehouse-stock lines —
 * not match-row COUNT(*) alone (misses STX units without a match row).
 */
export function buildLinkedCountByOrderId(params: {
  orders: Array<{ id: string; galaxusOrderId: string }>;
  lines: Array<{ orderId: string } & Record<string, unknown>>;
  stockxMatches: Array<{ galaxusOrderId: string } & Record<string, unknown>>;
  /** StxPurchaseUnit.galaxusOrderId is the external Galaxus order ref. */
  stxUnits: Array<{ galaxusOrderId: string } & Record<string, unknown>>;
}): Map<string, number> {
  const linesByOrderId = new Map<string, any[]>();
  for (const line of params.lines ?? []) {
    const oid = String(line?.orderId ?? "").trim();
    if (!oid) continue;
    const arr = linesByOrderId.get(oid) ?? [];
    arr.push(line);
    linesByOrderId.set(oid, arr);
  }
  const matchesByOrderId = new Map<string, any[]>();
  for (const m of params.stockxMatches ?? []) {
    const oid = String(m?.galaxusOrderId ?? "").trim();
    if (!oid) continue;
    const arr = matchesByOrderId.get(oid) ?? [];
    arr.push(m);
    matchesByOrderId.set(oid, arr);
  }
  const unitsByOrderRef = new Map<string, any[]>();
  for (const u of params.stxUnits ?? []) {
    const ref = String(u?.galaxusOrderId ?? "").trim();
    if (!ref) continue;
    const arr = unitsByOrderRef.get(ref) ?? [];
    arr.push(u);
    unitsByOrderRef.set(ref, arr);
  }

  const out = new Map<string, number>();
  for (const order of params.orders ?? []) {
    const id = String(order?.id ?? "").trim();
    if (!id) continue;
    const ref = String(order?.galaxusOrderId ?? "").trim();
    out.set(
      id,
      countLinkedLinesForList(
        linesByOrderId.get(id) ?? [],
        matchesByOrderId.get(id) ?? [],
        unitsByOrderRef.get(ref) ?? [],
        null
      )
    );
  }
  return out;
}
