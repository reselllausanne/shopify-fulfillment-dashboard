/**
 * Pure guards: Force Fulfill is disabled for this release.
 * No HTTP body may expand fulfill to all remaining line items.
 */

export type ForceFulfillGuardResult =
  | { ok: true }
  | {
      ok: false;
      status: "FORCE_FULFILL_DISABLED";
      statusCode: 403;
      error: string;
    };

/** Reject any client attempt to enable force-fulfill. */
export function assertForceFulfillDisabled(
  allowAlreadyFulfilled: unknown
): ForceFulfillGuardResult {
  if (Boolean(allowAlreadyFulfilled)) {
    return {
      ok: false,
      status: "FORCE_FULFILL_DISABLED",
      statusCode: 403,
      error:
        "Force fulfill is disabled. Multi-unit orders require explicit selectedUnits; all-remaining fulfill is not allowed.",
    };
  }
  return { ok: true };
}

export type FoLineSelection = {
  fulfillmentOrderId: string;
  fulfillmentOrderLineItems: Array<{ id: string; quantity: number }>;
};

/**
 * Never expand to all remaining lines — even if a caller passes force=true.
 * Returns matched/selected lines only; usedAllRemaining is always false.
 */
export function resolveFulfillLineItems(params: {
  allowAlreadyFulfilled: boolean;
  matchedLineItemsByFulfillmentOrder: FoLineSelection[];
  allRemainingLineItems: FoLineSelection[];
}): { lineItemsByFulfillmentOrder: FoLineSelection[]; usedAllRemaining: boolean } {
  void params.allowAlreadyFulfilled;
  void params.allRemainingLineItems;
  return {
    lineItemsByFulfillmentOrder: params.matchedLineItemsByFulfillmentOrder,
    usedAllRemaining: false,
  };
}
