// Shopify custom pixel — resell-lausanne.ch first-party shadow tracking (Phase 1)
//
// THE single custom pixel of the store (replaces the funnel / GTM / Google-variant drafts).
// Phase 1 = observation only: events go to OUR endpoint (funnel_events table) and nowhere else.
// No Google / Meta / TikTok / Klaviyo calls, no third-party script, no cookies written.
// Simprosys (app pixel) stays the only sender to GA4 G-828PXC8REN / Google Ads AW-11152326139.
// See docs/tracking/TRACKING-PLAN.md (gates G1..G6) before adding any outbound destination.
//
// Install: Shopify Admin > Settings > Customer events > Add custom pixel > paste this file.
// Permission: "Required" + Analytics only (NOT marketing / sale of data). Then Save + Connect.
// Replace the two placeholders below before saving:
//   __FUNNEL_ENDPOINT__  e.g. https://solution.resell-lausanne.ch/api/track/funnel
//   __FUNNEL_TRACK_KEY__ same value as FUNNEL_TRACK_KEY on the server (public write key)
//
// Runs in Shopify's strict sandbox (iframe, Origin: null). Sends text/plain JSON with
// fetch({ mode: "no-cors", keepalive: true }) → no CORS preflight, response never read.
//
// Privacy: no email / phone / name / address. Only country code + first 2 chars of zip.
// Consent: events are dropped (not buffered) while init.customerPrivacy.analyticsProcessingAllowed
// is false; tracking resumes as soon as a visitorConsentCollected event grants analytics.
// With the "Analytics" permission, Shopify additionally does not load the pixel at all for
// visitors in consent-required regions until they accept analytics.
//
// Theme custom events (publish from theme JS with Shopify.analytics.publish(name, data)),
// see theme snippets/rs-ab.liquid + assets/product-size-selection-modal.js:
//   ab_assigned { experiment, variant }            (generic A/B engine, one per tracked experiment)
//   ab_upsell_assigned { variant }                 (legacy, = experiment "upsell")
//   rs_variant_selected { productId, variantId, size, lane, price, currency }  (size click)
//   size_selected { productId, variantId, size, lane: standard|express, price, currency }  (add to cart)
//   upsell_shown / upsell_accepted / upsell_skipped { productId, variantId, price, upsellType, ... }
//   flow_cart_opened { productId, variantId, size, lane }   (post_size_flow B lands on /cart)
//   flow_checkout_redirect { source, flow, upsell }        (modal / auto / cart page → checkout)
// Theme events also carry `ab` = "experiment:variant,..." (all experiments the visitor is in).
// Stored per event: ab_variant = sorted "experiment:variant,..." (session-sticky, localStorage).
//
// Reconciliation keys (docs/tracking/TRACKING-PLAN.md §7):
//   id (Shopify event.id = future event_id), clientId (Shopify client id), sessionId,
//   checkoutToken, orderId (checkout_completed → ShopifyOrder.shopifyOrderId / transaction_id),
//   click ids gclid/gbraid/wbraid/fbclid/ttclid/msclkid — read from the landing URL and kept
//   90 days in storefront localStorage ONLY while marketing consent is granted (wiped on revoke),
//   consentMarketing / consentSaleOfData snapshot on every event.

const ENDPOINT = "__FUNNEL_ENDPOINT__";
const TRACK_KEY = "__FUNNEL_TRACK_KEY__";
const PIXEL_VERSION = "2026-10-14.p1";
const CLICK_KEYS = ["gclid", "gbraid", "wbraid", "fbclid", "ttclid", "msclkid"];
const CLICK_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CLICK_STORE_KEY = "rl_clk";

const STANDARD_EVENTS = [
  "page_viewed",
  "product_viewed",
  "collection_viewed",
  "search_submitted",
  "product_added_to_cart",
  "cart_viewed",
  "checkout_started",
  "checkout_contact_info_submitted",
  "checkout_address_info_submitted",
  "checkout_shipping_info_submitted",
  "payment_info_submitted",
  "checkout_completed",
  "alert_displayed",
];
const CUSTOM_EVENTS = [
  "ab_assigned",
  "ab_upsell_assigned",
  "rs_variant_selected",
  "size_selected",
  "upsell_shown",
  "upsell_accepted",
  "upsell_skipped",
  "flow_cart_opened",
  "flow_checkout_redirect",
];
const AB_ID_RE = /^[a-z0-9_]{1,40}$/;
const AB_VARIANT_RE = /^[A-Za-z0-9_-]{1,20}$/;
const IMMEDIATE_EVENTS = new Set(["checkout_completed", "payment_info_submitted"]);
const EXPRESS_RE = /express|priority|prioritaire|24\s?h|next.?day|same.?day|a-post/i;
const MAX_BATCH = 20;
const FLUSH_DELAY_MS = 200;

// ---------- consent ----------
let analyticsAllowed = true;
let marketingAllowed = null;
let saleOfDataAllowed = null;
let clicks = null;
function applyConsent(cp) {
  if (!cp) return;
  if (typeof cp.analyticsProcessingAllowed === "boolean") analyticsAllowed = cp.analyticsProcessingAllowed;
  if (typeof cp.marketingAllowed === "boolean") marketingAllowed = cp.marketingAllowed;
  if (typeof cp.saleOfDataAllowed === "boolean") saleOfDataAllowed = cp.saleOfDataAllowed;
  if (marketingAllowed === false) {
    clicks = null;
    try {
      browser.localStorage.removeItem(CLICK_STORE_KEY);
    } catch (_) {}
  }
}
try {
  applyConsent(init && init.customerPrivacy);
} catch (_) {}
try {
  const privacyApi =
    (typeof customerPrivacy !== "undefined" && customerPrivacy) ||
    (typeof api !== "undefined" && api && api.customerPrivacy) ||
    null;
  if (privacyApi && typeof privacyApi.subscribe === "function") {
    privacyApi.subscribe("visitorConsentCollected", (event) => {
      applyConsent(event && event.customerPrivacy);
    });
  }
} catch (_) {}

// ---------- helpers ----------
function rid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
function shortId(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}
function amount(m) {
  return m && m.amount !== undefined && m.amount !== null ? Number(m.amount) : null;
}
function webdriverFlag() {
  try {
    if (typeof navigator === "undefined" || typeof navigator.webdriver !== "boolean") return null;
    return navigator.webdriver;
  } catch (_) {
    return null;
  }
}
async function storageGet(store, key) {
  try {
    return (await browser[store].getItem(key)) || null;
  } catch (_) {
    return null;
  }
}
async function storageSet(store, key, value) {
  try {
    await browser[store].setItem(key, value);
  } catch (_) {}
}

// ---------- A/B experiments map { experimentId: variant } ----------
function parseAbString(s) {
  const out = {};
  String(s || "")
    .split(",")
    .forEach((pair) => {
      const i = pair.indexOf(":");
      if (i <= 0) return;
      const id = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      if (AB_ID_RE.test(id) && AB_VARIANT_RE.test(v)) out[id] = v;
    });
  return out;
}
function abString(map) {
  return Object.keys(map || {})
    .sort()
    .map((id) => `${id}:${map[id]}`)
    .join(",");
}

// ---------- ad click ids (marketing consent only) ----------
const CLICK_RE = /^[A-Za-z0-9._~-]{6,300}$/;
async function getClicks(event) {
  if (marketingAllowed !== true) return null;
  if (!clicks) {
    clicks = {};
    const raw = await storageGet("localStorage", CLICK_STORE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.exp > Date.now()) clicks = parsed.ids || {};
      } catch (_) {}
    }
  }
  let params = null;
  try {
    params = new URLSearchParams((event.context.document.location || {}).search || "");
  } catch (_) {}
  const fresh = {};
  CLICK_KEYS.forEach((k) => {
    const v = params && params.get(k);
    if (v && CLICK_RE.test(v)) fresh[k] = v;
  });
  if (Object.keys(fresh).length) {
    // A new ad click replaces the previous attribution set (last click wins).
    clicks = fresh;
    await storageSet(
      "localStorage",
      CLICK_STORE_KEY,
      JSON.stringify({ ids: clicks, exp: Date.now() + CLICK_TTL_MS }),
    );
  }
  return clicks;
}

// Source inferred from the presence of a click id (no id value stored, so consent-neutral).
function inferredSource(p) {
  if (p("gclid") || p("gbraid") || p("wbraid")) return "google";
  if (p("fbclid")) return "meta";
  if (p("ttclid")) return "tiktok";
  if (p("msclkid")) return "bing";
  return null;
}

// ---------- session state (sessionStorage: sid + landing/utm; localStorage: ab map) ----------
let state = null;
async function getState(event) {
  if (state) return state;
  let sessionId = await storageGet("sessionStorage", "rl_funnel_sid");
  let landing = null;
  const raw = await storageGet("sessionStorage", "rl_funnel_landing");
  if (raw) {
    try {
      landing = JSON.parse(raw);
    } catch (_) {}
  }
  if (!sessionId) {
    sessionId = rid();
    await storageSet("sessionStorage", "rl_funnel_sid", sessionId);
  }
  if (!landing) {
    const doc = (event && event.context && event.context.document) || {};
    const loc = doc.location || {};
    let params = null;
    try {
      params = new URLSearchParams(loc.search || "");
    } catch (_) {}
    const p = (k) => (params && params.get(k)) || null;
    landing = {
      landingPath: loc.pathname || null,
      referrerHost: doc.referrer || null,
      utmSource: p("utm_source") || inferredSource(p),
      utmMedium:
        p("utm_medium") ||
        ({ google: "cpc", bing: "cpc", meta: "social", tiktok: "social" }[inferredSource(p)] || null),
      utmCampaign: p("utm_campaign"),
      utmContent: p("utm_content"),
      utmTerm: p("utm_term"),
    };
    await storageSet("sessionStorage", "rl_funnel_landing", JSON.stringify(landing));
  }
  let ab = {};
  const rawAb = await storageGet("localStorage", "rl_ab");
  if (rawAb) {
    try {
      ab = JSON.parse(rawAb) || {};
    } catch (_) {}
  } else {
    const legacy = await storageGet("localStorage", "rl_ab_upsell");
    if (legacy && AB_VARIANT_RE.test(legacy)) ab = { upsell: legacy };
  }
  state = { sessionId, landing, ab, webdriver: webdriverFlag() };
  return state;
}

// ---------- transport ----------
let queue = [];
let timer = null;
function postBatch(body) {
  try {
    fetch(ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      keepalive: true,
      credentials: "omit",
      headers: { "Content-Type": "text/plain" },
      body,
    }).catch(function () {
      try {
        browser.sendBeacon(ENDPOINT, body);
      } catch (_) {}
    });
  } catch (_) {}
}
function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  while (queue.length) {
    const batch = queue.splice(0, MAX_BATCH);
    postBatch(JSON.stringify({ k: TRACK_KEY, e: batch }));
  }
}
function enqueue(payload, immediate) {
  queue.push(payload);
  if (immediate || queue.length >= MAX_BATCH) return flush();
  if (!timer) timer = setTimeout(flush, FLUSH_DELAY_MS);
}

// ---------- field extraction ----------
function fromVariant(v) {
  if (!v) return {};
  return {
    variantId: shortId(v.id),
    productId: shortId(v.product && v.product.id),
    productTitle: (v.product && v.product.title) || null,
    variantTitle: v.title || null,
    price: amount(v.price),
    currency: (v.price && v.price.currencyCode) || null,
  };
}

function fromCheckout(c) {
  if (!c) return {};
  const lines = Array.isArray(c.lineItems) ? c.lineItems : [];
  const opt =
    (c.delivery && Array.isArray(c.delivery.selectedDeliveryOptions) && c.delivery.selectedDeliveryOptions[0]) ||
    null;
  const addr = c.shippingAddress || null;
  const tx = (Array.isArray(c.transactions) && c.transactions[0]) || null;
  const shippingMethod = (opt && opt.title) || null;
  const first = lines[0] && lines[0].variant;
  let isFirstOrder = null;
  if (c.order && c.order.customer && typeof c.order.customer.isFirstOrder === "boolean") {
    isFirstOrder = c.order.customer.isFirstOrder;
  }
  return {
    checkoutToken: c.token || null,
    orderId: c.order ? shortId(c.order.id) : null,
    value: amount(c.totalPrice),
    currency: c.currencyCode || (c.totalPrice && c.totalPrice.currencyCode) || null,
    discountAmount: amount(c.discountsAmount),
    itemCount: lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0) || null,
    productId: lines.length === 1 ? shortId(first && first.product && first.product.id) : null,
    variantId: lines.length === 1 ? shortId(first && first.id) : null,
    shippingMethod,
    shippingType: (opt && opt.type) || null,
    shippingPrice: amount(c.shippingLine && c.shippingLine.price) ?? amount(opt && opt.cost),
    deliveryDescription: (opt && opt.description) || null,
    paymentType: (tx && tx.paymentMethod && (tx.paymentMethod.type || tx.paymentMethod.name)) || null,
    paymentGateway: (tx && tx.gateway) || null,
    countryCode:
      (addr && addr.countryCode) ||
      (c.localization && c.localization.country && c.localization.country.isoCode) ||
      null,
    zipPrefix: addr && addr.zip ? String(addr.zip).slice(0, 2) : null,
    isFirstOrder,
    props: {
      express: shippingMethod ? EXPRESS_RE.test(shippingMethod) : null,
      variantIds: lines.map((l) => shortId(l.variant && l.variant.id)).filter(Boolean),
      orderId: c.order ? shortId(c.order.id) : null,
    },
  };
}

function extract(name, data) {
  data = data || {};
  switch (name) {
    case "product_viewed":
      return fromVariant(data.productVariant);
    case "product_added_to_cart": {
      const line = data.cartLine || {};
      return Object.assign(fromVariant(line.merchandise), {
        quantity: line.quantity || null,
        value: amount(line.cost && line.cost.totalAmount),
      });
    }
    case "cart_viewed": {
      const cart = data.cart || {};
      const total = cart.cost && cart.cost.totalAmount;
      return {
        itemCount: cart.totalQuantity || null,
        value: amount(total),
        currency: (total && total.currencyCode) || null,
      };
    }
    case "collection_viewed":
      return {
        props: {
          collectionId: shortId(data.collection && data.collection.id),
          collectionTitle: (data.collection && data.collection.title) || null,
        },
      };
    case "search_submitted":
      return {
        props: { query: ((data.searchResult && data.searchResult.query) || "").slice(0, 100) },
      };
    case "alert_displayed": {
      const a = data.alert || {};
      return Object.assign(fromCheckout(data.checkout), {
        alertType: a.type || null,
        alertTarget: a.target || null,
        alertMessage: a.value || null,
      });
    }
    default:
      return data.checkout ? fromCheckout(data.checkout) : {};
  }
}

function fromCustom(name, d) {
  d = d || {};
  const props = {};
  for (const k of Object.keys(d)) {
    if (!["productId", "variantId", "price", "currency", "ab"].includes(k)) props[k] = d[k];
  }
  // abFull: authoritative experiment set from the theme; abAssign: one experiment update.
  let abFull = null;
  let abAssign = null;
  if (typeof d.ab === "string" && d.ab) abFull = parseAbString(d.ab);
  if (name === "ab_assigned" && AB_ID_RE.test(String(d.experiment || "")) && AB_VARIANT_RE.test(String(d.variant || ""))) {
    abAssign = { [String(d.experiment)]: String(d.variant) };
  }
  if (name === "ab_upsell_assigned" && AB_VARIANT_RE.test(String(d.variant || ""))) {
    abAssign = { upsell: String(d.variant) };
  }
  return {
    productId: shortId(d.productId),
    variantId: shortId(d.variantId),
    price: d.price !== undefined && d.price !== null ? Number(d.price) : null,
    currency: d.currency || null,
    abFull,
    abAssign,
    props,
  };
}

// ---------- handler ----------
async function handle(event, fields) {
  if (!analyticsAllowed) return;
  const s = await getState(event);
  const { abFull, abAssign } = fields;
  delete fields.abFull;
  delete fields.abAssign;
  if (abFull || abAssign) {
    const next = Object.assign({}, abFull || s.ab, abAssign || {});
    if (abString(next) !== abString(s.ab)) {
      s.ab = next;
      await storageSet("localStorage", "rl_ab", JSON.stringify(next));
    }
  }
  const ctx = event.context || {};
  const nav = ctx.navigator || {};
  const loc = (ctx.document && ctx.document.location) || {};
  const ids = await getClicks(event);
  const payload = Object.assign(
    {
      id: event.id || rid(),
      name: event.name,
      ts: event.timestamp || new Date().toISOString(),
      clientId: event.clientId || null,
      sessionId: s.sessionId,
      pagePath: loc.pathname || null,
      userAgent: nav.userAgent || null,
      locale: nav.language || null,
      webdriver: s.webdriver,
      pixelVersion: PIXEL_VERSION,
      consentMarketing: marketingAllowed,
      consentSaleOfData: saleOfDataAllowed,
    },
    s.landing,
    ids || {},
    fields,
    { abVariant: abString(s.ab) || null },
  );
  enqueue(payload, IMMEDIATE_EVENTS.has(event.name));
}

// Top-level string literals — Shopify Admin static check ignores analytics.subscribe(name)
// when `name` is a variable (forEach / helper). Bulk subs + allowlists = same events as before.
const STANDARD_EVENT_SET = new Set(STANDARD_EVENTS);
const CUSTOM_EVENT_SET = new Set(CUSTOM_EVENTS);

analytics.subscribe("all_standard_events", function (event) {
  if (!STANDARD_EVENT_SET.has(event.name)) return;
  handle(event, extract(event.name, event.data)).catch(function () {});
});
analytics.subscribe("all_custom_events", function (event) {
  if (!CUSTOM_EVENT_SET.has(event.name)) return;
  handle(event, fromCustom(event.name, event.customData)).catch(function () {});
});
