// Shopify custom pixel — resell-lausanne.ch (G1 funnel + G3 GA4 TEST via sGTM)
//
// THE single custom pixel of the store. Always POSTs to our funnel endpoint (G1).
// G3 (gate approved): loads web GTM → https://sgtm.resell-lausanne.ch → GA4 TEST property only.
// Simprosys stays the only sender to production GA4 G-828PXC8REN / Google Ads AW-11152326139.
// See docs/tracking/TRACKING-PLAN.md and docs/tracking/G3-RUNBOOK.md.
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
//   rs_variant_selected { productId, productHandle, variantId, sku, selectedSize, displayedPrice, ... }
//   rs_fulfillment_mode_selected { fulfillmentMode, previousMode, standardPrice, expressPrice, ... }
//   rs_cart_item_added { variantId, sku, fulfillmentMode, linePropertiesJson, displayedPrice, ... }
//   upsell_shown / upsell_accepted / upsell_skipped { productId, variantId, price, upsellType, ... }
//   flow_cart_opened { productId, variantId, size, lane }   (post_size_flow B lands on /cart)
//   flow_checkout_redirect { source, flow, upsell }        (modal / auto / cart page → checkout)
//   rs_collection_navigated { collectionHandle, collectionTitle, url, source } (AJAX collection nav)
//   rs_upsell_carousel_interacted { sourceComponent, interactionType, scrollDirection, visibleProductIds, ... }
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
const GTM_ID = "GTM-K9F6S5LN";
const PIXEL_VERSION = "2026-10-20.g3";
const GTM_ITEM_PREFIX = "shopify_CH_";
const GTM_MAX_LIST_ITEMS = 20;
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
  "rs_collection_navigated",
  "rs_fulfillment_mode_selected",
  "rs_cart_item_added",
  "rs_upsell_carousel_interacted",
];
const AB_ID_RE = /^[a-z0-9_]{1,40}$/;
const AB_VARIANT_RE = /^[A-Za-z0-9_-]{1,20}$/;
const IMMEDIATE_EVENTS = new Set(["checkout_completed", "payment_info_submitted", "cart_item_added"]);
const EXPRESS_RE = /express|priority|prioritaire|24\s?h|next.?day|same.?day|a-post/i;
const MAX_BATCH = 20;
const FLUSH_DELAY_MS = 200;

// ---------- consent (+ Consent Mode v2 for GTM / GA4 TEST) ----------
window.dataLayer = window.dataLayer || [];
function gtag() {
  window.dataLayer.push(arguments);
}
function gtmConsentState(cp) {
  const analytics = !!(cp && cp.analyticsProcessingAllowed);
  const marketing = !!(cp && cp.marketingAllowed);
  return {
    analytics_storage: analytics ? "granted" : "denied",
    ad_storage: marketing ? "granted" : "denied",
    ad_user_data: marketing ? "granted" : "denied",
    ad_personalization: marketing ? "granted" : "denied",
  };
}
gtag("consent", "default", {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  functionality_storage: "denied",
  personalization_storage: "denied",
  security_storage: "granted",
  wait_for_update: 500,
});
gtag("set", "ads_data_redaction", true);
gtag("set", "url_passthrough", true);

function gtmPageContext(ctx) {
  const doc = (ctx && ctx.document) || {};
  const loc = doc.location || {};
  return {
    page_location: loc.href || undefined,
    page_referrer: doc.referrer || undefined,
    page_title: doc.title || undefined,
  };
}
let gtmDebugMode = false;
try {
  gtmDebugMode = /[?&]rl_debug=1\b/.test((init.context.document.location.search || ""));
} catch (_) {}
try {
  window.dataLayer.push(Object.assign({ rs_pixel: "gtm" }, gtmPageContext(init && init.context)));
} catch (_) {}
const gtmLoad =
  /^GTM-[A-Z0-9]+$/.test(GTM_ID) && GTM_ID !== "GTM-XXXXXXX" && GTM_ID !== "GTM-PLACEHOLDER";
if (gtmLoad) {
  window.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
  const gtmScript = document.createElement("script");
  gtmScript.async = true;
  gtmScript.src = "https://www.googletagmanager.com/gtm.js?id=" + GTM_ID;
  document.head.appendChild(gtmScript);
}

let analyticsAllowed = true;
let marketingAllowed = null;
let saleOfDataAllowed = null;
let clicks = null;
function applyConsent(cp) {
  if (!cp) return;
  if (typeof cp.analyticsProcessingAllowed === "boolean") analyticsAllowed = cp.analyticsProcessingAllowed;
  if (typeof cp.marketingAllowed === "boolean") marketingAllowed = cp.marketingAllowed;
  if (typeof cp.saleOfDataAllowed === "boolean") saleOfDataAllowed = cp.saleOfDataAllowed;
  try {
    gtag("consent", "update", gtmConsentState(cp));
  } catch (_) {}
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
function optionalNumber(v) {
  if (v === undefined || v === null) return null;
  return Number(v);
}
function parseOptionalPrice(d) {
  if (d.displayedPrice !== undefined && d.displayedPrice !== null) return Number(d.displayedPrice);
  if (d.price !== undefined && d.price !== null) return Number(d.price);
  return null;
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
    if (
      ![
        "productId",
        "variantId",
        "productTitle",
        "variantTitle",
        "price",
        "displayedPrice",
        "quantity",
        "currency",
        "ab",
        "url",
      ].includes(k)
    ) {
      props[k] = d[k];
    }
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
  const fields = {
    productId: shortId(d.productId),
    variantId: shortId(d.variantId),
    productTitle: d.productTitle || null,
    variantTitle: d.variantTitle || null,
    price: parseOptionalPrice(d),
    quantity: optionalNumber(d.quantity),
    currency: d.currency || null,
    abFull,
    abAssign,
    props,
  };
  if (name === "rs_collection_navigated") fields.pagePath = d.url || null;
  return fields;
}

// ---------- handler ----------
async function handle(event, fields, eventName) {
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
      name: eventName || event.name,
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
  enqueue(payload, IMMEDIATE_EVENTS.has(eventName || event.name));
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
  const name =
    {
      rs_collection_navigated: "collection_navigated",
      rs_variant_selected: "variant_selected",
      rs_fulfillment_mode_selected: "fulfillment_mode_selected",
      rs_cart_item_added: "cart_item_added",
      rs_upsell_carousel_interacted: "upsell_carousel_interacted",
    }[event.name] || event.name;
  handle(event, fromCustom(event.name, event.customData), name).catch(function () {});
});

// ---------- G3: dataLayer (GA4 TEST via web GTM → sGTM). Tag Assistant cannot see this sandbox. ----------
if (gtmLoad) {
  function gtmSid(v) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  }
  function gtmNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  function gtmAmount(m) {
    return m && m.amount !== undefined && m.amount !== null ? gtmNum(m.amount) : undefined;
  }
  function gtmItemId(pid, vid) {
    pid = gtmSid(pid);
    vid = gtmSid(vid);
    return /^\d+$/.test(pid) && /^\d+$/.test(vid) ? GTM_ITEM_PREFIX + pid + "_" + vid : undefined;
  }
  function gtmClean(o) {
    for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === "") delete o[k];
    return o;
  }
  function gtmItemFromVariant(v, quantity, extra) {
    if (!v) return null;
    const p = v.product || {};
    const id = gtmItemId(p.id, v.id);
    if (!id) return null;
    return gtmClean(
      Object.assign(
        {
          item_id: id,
          item_name: p.title,
          item_brand: p.vendor,
          item_category: p.type,
          item_variant: v.title,
          price: gtmAmount(v.price),
          quantity: quantity || 1,
        },
        extra || {},
      ),
    );
  }
  function gtmItemsFromLines(lines, key) {
    return (Array.isArray(lines) ? lines : [])
      .map(function (l) {
        return gtmItemFromVariant(l && l[key], l && l.quantity);
      })
      .filter(Boolean);
  }
  function gtmAdsItems(items) {
    return items.map(function (i) {
      return { id: i.item_id, google_business_vertical: "retail" };
    });
  }
  let gtmAbMap = null;
  async function gtmGetAb() {
    if (gtmAbMap) return gtmAbMap;
    gtmAbMap = {};
    try {
      const raw = await browser.localStorage.getItem("rl_ab");
      if (raw) gtmAbMap = JSON.parse(raw) || {};
    } catch (_) {}
    try {
      if (!gtmDebugMode) gtmDebugMode = (await browser.sessionStorage.getItem("rl_debug")) === "1";
      else await browser.sessionStorage.setItem("rl_debug", "1");
    } catch (_) {}
    return gtmAbMap;
  }
  async function gtmUpdateAb(next) {
    if (abString(next) === abString(gtmAbMap)) return;
    gtmAbMap = next;
    try {
      await browser.localStorage.setItem("rl_ab", JSON.stringify(next));
    } catch (_) {}
  }
  let gtmChain = Promise.resolve();
  function gtmSerial(fn) {
    gtmChain = gtmChain.then(fn).catch(function () {});
    return gtmChain;
  }
  function gtmPush(eventName, params, ecommerce, event) {
    return gtmSerial(function () {
      return gtmPushNow(eventName, params, ecommerce, event);
    });
  }
  async function gtmPushNow(eventName, params, ecommerce, event) {
    if (!analyticsAllowed) return;
    await gtmGetAb();
    const msg = Object.assign(
      { event: eventName, ab: abString(gtmAbMap) || undefined, debug_mode: gtmDebugMode || undefined },
      gtmPageContext(event && event.context),
      params || {},
    );
    gtmClean(msg);
    msg.ecommerce = ecommerce || null;
    window.dataLayer.push({ ecommerce: null });
    if (gtmDebugMode) console.log("[rl-gtm]", eventName, msg);
    window.dataLayer.push(msg);
  }
  function gtmCheckoutEcommerce(c) {
    c = c || {};
    const items = gtmItemsFromLines(c.lineItems, "variant");
    const discount = (Array.isArray(c.discountApplications) ? c.discountApplications : [])
      .map(function (d) {
        return d && d.title;
      })
      .filter(Boolean)
      .join(",");
    return gtmClean({
      currency: c.currencyCode || (c.totalPrice && c.totalPrice.currencyCode),
      value: gtmAmount(c.totalPrice),
      coupon: discount || undefined,
      items: items,
    });
  }
  function gtmCustomItem(d) {
    const id = gtmItemId(d.productId, d.variantId);
    if (!id) return null;
    return gtmClean({ item_id: id, item_variant: d.size, price: gtmNum(d.price), quantity: 1 });
  }
  function gtmCustomParams(d) {
    return {
      product_id: gtmSid(d.productId) || undefined,
      variant_id: gtmSid(d.variantId) || undefined,
      item_id: gtmItemId(d.productId, d.variantId),
      size: d.size !== undefined && d.size !== null ? String(d.size) : undefined,
      lane: d.lane,
      price: gtmNum(d.price),
      value: gtmNum(d.price),
      currency: d.currency || "CHF",
      source: d.source,
    };
  }
  async function gtmSyncAbFrom(name, d) {
    await gtmGetAb();
    let next = typeof d.ab === "string" && d.ab ? parseAbString(d.ab) : Object.assign({}, gtmAbMap);
    if (
      name === "ab_assigned" &&
      AB_ID_RE.test(String(d.experiment || "")) &&
      AB_VARIANT_RE.test(String(d.variant || ""))
    ) {
      next[String(d.experiment)] = String(d.variant);
    }
    if (name === "ab_upsell_assigned" && AB_VARIANT_RE.test(String(d.variant || ""))) next.upsell = String(d.variant);
    await gtmUpdateAb(next);
  }
  function gtmSub(name, handler) {
    analytics.subscribe(name, function (event) {
      const d = event.customData || {};
      gtmSerial(function () {
        return gtmSyncAbFrom(name, d).then(function () {
          return handler(d, event);
        });
      });
    });
  }

  analytics.subscribe("page_viewed", function (event) {
    gtmPush("page_view", {}, null, event).catch(function () {});
  });
  analytics.subscribe("product_viewed", function (event) {
    const v = event.data && event.data.productVariant;
    const item = gtmItemFromVariant(v);
    const items = item ? [item] : [];
    gtmPush(
      "view_item",
      { ads_items: gtmAdsItems(items) },
      gtmClean({ currency: v && v.price && v.price.currencyCode, value: gtmAmount(v && v.price), items: items }),
      event,
    ).catch(function () {});
  });
  analytics.subscribe("collection_viewed", function (event) {
    const col = (event.data && event.data.collection) || {};
    const items = (col.productVariants || [])
      .slice(0, GTM_MAX_LIST_ITEMS)
      .map(function (v, i) {
        return gtmItemFromVariant(v, 1, { index: i, item_list_name: col.title });
      })
      .filter(Boolean);
    gtmPush(
      "view_item_list",
      { ads_items: gtmAdsItems(items) },
      gtmClean({ item_list_id: gtmSid(col.id) || undefined, item_list_name: col.title, items: items }),
      event,
    ).catch(function () {});
  });
  analytics.subscribe("search_submitted", function (event) {
    const r = (event.data && event.data.searchResult) || {};
    const items = (r.productVariants || [])
      .slice(0, GTM_MAX_LIST_ITEMS)
      .map(function (v) {
        return gtmItemFromVariant(v);
      })
      .filter(Boolean);
    gtmPush(
      "search",
      { search_term: String(r.query || "").slice(0, 100), ads_items: gtmAdsItems(items) },
      null,
      event,
    ).catch(function () {});
  });
  let gtmLastAtcId = "";
  analytics.subscribe("product_added_to_cart", function (event) {
    if (event.id && event.id === gtmLastAtcId) return;
    gtmLastAtcId = event.id || "";
    const line = (event.data && event.data.cartLine) || {};
    const item = gtmItemFromVariant(line.merchandise, line.quantity);
    const items = item ? [item] : [];
    gtmPush(
      "add_to_cart",
      { ads_items: gtmAdsItems(items) },
      gtmClean({
        currency: line.cost && line.cost.totalAmount && line.cost.totalAmount.currencyCode,
        value: gtmAmount(line.cost && line.cost.totalAmount),
        items: items,
      }),
      event,
    ).catch(function () {});
  });
  analytics.subscribe("cart_viewed", function (event) {
    const cart = (event.data && event.data.cart) || {};
    const total = cart.cost && cart.cost.totalAmount;
    const items = gtmItemsFromLines(cart.lines, "merchandise");
    gtmPush(
      "view_cart",
      { ads_items: gtmAdsItems(items) },
      gtmClean({ currency: total && total.currencyCode, value: gtmAmount(total), items: items }),
      event,
    ).catch(function () {});
  });
  analytics.subscribe("checkout_started", function (event) {
    const ec = gtmCheckoutEcommerce(event.data && event.data.checkout);
    gtmPush("begin_checkout", { ads_items: gtmAdsItems(ec.items || []) }, ec, event).catch(function () {});
  });
  analytics.subscribe("checkout_contact_info_submitted", function (event) {
    gtmPush("add_contact_info", {}, gtmCheckoutEcommerce(event.data && event.data.checkout), event).catch(function () {});
  });
  analytics.subscribe("checkout_address_info_submitted", function (event) {
    const c = (event.data && event.data.checkout) || {};
    const country = c.shippingAddress && c.shippingAddress.countryCode;
    gtmPush("add_address_info", { shipping_country: country }, gtmCheckoutEcommerce(c), event).catch(function () {});
  });
  analytics.subscribe("checkout_shipping_info_submitted", function (event) {
    const c = (event.data && event.data.checkout) || {};
    const opt = c.delivery && c.delivery.selectedDeliveryOptions && c.delivery.selectedDeliveryOptions[0];
    const ec = gtmCheckoutEcommerce(c);
    ec.shipping_tier = (opt && opt.title) || undefined;
    gtmPush("add_shipping_info", {}, gtmClean(ec), event).catch(function () {});
  });
  analytics.subscribe("payment_info_submitted", function (event) {
    const c = (event.data && event.data.checkout) || {};
    const tx = (Array.isArray(c.transactions) && c.transactions[0]) || null;
    const ec = gtmCheckoutEcommerce(c);
    ec.payment_type = (tx && tx.paymentMethod && (tx.paymentMethod.name || tx.paymentMethod.type)) || undefined;
    gtmPush("add_payment_info", {}, gtmClean(ec), event).catch(function () {});
  });
  analytics.subscribe("checkout_completed", function (event) {
    const c = (event.data && event.data.checkout) || {};
    const ec = gtmCheckoutEcommerce(c);
    ec.transaction_id = gtmSid(c.order && c.order.id) || c.token || undefined;
    ec.tax = gtmAmount(c.totalTax);
    ec.shipping = gtmAmount(c.shippingLine && c.shippingLine.price);
    gtmPush(
      "purchase",
      { transaction_id: ec.transaction_id, ads_items: gtmAdsItems(ec.items || []) },
      gtmClean(ec),
      event,
    ).catch(function () {});
  });
  analytics.subscribe("alert_displayed", function (event) {
    const a = (event.data && event.data.alert) || {};
    gtmPush(
      "checkout_error",
      {
        error_type: a.type,
        error_target: a.target ? String(a.target).slice(0, 100) : undefined,
        error_message: a.value ? String(a.value).slice(0, 100) : undefined,
      },
      null,
      event,
    ).catch(function () {});
  });

  gtmSub("ab_assigned", function (d, event) {
    return gtmPushNow("ab_assigned", { experiment: d.experiment, variant: d.variant }, null, event);
  });
  gtmSub("ab_upsell_assigned", function () {});
  let gtmLastVariantKey = "";
  gtmSub("rs_variant_selected", function (d, event) {
    const key = gtmSid(d.variantId) + "|" + (d.lane || "");
    if (key === gtmLastVariantKey) return;
    gtmLastVariantKey = key;
    const item = gtmCustomItem(d);
    const items = item ? [item] : [];
    return gtmPushNow(
      "view_item_variant",
      Object.assign(gtmCustomParams(d), { ads_items: gtmAdsItems(items) }),
      gtmClean({ currency: d.currency || "CHF", value: gtmNum(d.price), items: items }),
      event,
    );
  });
  gtmSub("size_selected", function (d, event) {
    const item = gtmCustomItem(d);
    return gtmPushNow(
      "size_selected",
      gtmCustomParams(d),
      gtmClean({ currency: d.currency || "CHF", value: gtmNum(d.price), items: item ? [item] : [] }),
      event,
    );
  });
  gtmSub("upsell_shown", function (d, event) {
    return gtmPushNow("upsell_shown", gtmCustomParams(d), null, event);
  });
  gtmSub("upsell_accepted", function (d, event) {
    const item = gtmCustomItem(d);
    return gtmPushNow(
      "upsell_accepted",
      Object.assign(gtmCustomParams(d), {
        upsell_item: gtmItemId(d.productId, d.variantId),
        upsell_type: d.upsellType,
        parent_product_id: gtmSid(d.parentProductId) || undefined,
      }),
      gtmClean({ currency: d.currency || "CHF", value: gtmNum(d.price), items: item ? [item] : [] }),
      event,
    );
  });
  gtmSub("upsell_skipped", function (d, event) {
    return gtmPushNow("upsell_skipped", Object.assign(gtmCustomParams(d), { reason: d.reason }), null, event);
  });
  gtmSub("flow_cart_opened", function (d, event) {
    return gtmPushNow("flow_cart_opened", gtmCustomParams(d), null, event);
  });
  gtmSub("flow_checkout_redirect", function (d, event) {
    return gtmPushNow(
      "flow_checkout_redirect",
      { source: d.source, flow: d.flow, upsell_variant: d.upsell },
      null,
      event,
    );
  });
  gtmSub("rs_collection_navigated", function (d, event) {
    return gtmPushNow(
      "collection_navigated",
      {
        collection_handle: d.collectionHandle,
        collection_title: d.collectionTitle,
        page_location: d.url,
        source: d.source,
      },
      null,
      event,
    );
  });
  gtmSub("rs_fulfillment_mode_selected", function (d, event) {
    return gtmPushNow(
      "fulfillment_mode_selected",
      {
        fulfillment_mode: d.fulfillmentMode,
        previous_mode: d.previousMode,
        standard_price: gtmNum(d.standardPrice),
        express_price: gtmNum(d.expressPrice),
      },
      null,
      event,
    );
  });
  gtmSub("rs_cart_item_added", function (d, event) {
    const item = gtmCustomItem(d);
    const items = item ? [item] : [];
    return gtmPushNow(
      "cart_item_added",
      Object.assign(gtmCustomParams(d), {
        sku: d.sku,
        fulfillment_mode: d.fulfillmentMode,
        ads_items: gtmAdsItems(items),
      }),
      gtmClean({ currency: d.currency || "CHF", value: gtmNum(d.displayedPrice || d.price), items: items }),
      event,
    );
  });
  gtmSub("rs_upsell_carousel_interacted", function (d, event) {
    return gtmPushNow(
      "upsell_carousel_interacted",
      {
        source_component: d.sourceComponent,
        interaction_type: d.interactionType,
        scroll_direction: d.scrollDirection,
        visible_product_ids: d.visibleProductIds,
      },
      null,
      event,
    );
  });
}
