/**
 * Validation + normalisation for Shopify custom pixel funnel events
 * (docs/shopify-custom-pixel-funnel.js → POST /api/track/funnel).
 *
 * Wire format (text/plain JSON, so the pixel needs no CORS preflight):
 *   { "k": "<FUNNEL_TRACK_KEY>", "e": [ { id, name, ts, ...flat fields } ] }
 */

export const FUNNEL_STANDARD_EVENTS = [
  "page_viewed",
  "product_viewed",
  "collection_viewed",
  "search_submitted",
  "product_added_to_cart",
  "product_removed_from_cart",
  "cart_viewed",
  "checkout_started",
  "checkout_contact_info_submitted",
  "checkout_address_info_submitted",
  "checkout_shipping_info_submitted",
  "payment_info_submitted",
  "checkout_completed",
  "alert_displayed",
  "ui_extension_errored",
] as const;

/** Custom events the theme publishes via `Shopify.analytics.publish(name, data)`. */
export const FUNNEL_CUSTOM_EVENTS = [
  "ab_upsell_assigned",
  "size_selected",
  "upsell_shown",
  "upsell_accepted",
  "upsell_skipped",
] as const;

const ALLOWED_EVENTS = new Set<string>([...FUNNEL_STANDARD_EVENTS, ...FUNNEL_CUSTOM_EVENTS]);

export const FUNNEL_MAX_EVENTS_PER_REQUEST = 25;
export const FUNNEL_MAX_BODY_BYTES = 64 * 1024;
const MAX_PROPS_BYTES = 2048;
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;
const MAX_PAST_SKEW_MS = 7 * 24 * 60 * 60 * 1000;
const PII_PROP_KEY = /email|phone|address|first_?name|last_?name|street|zip|postal|card/i;

export type FunnelEventRow = {
  eventId: string;
  eventName: string;
  occurredAt: Date;
  clientId: string | null;
  sessionId: string | null;
  checkoutToken: string | null;
  pagePath: string | null;
  landingPath: string | null;
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  productId: string | null;
  variantId: string | null;
  productTitle: string | null;
  variantTitle: string | null;
  price: number | null;
  quantity: number | null;
  itemCount: number | null;
  value: number | null;
  currency: string | null;
  discountAmount: number | null;
  shippingMethod: string | null;
  shippingType: string | null;
  shippingPrice: number | null;
  deliveryDescription: string | null;
  paymentType: string | null;
  paymentGateway: string | null;
  countryCode: string | null;
  zipPrefix: string | null;
  geoCountry: string | null;
  deviceType: string | null;
  os: string | null;
  browser: string | null;
  locale: string | null;
  webdriver: boolean | null;
  abVariant: string | null;
  alertType: string | null;
  alertTarget: string | null;
  alertMessage: string | null;
  isFirstOrder: boolean | null;
  props: Record<string, string | number | boolean | null> | null;
};

export type FunnelParseResult =
  | { ok: true; key: string; events: FunnelEventRow[]; dropped: number }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, max = 200): string | null {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (Math.abs(n) >= 1e10) return null;
  return Math.round(n * 100) / 100;
}

function int(v: unknown): number | null {
  const n = num(v);
  if (n === null || n < 0 || n > 100_000) return null;
  return Math.trunc(n);
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Path only: drops query string + hash (may carry tokens or PII). */
export function sanitizePath(v: unknown): string | null {
  const s = str(v, 500);
  if (!s) return null;
  let path = s;
  if (/^https?:\/\//i.test(s)) {
    try {
      path = new URL(s).pathname;
    } catch {
      return null;
    }
  }
  path = path.split(/[?#]/)[0] ?? "";
  if (!path.startsWith("/")) return null;
  return path.slice(0, 300);
}

function sanitizeHost(v: unknown): string | null {
  const s = str(v, 300);
  if (!s) return null;
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function countryCode(v: unknown): string | null {
  const s = str(v, 10)?.toUpperCase() ?? null;
  return s && /^[A-Z]{2}$/.test(s) ? s : null;
}

function zipPrefix(v: unknown): string | null {
  const s = str(v, 20);
  if (!s) return null;
  const cleaned = s.replace(/[^0-9A-Za-z]/g, "").slice(0, 2).toUpperCase();
  return cleaned || null;
}

function currency(v: unknown): string | null {
  const s = str(v, 10)?.toUpperCase() ?? null;
  return s && /^[A-Z]{3}$/.test(s) ? s : null;
}

function abVariant(v: unknown): string | null {
  const s = str(v, 20);
  return s && /^[A-Za-z0-9_-]+$/.test(s) ? s : null;
}

function sanitizeProps(v: unknown): FunnelEventRow["props"] {
  if (!isRecord(v)) return null;
  const out: Record<string, string | number | boolean | null> = {};
  let n = 0;
  for (const [k, raw] of Object.entries(v)) {
    if (n >= 30) break;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k) || PII_PROP_KEY.test(k)) continue;
    if (raw === null) out[k] = null;
    else if (typeof raw === "boolean") out[k] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) out[k] = raw;
    else if (typeof raw === "string") out[k] = raw.slice(0, 300);
    else if (Array.isArray(raw)) {
      const flat = raw
        .filter((x) => ["string", "number"].includes(typeof x))
        .slice(0, 20)
        .join(",");
      out[k] = flat.slice(0, 300);
    } else continue;
    n++;
  }
  if (n === 0) return null;
  return JSON.stringify(out).length > MAX_PROPS_BYTES ? null : out;
}

export function parseUserAgent(ua: string | null | undefined): {
  deviceType: string | null;
  os: string | null;
  browser: string | null;
} {
  const s = String(ua ?? "");
  if (!s) return { deviceType: null, os: null, browser: null };

  let deviceType = "desktop";
  if (/iPad|Tablet|PlayBook|Silk/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) {
    deviceType = "tablet";
  } else if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(s)) {
    deviceType = "mobile";
  }
  if (/bot|crawler|spider|HeadlessChrome|Lighthouse/i.test(s)) deviceType = "bot";

  let os = "other";
  if (/iPhone|iPad|iPod/i.test(s)) os = "ios";
  else if (/Android/i.test(s)) os = "android";
  else if (/Windows/i.test(s)) os = "windows";
  else if (/Mac OS X|Macintosh/i.test(s)) os = "macos";
  else if (/CrOS/i.test(s)) os = "chromeos";
  else if (/Linux/i.test(s)) os = "linux";

  let browser = "other";
  if (/Instagram/i.test(s)) browser = "instagram";
  else if (/FBAN|FBAV|FB_IAB/i.test(s)) browser = "facebook";
  else if (/TikTok|musical_ly|BytedanceWebview/i.test(s)) browser = "tiktok";
  else if (/Edg\//i.test(s)) browser = "edge";
  else if (/SamsungBrowser/i.test(s)) browser = "samsung";
  else if (/OPR\/|Opera/i.test(s)) browser = "opera";
  else if (/Firefox|FxiOS/i.test(s)) browser = "firefox";
  else if (/CriOS|Chrome/i.test(s)) browser = "chrome";
  else if (/Safari/i.test(s)) browser = "safari";

  return { deviceType, os, browser };
}

function parseTimestamp(v: unknown, now: number): Date {
  const s = str(v, 40);
  const t = s ? Date.parse(s) : NaN;
  if (!Number.isFinite(t) || t > now + MAX_FUTURE_SKEW_MS || t < now - MAX_PAST_SKEW_MS) {
    return new Date(now);
  }
  return new Date(t);
}

/** Returns null when the event is unusable (unknown name / missing id). */
export function normalizeFunnelEvent(raw: unknown, now = Date.now()): FunnelEventRow | null {
  if (!isRecord(raw)) return null;
  const eventName = str(raw.name, 64);
  if (!eventName || !ALLOWED_EVENTS.has(eventName)) return null;
  const eventId = str(raw.id, 100);
  if (!eventId) return null;

  const ua = parseUserAgent(str(raw.userAgent, 500));
  const webdriver = bool(raw.webdriver);

  return {
    eventId,
    eventName,
    occurredAt: parseTimestamp(raw.ts, now),
    clientId: str(raw.clientId, 100),
    sessionId: str(raw.sessionId, 100),
    checkoutToken: str(raw.checkoutToken, 100),
    pagePath: sanitizePath(raw.pagePath),
    landingPath: sanitizePath(raw.landingPath),
    referrerHost: sanitizeHost(raw.referrerHost),
    utmSource: str(raw.utmSource, 100),
    utmMedium: str(raw.utmMedium, 100),
    utmCampaign: str(raw.utmCampaign, 150),
    utmContent: str(raw.utmContent, 150),
    utmTerm: str(raw.utmTerm, 150),
    productId: str(raw.productId, 100),
    variantId: str(raw.variantId, 100),
    productTitle: str(raw.productTitle, 200),
    variantTitle: str(raw.variantTitle, 100),
    price: num(raw.price),
    quantity: int(raw.quantity),
    itemCount: int(raw.itemCount),
    value: num(raw.value),
    currency: currency(raw.currency),
    discountAmount: num(raw.discountAmount),
    shippingMethod: str(raw.shippingMethod, 150),
    shippingType: str(raw.shippingType, 30),
    shippingPrice: num(raw.shippingPrice),
    deliveryDescription: str(raw.deliveryDescription, 200),
    paymentType: str(raw.paymentType, 50),
    paymentGateway: str(raw.paymentGateway, 100),
    countryCode: countryCode(raw.countryCode),
    zipPrefix: zipPrefix(raw.zipPrefix),
    geoCountry: null,
    deviceType: webdriver ? "bot" : ua.deviceType,
    os: ua.os,
    browser: ua.browser,
    locale: str(raw.locale, 20),
    webdriver,
    abVariant: abVariant(raw.abVariant),
    alertType: str(raw.alertType, 50),
    alertTarget: str(raw.alertTarget, 200),
    alertMessage: str(raw.alertMessage, 300),
    isFirstOrder: bool(raw.isFirstOrder),
    props: sanitizeProps(raw.props),
  };
}

export function parseFunnelPayload(body: string, now = Date.now()): FunnelParseResult {
  if (!body) return { ok: false, error: "empty_body" };
  if (Buffer.byteLength(body, "utf8") > FUNNEL_MAX_BODY_BYTES) {
    return { ok: false, error: "body_too_large" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  if (!isRecord(parsed)) return { ok: false, error: "invalid_payload" };
  const key = typeof parsed.k === "string" ? parsed.k : "";
  if (!key) return { ok: false, error: "missing_key" };
  if (!Array.isArray(parsed.e) || parsed.e.length === 0) {
    return { ok: false, error: "missing_events" };
  }
  if (parsed.e.length > FUNNEL_MAX_EVENTS_PER_REQUEST) {
    return { ok: false, error: "too_many_events" };
  }
  const events: FunnelEventRow[] = [];
  for (const raw of parsed.e) {
    const row = normalizeFunnelEvent(raw, now);
    if (row) events.push(row);
  }
  return { ok: true, key, events, dropped: parsed.e.length - events.length };
}
