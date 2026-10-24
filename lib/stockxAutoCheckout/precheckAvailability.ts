/**
 * DB-only StockX buyability pre-check (NO browser, NO proxy, zero StockX network).
 *
 * Decides, per Shopify order line, whether an automatic StockX buy is possible and
 * at what lane/price, using only `SupplierVariant` — the StockX CH availability+price
 * source kept fresh by KickDB SSE (`price:stockx:ch` → /api/kickdb/upsert).
 *
 * Pure DB + pure logic so callers can cheaply skip known-unbuyable items and never
 * waste proxy bandwidth re-probing them in a browser. The actual verdict math lives
 * in `evaluatePrecheck()` (DB-free → trivially unit-testable).
 */
import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import { normSizeEU, styleIdFromSku } from "@/lib/stockxAutoCheckout/prebuyDedupe";
import type { StockxDesiredLane, StockxPrecheckStatus } from "@/lib/stockxAutoCheckout/types";

/** StockX-origin SupplierVariant id prefix (see galaxus/jobs/stxSync.ts). */
const STX_PREFIX = "stx_";

/** Minimal Shopify line shape the pre-check needs (subset of ShopifyLineCtx). */
export type PrecheckLine = {
  sku: string;
  gtin?: string | null;
  sizeEU: string;
  title?: string | null;
  saleChf: number | null;
};

/** DB-free snapshot of the SupplierVariant fields the verdict depends on. */
export type SupplierVariantSnapshot = {
  supplierVariantId: string;
  stock: number;
  /** Base StockX CH price (CHF) — fallback when a lane estimate is missing. */
  price: number | null;
  /** StockX standard-lane estimated buy (CHF). */
  standardBuyPrice: number | null;
  /** StockX express-lane estimated buy (CHF). */
  expressBuyPrice: number | null;
  lastSyncAt: Date | null;
};

export type PrecheckResult = {
  status: StockxPrecheckStatus;
  lane: StockxDesiredLane;
  /** CHF we expect to pay on the chosen lane (lane estimate, else base price). */
  expectedBuyChf: number | null;
  stock: number;
  sellChf: number;
  /** Fraction (0.05 = 5%); null when it can't be computed. */
  marginPct: number | null;
  detail: string;
  supplierVariantId: string | null;
};

export type PrecheckOptions = {
  line: PrecheckLine;
  desiredLane: StockxDesiredLane;
  marginFloorPct?: number;
  staleHours?: number;
  now?: Date;
};

const DEFAULT_MARGIN_FLOOR_PCT = 0.05;
const DEFAULT_STALE_HOURS = 24;

function decToNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}

function fmtPct(pct: number | null): string {
  return pct == null ? "n/a" : `${(pct * 100).toFixed(1)}%`;
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 3_600_000;
}

/**
 * Pure verdict: given a variant snapshot + sale price + desired lane, decide status.
 * Order of checks (per spec): OOS → lane price → margin → staleness → buyable.
 */
export function evaluatePrecheck(input: {
  variant: SupplierVariantSnapshot | null;
  sellChf: number | null;
  desiredLane: StockxDesiredLane;
  marginFloorPct?: number;
  staleHours?: number;
  now?: Date;
}): PrecheckResult {
  const lane = input.desiredLane;
  const marginFloorPct = input.marginFloorPct ?? DEFAULT_MARGIN_FLOOR_PCT;
  const staleHours = input.staleHours ?? DEFAULT_STALE_HOURS;
  const now = input.now ?? new Date();
  const sellChf = Number(input.sellChf ?? 0);

  if (!input.variant) {
    return {
      status: "no_variant_match",
      lane,
      expectedBuyChf: null,
      stock: 0,
      sellChf,
      marginPct: null,
      detail: "no StockX SupplierVariant matched (gtin / sku+size)",
      supplierVariantId: null,
    };
  }

  const v = input.variant;
  const stock = Number(v.stock ?? 0);

  // 1) True OOS — no seller/ask at this size. Safe to tell the customer; never re-probe.
  if (!(stock > 0)) {
    return {
      status: "oos_no_ask",
      lane,
      expectedBuyChf: null,
      stock,
      sellChf,
      marginPct: null,
      detail: "stock<=0 — true OOS (aucune demande)",
      supplierVariantId: v.supplierVariantId,
    };
  }

  // 2) Pick price for the desired lane, fall back to base price. Note lane gaps.
  const lanePrice = lane === "EXPRESS" ? decToNum(v.expressBuyPrice) : decToNum(v.standardBuyPrice);
  const otherLanePrice =
    lane === "EXPRESS" ? decToNum(v.standardBuyPrice) : decToNum(v.expressBuyPrice);
  const basePrice = decToNum(v.price);
  const notes: string[] = [];
  let expectedBuyChf = lanePrice;
  if (expectedBuyChf == null) {
    expectedBuyChf = basePrice;
    if (otherLanePrice != null) {
      // Desired lane estimate missing but the other lane is present.
      notes.push(lane === "EXPRESS" ? "standard_only" : "express_only");
    }
    if (basePrice != null) notes.push("used base price fallback");
  }

  // 3) No usable price at all → treat as stale (SSE may repopulate; retry later).
  if (expectedBuyChf == null || !(expectedBuyChf > 0)) {
    return {
      status: "stale_data",
      lane,
      expectedBuyChf: null,
      stock,
      sellChf,
      marginPct: null,
      detail: ["no usable price (lane + base null)", ...notes].join("; "),
      supplierVariantId: v.supplierVariantId,
    };
  }

  const marginPct = sellChf > 0 ? (sellChf - expectedBuyChf) / sellChf : null;

  // 4) Margin floor.
  if (marginPct == null || marginPct < marginFloorPct) {
    return {
      status: "too_expensive",
      lane,
      expectedBuyChf,
      stock,
      sellChf,
      marginPct,
      detail: [
        `margin ${fmtPct(marginPct)} < floor ${fmtPct(marginFloorPct)}`,
        ...notes,
      ].join("; "),
      supplierVariantId: v.supplierVariantId,
    };
  }

  // 5) Staleness — price/stock last changed too long ago; caller may refresh then retry.
  //    NOTE: lastSyncAt bumps only when a value changes (see bulkSql), so a long-stable
  //    price can read as stale; that is intentionally conservative for an auto-buy gate.
  if (v.lastSyncAt && hoursBetween(now, v.lastSyncAt) > staleHours) {
    return {
      status: "stale_data",
      lane,
      expectedBuyChf,
      stock,
      sellChf,
      marginPct,
      detail: [`lastSyncAt older than ${staleHours}h — refresh before buy`, ...notes].join("; "),
      supplierVariantId: v.supplierVariantId,
    };
  }

  return {
    status: "buyable",
    lane,
    expectedBuyChf,
    stock,
    sellChf,
    marginPct,
    detail: ["buyable", ...notes].join("; "),
    supplierVariantId: v.supplierVariantId,
  };
}

const SUPPLIER_VARIANT_SELECT = {
  supplierVariantId: true,
  stock: true,
  price: true,
  standardBuyPrice: true,
  expressBuyPrice: true,
  sizeRaw: true,
  lastSyncAt: true,
} as const;

type SupplierVariantRow = {
  supplierVariantId: string;
  stock: number;
  price: unknown;
  standardBuyPrice: unknown;
  expressBuyPrice: unknown;
  sizeRaw: string | null;
  lastSyncAt: Date | null;
};

function toSnapshot(row: SupplierVariantRow): SupplierVariantSnapshot {
  return {
    supplierVariantId: row.supplierVariantId,
    stock: Number(row.stock ?? 0),
    price: decToNum(row.price),
    standardBuyPrice: decToNum(row.standardBuyPrice),
    expressBuyPrice: decToNum(row.expressBuyPrice),
    lastSyncAt: row.lastSyncAt ?? null,
  };
}

/** KickDB styleId → StockX slug (urlKey). Local copy to avoid pulling in Playwright. */
async function resolveSlugFromStyleId(styleId: string): Promise<string | null> {
  const id = styleId.trim();
  if (!id) return null;
  const product = await prisma.kickDBProduct.findFirst({
    where: { styleId: { equals: id, mode: "insensitive" }, urlKey: { not: null } },
    select: { urlKey: true },
    orderBy: { updatedAt: "desc" },
  });
  return product?.urlKey?.trim() || null;
}

/**
 * Map a Shopify line → StockX `SupplierVariant` row.
 * Primary: GTIN (barcode) — reliable, every StockX CH size carries a GTIN.
 * Fallback: supplierSku (styleId / raw sku / slug) + normalized EU size.
 * Returns the snapshot or null (→ no_variant_match).
 */
export async function resolveSupplierVariantForLine(
  line: PrecheckLine
): Promise<SupplierVariantSnapshot | null> {
  const gtin = (line.gtin ?? "").trim();
  if (gtin && validateGtin(gtin)) {
    const row = await prisma.supplierVariant.findFirst({
      where: { gtin, supplierVariantId: { startsWith: STX_PREFIX } },
      orderBy: [{ lastSyncAt: "desc" }, { updatedAt: "desc" }],
      select: SUPPLIER_VARIANT_SELECT,
    });
    if (row) return toSnapshot(row as SupplierVariantRow);
  }

  // Fallback: no GTIN match → supplierSku + size.
  const styleId = styleIdFromSku(line.sku);
  const wantSize = normSizeEU(line.sizeEU);
  if (styleId && wantSize) {
    const slug = await resolveSlugFromStyleId(styleId);
    const skuCandidates = Array.from(
      new Set([styleId, line.sku.trim(), slug].filter((s): s is string => Boolean(s)))
    );
    if (skuCandidates.length) {
      const rows = await prisma.supplierVariant.findMany({
        where: {
          supplierVariantId: { startsWith: STX_PREFIX },
          OR: skuCandidates.map((s) => ({ supplierSku: { equals: s, mode: "insensitive" as const } })),
        },
        orderBy: [{ lastSyncAt: "desc" }],
        select: SUPPLIER_VARIANT_SELECT,
        take: 300,
      });
      const hit = rows.find(
        (r) => normSizeEU((r as SupplierVariantRow).sizeRaw) === wantSize
      );
      if (hit) return toSnapshot(hit as SupplierVariantRow);
    }
  }

  return null;
}

/**
 * DB-backed pre-check: resolve the StockX SupplierVariant for a line, then run the
 * pure verdict. Zero StockX network — only reads already-synced DB rows.
 */
export async function precheckStockxBuyability(opts: PrecheckOptions): Promise<PrecheckResult> {
  const variant = await resolveSupplierVariantForLine(opts.line);
  return evaluatePrecheck({
    variant,
    sellChf: opts.line.saleChf,
    desiredLane: opts.desiredLane,
    marginFloorPct: opts.marginFloorPct,
    staleHours: opts.staleHours,
    now: opts.now,
  });
}
