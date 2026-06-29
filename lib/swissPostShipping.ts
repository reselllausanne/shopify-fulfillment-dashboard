import type { fetchOrderShippingInfo } from "@/lib/shopifyFulfillment";

export const SWISS_POST_SIGNATURE_MIN_ORDER_CHF = 450;

type OrderShippingInfo = NonNullable<Awaited<ReturnType<typeof fetchOrderShippingInfo>>>;

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
