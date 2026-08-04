import { ShopifyReturnRequestError } from "@/shopify/returns/createAndOpenReturn";

const PUBLIC_LOOKUP_ERROR_CODES = new Set([
  "ORDER_NOT_FOUND",
  "EMAIL_MISMATCH",
  "INVALID_ORDER_NUMBER",
]);

export function toPublicReturnsErrorMessage(
  error: ShopifyReturnRequestError,
  fallback = "Request failed"
): string {
  if (PUBLIC_LOOKUP_ERROR_CODES.has(error.code)) {
    return "Order not found or email does not match. Check your order number (#1234) and checkout email.";
  }
  if (error.code === "RETURN_WINDOW_EXPIRED") {
    return "The 14-day return window after delivery has passed for this order.";
  }
  if (error.code === "RETURN_POLICY_EXCLUDED") {
    return "These items cannot be returned online (sale/promo or price over CHF 650).";
  }
  return error.message || fallback;
}
