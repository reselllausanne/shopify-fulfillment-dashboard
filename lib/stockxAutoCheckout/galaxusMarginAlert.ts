/**
 * Ops email when Galaxus STX auto-buy aborts on margin (Shopify batch already
 * emails via emailStockxNeedsHuman; Galaxus batch did not).
 *
 * Dedup: StockxOrderAlert (scope=galaxus, alertType=MARGIN, refKey=gx-margin:<lineId>).
 */
import { prisma } from "@/app/lib/prisma";
import { emailStockxNeedsHuman } from "@/lib/stockxAutoCheckout/emailNeedsHuman";
import type { GalaxusBuyCandidate } from "@/lib/stockxAutoCheckout/galaxusBuyCandidates";
import type { StockxNeedsHumanPayload } from "@/lib/stockxAutoCheckout/types";
import {
  buildStockxCheckoutBuyUrl,
  convertEuToUs,
  inferBrandFromTitle,
} from "@/lib/stockxAutoCheckout/sizeUsFallback";

export const GALAXUS_MARGIN_ALERT_TYPE = "MARGIN";

export function galaxusMarginAlertRefKey(lineId: string): string {
  return `gx-margin:${String(lineId).trim()}`;
}

export function buildGalaxusMarginNeedsHumanPayload(input: {
  candidate: Pick<
    GalaxusBuyCandidate,
    "galaxusOrderId" | "lineId" | "productName" | "slug" | "sizeEU" | "sellChf" | "desiredLaneHint"
  >;
  totalChf?: number | null;
  detail?: string | null;
  lane?: string | null;
}): StockxNeedsHumanPayload {
  const c = input.candidate;
  const sizeUS =
    convertEuToUs(c.sizeEU, {
      title: c.productName,
      brand: inferBrandFromTitle(c.productName),
    }) || (c.sizeEU === "OS" ? "OS" : null);
  const productUrl = `https://stockx.com/fr-fr/${c.slug.replace(/^\/+/, "")}`;
  const buyUrl = buildStockxCheckoutBuyUrl(c.slug, sizeUS || c.sizeEU);
  const sell = c.sellChf;
  const total = input.totalChf ?? null;
  const marginPct =
    total != null && total > 0 ? ((sell - total) / sell) * 100 : null;
  const detailParts = [
    input.detail?.trim() || null,
    total != null
      ? `sell ${sell.toFixed(2)} CHF vs total ${total.toFixed(2)} CHF${
          marginPct != null ? ` (${marginPct.toFixed(1)}%)` : ""
        }`
      : `sell ${sell.toFixed(2)} CHF`,
    input.lane ? `lane ${input.lane}` : null,
  ].filter(Boolean);

  return {
    shopifyOrderName: `GX ${c.galaxusOrderId}`,
    shopifyOrderId: null,
    shopifyLineItemId: c.lineId,
    title: c.productName,
    sku: c.slug,
    saleChf: sell,
    slug: c.slug,
    productUrl,
    buyUrl,
    sizeEU: c.sizeEU,
    sizeUS,
    desiredLane: c.desiredLaneHint,
    lanes: [],
    recommended:
      total != null
        ? {
            label: "UNKNOWN",
            rawLabel: String(input.lane || "StockX"),
            totalChf: total,
          }
        : null,
    reason: "margin",
    detail: detailParts.join(" — "),
  };
}

/**
 * Email operator once per Galaxus line when auto-buy skips for margin.
 * Safe on re-runs (StockxOrderAlert dedupe).
 */
export async function notifyGalaxusMarginNeedsHuman(input: {
  candidate: GalaxusBuyCandidate;
  totalChf?: number | null;
  detail?: string | null;
  lane?: string | null;
}): Promise<{ emailed: boolean; skippedExisting?: boolean; error?: string }> {
  const prismaAny = prisma as any;
  const refKey = galaxusMarginAlertRefKey(input.candidate.lineId);
  const existing = await prismaAny.stockxOrderAlert.findUnique({
    where: {
      scope_alertType_refKey: {
        scope: "galaxus",
        alertType: GALAXUS_MARGIN_ALERT_TYPE,
        refKey,
      },
    },
    select: { id: true },
  });
  if (existing) return { emailed: false, skippedExisting: true };

  const payload = buildGalaxusMarginNeedsHumanPayload(input);
  const subject = `[Resell] Galaxus STX — marge insuffisante — ${input.candidate.galaxusOrderId}`;
  const { sent } = await emailStockxNeedsHuman([payload], { subject });
  if (!sent) {
    return { emailed: false, error: "email_not_sent" };
  }

  try {
    await prismaAny.stockxOrderAlert.create({
      data: {
        scope: "galaxus",
        alertType: GALAXUS_MARGIN_ALERT_TYPE,
        refKey,
        orderRef: input.candidate.galaxusOrderId,
        stockxOrderNumber: null,
        productTitle: input.candidate.productName,
        detail: payload.detail,
        emailTo:
          (process.env.STOCKX_ALERT_EMAIL || "").trim() ||
          (process.env.POSTMARK_FROM_EMAIL || "").trim() ||
          null,
      },
    });
  } catch (err: any) {
    // Unique race on concurrent re-run — treat as deduped success.
    if (String(err?.code) === "P2002") {
      return { emailed: true, skippedExisting: true };
    }
    return { emailed: true, error: String(err?.message ?? err) };
  }
  return { emailed: true };
}
