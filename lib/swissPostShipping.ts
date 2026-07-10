import type { fetchOrderShippingInfo } from "@/lib/shopifyFulfillment";
import type { ShopifyDeliveryMode } from "@/app/lib/shopifyLineItemDelivery";
import { isLiquidationProductTitle } from "@/inventory/pricingPolicy";

export const SWISS_POST_SIGNATURE_MIN_ORDER_CHF = 450;

type OrderShippingInfo = NonNullable<Awaited<ReturnType<typeof fetchOrderShippingInfo>>>;

export type SwissPostPrzlResolution = {
  przl: string[];
  isExpress: boolean;
  forceSignature: boolean;
  baseProduct: "PRI" | "ECO";
  reason: string;
};

export function isPowerpayBilling(orderInfo: OrderShippingInfo | null) {
  const gateways = orderInfo?.paymentGatewayNames ?? [];
  return gateways.some((gateway) =>
    gateway.toLowerCase().includes("pay by invoice / pay later (with powerpay)".toLowerCase())
  );
}

export function isHighValueSignatureOrder(orderInfo: OrderShippingInfo | null) {
  const total = orderInfo?.orderTotal;
  if (!total || total.currencyCode !== "CHF") return false;
  const amount = Number(total.amount);
  return Number.isFinite(amount) && amount > SWISS_POST_SIGNATURE_MIN_ORDER_CHF;
}

export function shouldForceSwissPostSignature(orderInfo: OrderShippingInfo | null) {
  return isPowerpayBilling(orderInfo) || isHighValueSignatureOrder(orderInfo);
}

/**
 * Swiss Post DCAPI product codes (`item.attributes.przl`):
 * - ECO = PostPac Economy (standard)
 * - PRI = PostPac Priority (A-Post / express)
 * - SI  = signature add-on (Facture/Powerpay or high-value)
 *
 * Express comes from line `_delivery` / `Mode d'expédition` (same source as ⚡ Express badge).
 */
export function resolveSwissPostPrzl(input: {
  orderInfo: OrderShippingInfo | null;
  deliveryMode?: ShopifyDeliveryMode | null;
}): SwissPostPrzlResolution {
  const isExpress = input.deliveryMode === "express";
  const forceSignature = shouldForceSwissPostSignature(input.orderInfo);
  const baseProduct: "PRI" | "ECO" = isExpress ? "PRI" : "ECO";
  const przl = forceSignature ? ["SI", baseProduct] : [baseProduct];

  const parts: string[] = [];
  parts.push(isExpress ? "express→PRI" : "standard→ECO");
  if (forceSignature) {
    if (isPowerpayBilling(input.orderInfo)) parts.push("facture→SI");
    else if (isHighValueSignatureOrder(input.orderInfo)) parts.push("high-value→SI");
    else parts.push("signature→SI");
  }

  return {
    przl,
    isExpress,
    forceSignature,
    baseProduct,
    reason: parts.join(" + "),
  };
}

/** True when every title is a liquidation marker (`… 20%` / `… % - 42`). */
export function shouldSkipSwissPostLabelForLiquidation(
  titles: Array<string | null | undefined>
): boolean {
  const cleaned = titles.map((t) => String(t ?? "").trim()).filter(Boolean);
  if (cleaned.length === 0) return false;
  return cleaned.every((title) => isLiquidationProductTitle(title));
}

export function pickLineDeliveryMode(
  orderInfo: OrderShippingInfo | null,
  preferredLineItemIds: Array<string | null | undefined> = []
): ShopifyDeliveryMode | null {
  const nodes = orderInfo?.lineItems?.nodes ?? [];
  if (nodes.length === 0) return null;

  const preferred = new Set(
    preferredLineItemIds.map((id) => String(id ?? "").trim()).filter(Boolean)
  );
  if (preferred.size > 0) {
    for (const node of nodes) {
      if (!preferred.has(node.id)) continue;
      if (node.deliveryMode) return node.deliveryMode;
    }
  }

  const express = nodes.find((n) => n.deliveryMode === "express");
  if (express) return "express";
  const standard = nodes.find((n) => n.deliveryMode === "standard");
  if (standard) return "standard";
  return null;
}
