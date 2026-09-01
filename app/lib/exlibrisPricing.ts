/** Ex Libris CH pricing — REI-style % margin + small-order fee + min abs floor.

FAQ: portofrei if order ≥ CHF 9.90; else Kleinmengenzuschlag CHF 5.00.
Post transit after dispatch: +2–3 Werktage.
*/
export type ExlibrisLandedCost = {
  buyChf: number;
  shippingChf: number;
  shippingReason: string;
  freeShipMinChf: number;
  landedChf: number;
  marginPercent: number;
  minAbsMarginChf: number;
  marginMode: "percent" | "min_abs_floor";
  sellPriceChf: number;
  vatRate: number;
  priceSource: "chf_gross";
  dispatchDaysMin: number | null;
  dispatchDaysMax: number | null;
  doorDaysMin: number | null;
  doorDaysMax: number | null;
  leadParse: string;
};

const DEFAULT_FREE_SHIP_MIN = 9.9;
const DEFAULT_SMALL_ORDER_FEE = 5;
const DEFAULT_MIN_ABS_MARGIN = 3;
const POST_TRANSIT_MIN = 2;
const POST_TRANSIT_MAX = 3;

export function exlibrisPricingConfig() {
  const reiMargin = process.env.SCRAPER_REI_MARGIN_PERCENT;
  const marginRaw = process.env.SCRAPER_EXL_MARGIN_PERCENT || reiMargin || "30";
  const shipOverride = process.env.SCRAPER_EXL_SHIPPING_CHF;
  return {
    marginPercent: Math.max(0, Number(marginRaw)),
    shippingChfOverride:
      shipOverride === undefined || shipOverride === "" ? null : Math.max(0, Number(shipOverride)),
    freeShipMinChf: Math.max(0, Number(process.env.SCRAPER_EXL_FREE_SHIP_MIN_CHF || DEFAULT_FREE_SHIP_MIN)),
    smallOrderFeeChf: Math.max(
      0,
      Number(process.env.SCRAPER_EXL_SMALL_ORDER_FEE_CHF || DEFAULT_SMALL_ORDER_FEE)
    ),
    minAbsMarginChf: Math.max(
      0,
      Number(process.env.SCRAPER_EXL_MIN_ABS_MARGIN_CHF || DEFAULT_MIN_ABS_MARGIN)
    ),
    vatRate: Math.max(0, Number(process.env.SCRAPER_EXL_VAT_RATE || 0.081)),
  };
}

function roundChf(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveExlibrisShippingChf(
  buyChf: number,
  override?: number | null
): { shippingChf: number; reason: string } {
  const cfg = exlibrisPricingConfig();
  if (override != null) return { shippingChf: Math.max(0, override), reason: "override" };
  if (cfg.shippingChfOverride != null) {
    return { shippingChf: cfg.shippingChfOverride, reason: "env_override" };
  }
  if (buyChf < cfg.freeShipMinChf) {
    return { shippingChf: cfg.smallOrderFeeChf, reason: "kleinmengenzuschlag" };
  }
  return { shippingChf: 0, reason: "portofrei" };
}

export function parseExlibrisLeadTime(availabilityText: string): {
  dispatchDaysMin: number | null;
  dispatchDaysMax: number | null;
  doorDaysMin: number | null;
  doorDaysMax: number | null;
  leadTimeDays: string;
  leadParse: string;
} {
  const text = String(availabilityText || "").trim();
  const empty = {
    dispatchDaysMin: null,
    dispatchDaysMax: null,
    doorDaysMin: null,
    doorDaysMax: null,
    leadTimeDays: "",
    leadParse: "unknown",
  };
  if (!text) return empty;
  const low = text.toLowerCase();

  if (/sofort\s+versandbereit|sofort\s+lieferbar|sofort\s+verf[uü]gbar/.test(low)) {
    return {
      dispatchDaysMin: 0,
      dispatchDaysMax: 0,
      doorDaysMin: POST_TRANSIT_MIN,
      doorDaysMax: POST_TRANSIT_MAX,
      leadTimeDays: `${POST_TRANSIT_MIN}-${POST_TRANSIT_MAX}`,
      leadParse: "sofort_versandbereit",
    };
  }
  if (/vergriffen|nicht\s+lieferbar|ausverkauft/.test(low)) {
    return { ...empty, leadParse: "oos" };
  }

  let m = low.match(/innert\s+(\d+)\s*(?:bis|-|–)\s*(\d+)\s*(werktag|tag|woche)/);
  if (m) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    if (m[3].startsWith("woche")) {
      a *= 5;
      b *= 5;
    }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return {
      dispatchDaysMin: lo,
      dispatchDaysMax: hi,
      doorDaysMin: lo + POST_TRANSIT_MIN,
      doorDaysMax: hi + POST_TRANSIT_MAX,
      leadTimeDays: `${lo}-${hi}`,
      leadParse: "range_werktage",
    };
  }

  m = low.match(/innert\s+(\d+)\s*(werktag|tag|woche)/);
  if (m) {
    let n = Number(m[1]);
    if (m[2].startsWith("woche")) n *= 5;
    return {
      dispatchDaysMin: n,
      dispatchDaysMax: n,
      doorDaysMin: n + POST_TRANSIT_MIN,
      doorDaysMax: n + POST_TRANSIT_MAX,
      leadTimeDays: String(n),
      leadParse: "single_werktage",
    };
  }

  if (/erh[aä]ltlich\s+wieder|nachdruck|vorbestell/.test(low)) {
    return { ...empty, leadParse: "date_or_preorder" };
  }
  return empty;
}

/** Landed = buy + shipping; sell = max(landed×(1+%), landed+minAbs). */
export function computeExlibrisLandedCost(input: {
  buyChf: number;
  shippingChf?: number;
  marginPercent?: number;
  minAbsMarginChf?: number;
  availabilityText?: string;
}): ExlibrisLandedCost | null {
  if (!Number.isFinite(input.buyChf) || input.buyChf <= 0) return null;
  const cfg = exlibrisPricingConfig();
  const { shippingChf, reason } = resolveExlibrisShippingChf(input.buyChf, input.shippingChf);
  const marginPercent = input.marginPercent ?? cfg.marginPercent;
  const minAbs = input.minAbsMarginChf ?? cfg.minAbsMarginChf;
  const buyChf = roundChf(input.buyChf);
  const landedChf = roundChf(buyChf + shippingChf);
  const sellPct = roundChf(landedChf * (1 + marginPercent / 100));
  const sellFloor = roundChf(landedChf + minAbs);
  const sellPriceChf = Math.max(sellPct, sellFloor);
  const lead = parseExlibrisLeadTime(input.availabilityText || "");

  return {
    buyChf,
    shippingChf,
    shippingReason: reason,
    freeShipMinChf: cfg.freeShipMinChf,
    landedChf,
    marginPercent,
    minAbsMarginChf: minAbs,
    marginMode: sellPriceChf === sellPct ? "percent" : "min_abs_floor",
    sellPriceChf,
    vatRate: cfg.vatRate,
    priceSource: "chf_gross",
    dispatchDaysMin: lead.dispatchDaysMin,
    dispatchDaysMax: lead.dispatchDaysMax,
    doorDaysMin: lead.doorDaysMin,
    doorDaysMax: lead.doorDaysMax,
    leadParse: lead.leadParse,
  };
}

export function formatExlibrisManualNote(input: {
  ean: string;
  productUrl: string;
  availability?: string | null;
  stock?: string | null;
  sampleBucket?: string | null;
  cost: ExlibrisLandedCost;
}) {
  return JSON.stringify({
    type: "exlibris_landed_cost",
    ean: input.ean,
    productUrl: input.productUrl,
    availability: input.availability ?? undefined,
    stock: input.stock ?? undefined,
    sampleBucket: input.sampleBucket ?? undefined,
    ...input.cost,
    stockSource: "availability_text",
  });
}

export function isPlausibleExlibrisSellPrice(cost: ExlibrisLandedCost): boolean {
  return Number.isFinite(cost.sellPriceChf) && cost.sellPriceChf > 0 && cost.sellPriceChf < 100_000;
}
