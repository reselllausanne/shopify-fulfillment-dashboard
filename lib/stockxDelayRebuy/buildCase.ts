import { prisma } from "@/app/lib/prisma";
import {
  precheckStockxBuyability,
  resolveSlugFromStyleId,
} from "@/lib/stockxAutoCheckout/precheckAvailability";
import { styleIdFromSku } from "@/lib/stockxAutoCheckout/prebuyDedupe";
import {
  buildStockxBuyUrl,
  buildStockxCheckoutBuyUrl,
  convertEuToUs,
  inferBrandFromTitle,
} from "@/lib/stockxAutoCheckout/sizeUsFallback";
import type { StockxDesiredLane } from "@/lib/stockxAutoCheckout/types";
import { rebuyEtaWindow } from "@/lib/stockxDelayRebuy/eta";
import type { DelayRebuyCase } from "@/lib/stockxDelayRebuy/types";

function toNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v != null && typeof (v as any).toNumber === "function") {
    try {
      const n = (v as any).toNumber();
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function laneFromCheckout(checkoutType: string | null, orderNumber: string | null): StockxDesiredLane {
  if (orderNumber?.startsWith("01-")) return "EXPRESS";
  if (checkoutType && checkoutType.toUpperCase().includes("EXPRESS")) return "EXPRESS";
  return "STANDARD";
}

/**
 * Load OrderMatch + KickDB/SupplierVariant precheck + StockX /buy/ deep link.
 */
export async function buildDelayRebuyCase(orderMatchId: string): Promise<DelayRebuyCase> {
  const match = await prisma.orderMatch.findUnique({
    where: { id: orderMatchId },
    select: {
      id: true,
      shopifyOrderId: true,
      shopifyOrderName: true,
      shopifyLineItemId: true,
      shopifyProductTitle: true,
      shopifySku: true,
      shopifySizeEU: true,
      shopifyTotalPrice: true,
      shopifyLineItemImageUrl: true,
      shopifyCustomerFirstName: true,
      shopifyCustomerEmail: true,
      customerTrackingToken: true,
      stockxOrderNumber: true,
      stockxStatus: true,
      stockxCheckoutType: true,
      stockxEstimatedDelivery: true,
      stockxLatestEstimatedDelivery: true,
    },
  });
  if (!match) throw new Error(`OrderMatch not found: ${orderMatchId}`);

  const saleChf = toNum(match.shopifyTotalPrice);
  const rebuyLane = laneFromCheckout(match.stockxCheckoutType, match.stockxOrderNumber);
  const sizeEU = match.shopifySizeEU || null;
  const sku = match.shopifySku || null;

  const precheck = await precheckStockxBuyability({
    line: {
      sku: sku || "",
      sizeEU: sizeEU || "",
      title: match.shopifyProductTitle,
      saleChf,
    },
    desiredLane: rebuyLane,
  });

  const styleId = styleIdFromSku(sku);
  const slug = styleId ? await resolveSlugFromStyleId(styleId) : null;
  const sizeUS =
    sizeEU &&
    convertEuToUs(sizeEU, {
      brand: inferBrandFromTitle(match.shopifyProductTitle),
      title: match.shopifyProductTitle,
    });

  const stockxCheckoutUrl = slug ? buildStockxCheckoutBuyUrl(slug, sizeUS) : null;
  const stockxPdpUrl = slug ? buildStockxBuyUrl(slug, sizeUS) : null;

  const etaEnd = match.stockxLatestEstimatedDelivery || match.stockxEstimatedDelivery;
  const daysPastEta =
    etaEnd != null
      ? Math.round(((Date.now() - etaEnd.getTime()) / 86_400_000) * 10) / 10
      : null;

  const { start: rebuyEtaStart, end: rebuyEtaEnd } = rebuyEtaWindow(rebuyLane);

  // Delay: prefer StockX refreshed ETA when still ahead; else synthetic rebuy window.
  const latestStillAhead = etaEnd != null && etaEnd.getTime() > Date.now();
  const announceEtaStart = latestStillAhead
    ? match.stockxEstimatedDelivery || rebuyEtaStart
    : rebuyEtaStart;
  const announceEtaEnd = latestStillAhead ? (etaEnd as Date) : rebuyEtaEnd;

  return {
    orderMatchId: match.id,
    shopifyOrderName: match.shopifyOrderName,
    shopifyLineItemId: match.shopifyLineItemId,
    shopifyOrderId: match.shopifyOrderId,
    productTitle: match.shopifyProductTitle,
    sku,
    sizeEU,
    saleChf,
    imageUrl: match.shopifyLineItemImageUrl,
    customerFirstName: match.shopifyCustomerFirstName,
    customerEmail: match.shopifyCustomerEmail,
    trackingToken: match.customerTrackingToken,
    stockxOrderNumber: match.stockxOrderNumber,
    stockxStatus: match.stockxStatus,
    checkoutType: match.stockxCheckoutType,
    rebuyLane,
    etaStart: match.stockxEstimatedDelivery,
    etaEnd,
    daysPastEta,
    precheck,
    slug,
    sizeUS: sizeUS || null,
    stockxCheckoutUrl,
    stockxPdpUrl,
    rebuyEtaStart,
    rebuyEtaEnd,
    announceEtaStart,
    announceEtaEnd,
  };
}
