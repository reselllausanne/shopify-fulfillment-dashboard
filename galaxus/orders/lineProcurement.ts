import {
  galaxusLineWarehouseStockHint,
  isGalaxusStxSupplierLine,
} from "@/galaxus/warehouse/lineInventorySource";
import { sameGtinKey } from "@/galaxus/orders/gtinKey";
import { expandGtinsForDbLookup } from "@/galaxus/stx/purchaseUnits";

function isLikelyStockxOrderRef(value: unknown): boolean {
  const ref = String(value ?? "").trim();
  if (!ref) return false;
  if (/^LOCAL-STOCK-/i.test(ref)) return false;
  if (/^MANUAL-/i.test(ref)) return false;
  // StockX refs should be compact identifiers; reject prose placeholders like "in stock ?".
  return /^[A-Z0-9-]{6,}$/i.test(ref);
}

function unitMatchesLine(line: any, unit: any): boolean {
  if (!unit?.stockxOrderId || unit?.cancelledAt) return false;
  const gtinKeys = expandGtinsForDbLookup([String(line?.gtin ?? "")]);
  const unitGtin = String(unit?.gtin ?? "").trim();
  if (gtinKeys.length > 0 && unitGtin && gtinKeys.some((g) => sameGtinKey(g, unitGtin))) return true;
  const lineSv = String(line?.supplierVariantId ?? "").trim();
  const unitSv = String(unit?.supplierVariantId ?? "").trim();
  return Boolean(lineSv && unitSv && lineSv === unitSv);
}

/** Prefer saved match ETA; fall back to StxPurchaseUnit etaMin/etaMax (Linked sync). */
function resolveStockxEta(match: any, unit: any) {
  return {
    stockxEstimatedDelivery: match?.stockxEstimatedDelivery ?? unit?.etaMin ?? null,
    stockxLatestEstimatedDelivery: match?.stockxLatestEstimatedDelivery ?? unit?.etaMax ?? null,
  };
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
          stockxEstimatedDelivery: null,
          stockxLatestEstimatedDelivery: null,
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
    let source: "galaxus_match" | "stx_sync" | "manual_reference" | "local_stock" | null = null;
    let stockxOrderNumber: string | null = orderNum || null;
    let stockxOrderId: string | null = null;
    let awb: string | null = null;
    let stockxCostChf: number | null = null;
    let stockxCostCurrency: string | null = null;
    let stockxEstimatedDelivery: Date | string | null = null;
    let stockxLatestEstimatedDelivery: Date | string | null = null;

    const hasStockxOrderId = String(match?.stockxOrderId ?? "").trim().length > 0;
    const hasStockxIdentity =
      hasStockxOrderId ||
      isLikelyStockxOrderRef(orderNum) ||
      String(match?.stockxSkuKey ?? "").trim().length > 0;
    const isLocalStockMatch =
      String(match?.matchType ?? "").trim().toUpperCase() === "LOCAL_STOCK" ||
      String(match?.stockxStatus ?? "").trim().toUpperCase() === "LOCAL_STOCK" ||
      /^LOCAL-STOCK-/i.test(orderNum);

    if (orderNum && hasStockxIdentity) {
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
      const eta = resolveStockxEta(match, unit);
      stockxEstimatedDelivery = eta.stockxEstimatedDelivery;
      stockxLatestEstimatedDelivery = eta.stockxLatestEstimatedDelivery;
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
    } else if (orderNum && isLocalStockMatch) {
      ok = true;
      source = "local_stock";
      stockxOrderId = null;
      awb = null;
      const amt = match?.stockxAmount != null ? Number(match.stockxAmount) : null;
      if (amt != null && Number.isFinite(amt)) {
        stockxCostChf = amt;
        stockxCostCurrency =
          match?.stockxCurrencyCode != null ? String(match.stockxCurrencyCode).trim() : null;
      }
      stockxEstimatedDelivery = null;
      stockxLatestEstimatedDelivery = null;
    } else if (orderNum && !hasStockxIdentity) {
      // Keep line operationally linked, but do not treat it as a real StockX purchase.
      ok = true;
      source = "manual_reference";
      stockxOrderId = null;
      awb = null;
      const amt = match?.stockxAmount != null ? Number(match.stockxAmount) : null;
      if (amt != null && Number.isFinite(amt)) {
        stockxCostChf = amt;
        stockxCostCurrency =
          match?.stockxCurrencyCode != null ? String(match.stockxCurrencyCode).trim() : null;
      } else {
        stockxCostChf = null;
        stockxCostCurrency = null;
      }
      stockxEstimatedDelivery = null;
      stockxLatestEstimatedDelivery = null;
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
        const eta = resolveStockxEta(null, buLoose);
        stockxEstimatedDelivery = eta.stockxEstimatedDelivery;
        stockxLatestEstimatedDelivery = eta.stockxLatestEstimatedDelivery;
      }
    }

    const relevantStxUnits = gtin
      ? stxUnits.filter((u: any) => unitMatchesLine(line, u) && u?.stockxOrderId && !u?.cancelledAt)
      : [];

    const matchUnitSource = (m: any): "galaxus_match" | "local_stock" | "manual_reference" => {
      const num = String(m?.stockxOrderNumber ?? "").trim();
      const type = String(m?.matchType ?? "").trim().toUpperCase();
      const status = String(m?.stockxStatus ?? "").trim().toUpperCase();
      if (type === "LOCAL_STOCK" || status === "LOCAL_STOCK" || /^LOCAL-STOCK-/i.test(num)) {
        return "local_stock";
      }
      if (!isLikelyStockxOrderRef(num) && !String(m?.stockxOrderId ?? "").trim()) {
        return "manual_reference";
      }
      return "galaxus_match";
    };

    const units = Array.from({ length: qty }, (_, i) => {
      const unitMatch = lineMatches.find((m: any) => Number(m?.unitIndex ?? 0) === i) ?? null;
      if (unitMatch) {
        return {
          unitIndex: i,
          linked: true,
          source: matchUnitSource(unitMatch),
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
          source: matchUnitSource(match),
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

    // When buckets missing but units already linked (list/count path), still surface cost/ETA.
    if (
      lineOk &&
      (stockxEstimatedDelivery == null || stockxCostChf == null) &&
      relevantStxUnits.length > 0
    ) {
      const fallbackUnit = relevantStxUnits[0];
      if (stockxCostChf == null && fallbackUnit?.stockxSettledAmount != null) {
        const n = Number(fallbackUnit.stockxSettledAmount);
        if (Number.isFinite(n)) {
          stockxCostChf = n;
          stockxCostCurrency =
            fallbackUnit.stockxSettledCurrency != null
              ? String(fallbackUnit.stockxSettledCurrency).trim()
              : stockxCostCurrency;
        }
      }
      if (stockxEstimatedDelivery == null) stockxEstimatedDelivery = fallbackUnit?.etaMin ?? null;
      if (stockxLatestEstimatedDelivery == null) {
        stockxLatestEstimatedDelivery = fallbackUnit?.etaMax ?? null;
      }
    }

    const sumLinkedUnitAmounts = units
      .filter((u: any) => u.linked && u.stockxAmount != null && Number.isFinite(Number(u.stockxAmount)))
      .reduce((s: number, u: any) => s + Math.max(0, Number(u.stockxAmount)), 0);
    // Allow explicit 0 (LOCAL ALREADY_EXPENSED). Only treat null/NaN as missing.
    const resolvedStockxCostChf =
      sumLinkedUnitAmounts > 0
        ? sumLinkedUnitAmounts
        : stockxCostChf != null && Number.isFinite(stockxCostChf)
          ? stockxCostChf
          : null;
    const localPhysicalQty = Number((line as any)?.physicalStock?.qty ?? 0);
    const hasLocalPhysicalStock = Number.isFinite(localPhysicalQty) && localPhysicalQty > 0;
    const localStockRef = `LOCAL-STOCK-${String((line as any)?.providerKey ?? "line").trim()}-${String(
      (line as any)?.lineNumber ?? 0
    ).trim()}`;

    return {
      ...line,
      procurement: {
        ok: lineOk || hasLocalPhysicalStock,
        source: hasLocalPhysicalStock
          ? ("local_stock" as const)
          : allLinked
            ? (units[0]?.source ?? source)
            : source,
        stockxOrderNumber: stockxOrderNumber ?? (hasLocalPhysicalStock ? localStockRef : null),
        stockxOrderId,
        awb,
        stockxCostChf: resolvedStockxCostChf,
        stockxCostCurrency,
        stockxEstimatedDelivery,
        stockxLatestEstimatedDelivery,
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
