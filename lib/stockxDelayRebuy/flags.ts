/**
 * Feature flags for Shopify customer delay / cancel-rebuy mails + optional auto-rebuy.
 *
 * STOCKX_CUSTOMER_DELAY_MAIL=1     → send customer mails (default OFF)
 * STOCKX_CUSTOMER_DELAY_MAIL_TO=…  → force recipient (TEST safety; ignoreOverride)
 * STOCKX_AUTO_REBUY_ON_CANCEL=1    → Playwright Place Order on fresh Shopify cancel (default OFF)
 * STOCKX_CUSTOMER_DELAY_MAIL_MAX=N → max customer mails per opsAlerts run (default 5)
 */

function truthy(raw: string | undefined | null): boolean {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Customer delay + cancel-rebuy mails. Default OFF — enable explicitly on VPS. */
export function isCustomerDelayMailEnabled(): boolean {
  return truthy(process.env.STOCKX_CUSTOMER_DELAY_MAIL);
}

/**
 * Optional forced recipient (ops inbox). When set, never hits the real customer.
 * Pattern mirrors POSTMARK_OVERRIDE_TO but scoped to this flow.
 */
export function customerDelayMailToOverride(): string | null {
  const to = (process.env.STOCKX_CUSTOMER_DELAY_MAIL_TO || "").trim();
  return to || null;
}

/** Auto Place Order on fresh Shopify CANCELLED. Default OFF (expensive / Turnstile). */
export function isAutoRebuyOnCancelEnabled(): boolean {
  return truthy(process.env.STOCKX_AUTO_REBUY_ON_CANCEL);
}

export function customerDelayMailMaxPerRun(): number {
  const n = Number(process.env.STOCKX_CUSTOMER_DELAY_MAIL_MAX ?? 5);
  if (!Number.isFinite(n)) return 5;
  return Math.min(20, Math.max(0, Math.floor(n)));
}
