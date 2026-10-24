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
  if (error.code === "ITEM_NOT_RETURNABLE") {
    return "This line is not eligible for an exchange on this order.";
  }
  if (error.code === "RATE_LIMITED") {
    return error.message || "Too many requests — wait a few seconds and try again.";
  }
  if (error.code === "SERVER_ERROR") {
    return error.message || "Temporary server error. Try again in a moment.";
  }
  return error.message || fallback;
}
