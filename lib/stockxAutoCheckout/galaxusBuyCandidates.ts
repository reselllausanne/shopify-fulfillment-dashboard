import { prisma } from "@/app/lib/prisma";
import { galaxusLineNetRevenueChf } from "@/galaxus/orders/margin";
import {
  isGalaxusStxSupplierLine,
  galaxusLineWarehouseStockHint,
} from "@/galaxus/warehouse/lineInventorySource";
import { chooseGalaxusDesiredLane } from "@/lib/stockxAutoCheckout/galaxusLanePolicy";
import type { StockxDesiredLane } from "@/lib/stockxAutoCheckout/types";

const STX_PREFIX = "stx_";

export type GalaxusBuyCandidate = {
  galaxusOrderId: string;
  galaxusOrderDbId: string;
  orderDate: Date | null;
  lineId: string;
  lineNumber: number | null;
  gtin: string | null;
  providerKey: string | null;
  productName: string;
  sizeEU: string;
  sellChf: number;
  slug: string;
  styleId: string | null;
  expressBuyChf: number | null;
  standardBuyChf: number | null;
  /** Hint from DB prices (live checkout still uses galaxus_express_first). */
  desiredLaneHint: StockxDesiredLane;
  supplierVariantId: string | null;
};

/** Size from "Title (44.5)" / "Title (EU 44)" / line.size. */
export function sizeEuFromGalaxusLine(line: {
  size?: string | null;
  productName?: string | null;
  description?: string | null;
}): string | null {
  const rawSize = String(line.size ?? "").trim();
  if (rawSize) {
    return rawSize.replace(/^EU\s*/i, "").trim() || null;
  }
  const title = `${line.productName ?? ""} ${line.description ?? ""}`;
  const m =
    title.match(/\(\s*EU\s*([0-9]+(?:[.,][0-9]+)?)\s*\)/i) ||
    title.match(/\(\s*([0-9]+(?:[.,][0-9]+)?)\s*\)\s*$/) ||
    title.match(/\(\s*([0-9]+(?:[.,][0-9]+)?)\s*\)/);
  if (!m?.[1]) return null;
  return m[1].replace(",", ".").trim();
}

function decToNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve StockX slug + size + sell for one Galaxus STX line.
 * Slug from VariantMapping→KickDB urlKey, else styleId/supplierSku lookup.
 */
export async function resolveGalaxusStxBuyCandidate(input: {
  order: {
    id: string;
    galaxusOrderId: string;
    orderDate?: Date | null;
  };
  line: {
    id: string;
    lineNumber?: number | null;
    gtin?: string | null;
    providerKey?: string | null;
    supplierPid?: string | null;
    supplierSku?: string | null;
    supplierVariantId?: string | null;
    productName?: string | null;
    description?: string | null;
    size?: string | null;
    quantity?: number | null;
    lineNetAmount?: unknown;
    priceLineAmount?: unknown;
    unitNetPrice?: unknown;
  };
}): Promise<
  | { ok: true; candidate: GalaxusBuyCandidate }
  | { ok: false; reason: string }
> {
  const { order, line } = input;
  if (!isGalaxusStxSupplierLine(line)) {
    return { ok: false, reason: "not_stx_line" };
  }
  if (galaxusLineWarehouseStockHint(line)) {
    return { ok: false, reason: "warehouse_stock_hint" };
  }

  const sellChf = galaxusLineNetRevenueChf(line);
  if (sellChf == null || sellChf <= 0) {
    return { ok: false, reason: "no_sell_chf" };
  }

  const gtin = String(line.gtin ?? "").trim() || null;
  let sv: {
    supplierVariantId: string;
    providerKey: string | null;
    supplierSku: string | null;
    sizeRaw: string | null;
    expressBuyPrice: unknown;
    standardBuyPrice: unknown;
    price: unknown;
  } | null = null;

  if (gtin) {
    sv = await prisma.supplierVariant.findFirst({
      where: { gtin, supplierVariantId: { startsWith: STX_PREFIX } },
      orderBy: [{ lastSyncAt: "desc" }, { updatedAt: "desc" }],
      select: {
        supplierVariantId: true,
        providerKey: true,
        supplierSku: true,
        sizeRaw: true,
        expressBuyPrice: true,
        standardBuyPrice: true,
        price: true,
      },
    });
  }

  let slug: string | null = null;
  let styleId: string | null = null;
  if (sv?.supplierVariantId) {
    const mapped = await prisma.variantMapping.findFirst({
      where: { supplierVariantId: sv.supplierVariantId },
      select: {
        kickdbVariant: {
          select: {
            product: { select: { urlKey: true, styleId: true } },
          },
        },
      },
    });
    slug = mapped?.kickdbVariant?.product?.urlKey?.trim() || null;
    styleId = mapped?.kickdbVariant?.product?.styleId?.trim() || null;
  }

  if (!slug && (sv?.supplierSku || styleId)) {
    const sid = String(styleId || sv?.supplierSku || "").trim();
    if (sid) {
      const product = await prisma.kickDBProduct.findFirst({
        where: {
          styleId: { equals: sid, mode: "insensitive" },
          urlKey: { not: null },
        },
        select: { urlKey: true, styleId: true },
        orderBy: { updatedAt: "desc" },
      });
      slug = product?.urlKey?.trim() || null;
      styleId = product?.styleId?.trim() || styleId;
    }
  }

  if (!slug) {
    return { ok: false, reason: "slug_unresolved" };
  }

  const sizeEU =
    sizeEuFromGalaxusLine({
      size: line.size ?? sv?.sizeRaw ?? null,
      productName: line.productName,
      description: line.description,
    }) || "";
  if (!sizeEU) {
    return { ok: false, reason: "size_unresolved" };
  }

  const expressBuyChf = decToNum(sv?.expressBuyPrice);
  const standardBuyChf = decToNum(sv?.standardBuyPrice) ?? decToNum(sv?.price);
  const desiredLaneHint =
    chooseGalaxusDesiredLane(expressBuyChf, standardBuyChf) ?? "EXPRESS";

  return {
    ok: true,
    candidate: {
      galaxusOrderId: order.galaxusOrderId,
      galaxusOrderDbId: order.id,
      orderDate: order.orderDate ?? null,
      lineId: line.id,
      lineNumber: line.lineNumber ?? null,
      gtin,
      providerKey: String(line.providerKey ?? sv?.providerKey ?? "").trim() || null,
      productName: String(line.productName || line.description || "").trim() || slug,
      sizeEU,
      sellChf,
      slug,
      styleId,
      expressBuyChf,
      standardBuyChf,
      desiredLaneHint,
      supplierVariantId: sv?.supplierVariantId ?? null,
    },
  };
}

/** Unbought STX lines oldest-first (no GalaxusStockxMatch with order #). */
export async function listUnboughtGalaxusStxCandidates(opts?: {
  limit?: number;
  galaxusOrderId?: string;
}): Promise<GalaxusBuyCandidate[]> {
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));
  const orders = await prisma.galaxusOrder.findMany({
    where: {
      archivedAt: null,
      cancelledAt: null,
      ...(opts?.galaxusOrderId
        ? { galaxusOrderId: String(opts.galaxusOrderId) }
        : {}),
    },
    orderBy: { orderDate: "asc" },
    take: opts?.galaxusOrderId ? 5 : 400,
    include: { lines: true },
  });

  const out: GalaxusBuyCandidate[] = [];
  for (const order of orders) {
    for (const line of order.lines ?? []) {
      if (!isGalaxusStxSupplierLine(line)) continue;
      if (galaxusLineWarehouseStockHint(line)) continue;

      const linked = await (prisma as any).galaxusStockxMatch.count({
        where: {
          galaxusOrderLineId: line.id,
          stockxOrderNumber: { not: "" },
        },
      });
      const qty = Math.max(1, Math.round(Number(line.quantity ?? 1)));
      if (linked >= qty) continue;

      const resolved = await resolveGalaxusStxBuyCandidate({ order, line });
      if (!resolved.ok) continue;
      out.push(resolved.candidate);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
