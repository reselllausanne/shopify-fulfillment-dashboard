// Shopify custom pixel — funnel tracking (storefront + checkout) for resell-lausanne.ch
//
// Install: Shopify Admin > Settings > Customer events > Add custom pixel > paste this file.
// Permission: "Required" + Analytics only (NOT marketing / sale of data). Then Save + Connect.
// Replace the two placeholders below before saving:
//   __FUNNEL_ENDPOINT__  e.g. https://solutions.resell-lausanne.ch/api/track/funnel
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
// Theme custom events (publish from theme JS with Shopify.analytics.publish(name, data)):
//   ab_upsell_assigned { variant }, size_selected { productId, variantId, size },
//   upsell_shown / upsell_accepted / upsell_skipped { productId, variantId, price, ... }

const ENDPOINT = "__FUNNEL_ENDPOINT__";
const TRACK_KEY = "__FUNNEL_TRACK_KEY__";

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
  "ab_upsell_assigned",
  "size_selected",
  "upsell_shown",
  "upsell_accepted",
  "upsell_skipped",
];
const IMMEDIATE_EVENTS = new Set(["checkout_completed", "payment_info_submitted"]);
const EXPRESS_RE = /express|priority|prioritaire|24\s?h|next.?day|same.?day|a-post/i;
const MAX_BATCH = 20;
const FLUSH_DELAY_MS = 200;

// ---------- consent ----------
let analyticsAllowed = true;
try {
  const cp = init && init.customerPrivacy;
  if (cp && cp.analyticsProcessingAllowed === false) analyticsAllowed = false;
} catch (_) {}
try {
  const privacyApi =
    (typeof customerPrivacy !== "undefined" && customerPrivacy) ||
    (typeof api !== "undefined" && api && api.customerPrivacy) ||
    null;
  if (privacyApi && typeof privacyApi.subscribe === "function") {
    privacyApi.subscribe("visitorConsentCollected", (event) => {
      const cp = event && event.customerPrivacy;
      if (cp && typeof cp.analyticsProcessingAllowed === "boolean") {
        analyticsAllowed = cp.analyticsProcessingAllowed;
      }
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
    return typeof navigator !== "undefined" && typeof navigator.webdriver === "boolean"
      ? navigator.webdriver
      : null;
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

// ---------- session state (sessionStorage: sid + landing/utm; localStorage: ab variant) ----------
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
      utmSource: p("utm_source") || (p("gclid") ? "google" : null),
      utmMedium: p("utm_medium") || (p("gclid") ? "cpc" : null),
      utmCampaign: p("utm_campaign"),
      utmContent: p("utm_content"),
      utmTerm: p("utm_term"),
    };
    await storageSet("sessionStorage", "rl_funnel_landing", JSON.stringify(landing));
  }
  const abVariant = await storageGet("localStorage", "rl_ab_upsell");
  state = { sessionId, landing, abVariant, webdriver: webdriverFlag() };
  return state;
}

// ---------- transport ----------
let queue = [];
let timer = null;
function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  while (queue.length) {
    const batch = queue.splice(0, MAX_BATCH);
    const body = JSON.stringify({ k: TRACK_KEY, e: batch });
    try {
      fetch(ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        keepalive: true,
        credentials: "omit",
        headers: { "Content-Type": "text/plain" },
        body,
      }).catch(() => {
        try {
          browser.sendBeacon(ENDPOINT, body);
        } catch (_) {}
      });
    } catch (_) {}
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
  return {
    checkoutToken: c.token || null,
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
    isFirstOrder:
      c.order && c.order.customer && typeof c.order.customer.isFirstOrder === "boolean"
        ? c.order.customer.isFirstOrder
        : null,
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
    if (!["productId", "variantId", "price", "variant", "currency"].includes(k)) props[k] = d[k];
  }
  return {
    productId: shortId(d.productId),
    variantId: shortId(d.variantId),
    price: d.price !== undefined && d.price !== null ? Number(d.price) : null,
    currency: d.currency || null,
    abVariant: name === "ab_upsell_assigned" && d.variant ? String(d.variant) : undefined,
    props,
  };
}

// ---------- handler ----------
async function handle(event, fields) {
  if (!analyticsAllowed) return;
  const s = await getState(event);
  if (fields.abVariant) {
    s.abVariant = fields.abVariant;
    await storageSet("localStorage", "rl_ab_upsell", fields.abVariant);
  }
  const ctx = event.context || {};
  const nav = ctx.navigator || {};
  const loc = (ctx.document && ctx.document.location) || {};
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
    },
    s.landing,
    fields,
    { abVariant: s.abVariant || null },
  );
  enqueue(payload, IMMEDIATE_EVENTS.has(event.name));
}

STANDARD_EVENTS.forEach((name) => {
  analytics.subscribe(name, (event) => {
    handle(event, extract(name, event.data)).catch(() => {});
  });
});

CUSTOM_EVENTS.forEach((name) => {
  analytics.subscribe(name, (event) => {
    handle(event, fromCustom(name, event.customData)).catch(() => {});
  });
});
