// Shopify custom pixel — Google Tag Manager (resell-lausanne.ch)
//
// Pattern officiel Shopify : GTM chargé DANS le sandbox du pixel personnalisé, events Shopify
// (standard + custom du thème) poussés dans window.dataLayer au format GA4 ecommerce.
// Conteneur GTM à importer : docs/gtm-container-resell.json.
//
// Remplacer GTM_ID ci-dessous par l'id du conteneur (GTM-XXXXXXX = placeholder : GTM n'est
// pas chargé tant que l'id n'est pas remplacé ; le dataLayer est quand même alimenté).
//
// ── Split avec Simprosys (app pixel, G-828PXC8REN + AW-11152326139, Consent Mode) ─────────
// Vérifié (script Simprosys + réseau, 2026-10-14) — Simprosys envoie déjà :
//   GA4  : page_view, view_item, view_item_list, search, add_to_cart, view_cart, begin_checkout,
//          add_shipping_info, add_payment_info, purchase (+ scroll/user_engagement auto)
//   Ads  : remarketing page_view/view_item/view_item_list/view_search_results/add_to_cart/purchase
//          (items shopify_CH_<pid>_<vid>) + conversions purchase, add_to_cart, begin_checkout
// Simprosys n'utilise PAS de conteneur GTM (gtm_enabled: 0, gtm_container: "").
// Donc côté GTM (switch "Const - GTM ecommerce takeover" = false par défaut) seuls partent :
//   GA4 : view_item_variant (rs_variant_selected), size_selected, upsell_shown|accepted|skipped,
//         ab_assigned, flow_cart_opened, flow_checkout_redirect, add_contact_info,
//         add_address_info, checkout_error (alert_displayed)
//   Ads : remarketing view_item sur view_item_variant (taille choisie, id variante)
// Les events standard sont quand même poussés dans le dataLayer ; passer le switch à "true"
// dans GTM le jour où Simprosys est désactivé (sinon doublons GA4 + conversions Ads).
//
// ── Consentement ─────────────────────────────────────────────────────────────────────────
// Consent Mode v2 : défaut "denied" puis update depuis init.customerPrivacy et à chaque
// visitorConsentCollected : analytics_storage <- analyticsProcessingAllowed,
// ad_storage / ad_user_data / ad_personalization <- marketingAllowed.
// Les tags GTM exigent en plus analytics_storage (GA4) ou ad_storage (Ads).
// Permission Shopify recommandée : "Requis" + "Analytique" uniquement ; vente de données :
// "Qualifie comme vente de données" (remarketing Ads).
//
// ── Debug ────────────────────────────────────────────────────────────────────────────────
// Tag Assistant / GTM Preview ne voit pas le sandbox. Ouvrir la boutique avec ?rl_debug=1 :
// debug_mode=true est ajouté à tous les events (GA4 > Admin > DebugView) pour la session,
// et chaque push dataLayer est loggé dans la console (contexte iframe web-pixel).

const GTM_ID = "GTM-XXXXXXX";
const ITEM_PREFIX = "shopify_CH_";
const AB_ID_RE = /^[a-z0-9_]{1,40}$/;
const AB_VARIANT_RE = /^[A-Za-z0-9_-]{1,20}$/;
const MAX_LIST_ITEMS = 20;

// ---------- dataLayer + Consent Mode v2 (avant GTM) ----------
window.dataLayer = window.dataLayer || [];
function gtag() {
  window.dataLayer.push(arguments);
}

const privacyApi =
  (typeof customerPrivacy !== "undefined" && customerPrivacy) ||
  (typeof api !== "undefined" && api && api.customerPrivacy) ||
  null;

function consentState(cp) {
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
try {
  if (init && init.customerPrivacy) gtag("consent", "update", consentState(init.customerPrivacy));
} catch (_) {}
try {
  if (privacyApi && typeof privacyApi.subscribe === "function") {
    privacyApi.subscribe("visitorConsentCollected", (event) => {
      if (event && event.customerPrivacy) gtag("consent", "update", consentState(event.customerPrivacy));
    });
  }
} catch (_) {}

// ---------- page context (le sandbox a sa propre URL : forcer celle du storefront) ----------
function pageContext(ctx) {
  const doc = (ctx && ctx.document) || {};
  const loc = doc.location || {};
  return {
    page_location: loc.href || undefined,
    page_referrer: doc.referrer || undefined,
    page_title: doc.title || undefined,
  };
}
const initCtx = pageContext(init && init.context);

let debugMode = false;
try {
  debugMode = /[?&]rl_debug=1\b/.test((init.context.document.location.search || ""));
} catch (_) {}

window.dataLayer.push(Object.assign({ rs_pixel: "gtm" }, initCtx));

if (/^GTM-[A-Z0-9]+$/.test(GTM_ID) && GTM_ID !== "GTM-XXXXXXX") {
  window.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
  document.head.appendChild(s);
}

// ---------- helpers ----------
function shortId(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function amount(m) {
  return m && m.amount !== undefined && m.amount !== null ? num(m.amount) : undefined;
}
function itemId(pid, vid) {
  pid = shortId(pid);
  vid = shortId(vid);
  return /^\d+$/.test(pid) && /^\d+$/.test(vid) ? `${ITEM_PREFIX}${pid}_${vid}` : undefined;
}
function clean(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === "") delete o[k];
  return o;
}

function itemFromVariant(v, quantity, extra) {
  if (!v) return null;
  const p = v.product || {};
  const id = itemId(p.id, v.id);
  if (!id) return null;
  return clean(
    Object.assign(
      {
        item_id: id,
        item_name: p.title,
        item_brand: p.vendor,
        item_category: p.type,
        item_variant: v.title,
        price: amount(v.price),
        quantity: quantity || 1,
      },
      extra || {},
    ),
  );
}
function itemsFromLines(lines, key) {
  return (Array.isArray(lines) ? lines : [])
    .map((l) => itemFromVariant(l && l[key], l && l.quantity))
    .filter(Boolean);
}
function adsItems(items) {
  return items.map((i) => ({ id: i.item_id, google_business_vertical: "retail" }));
}

// ---------- A/B (même stockage que le pixel funnel : localStorage rl_ab) ----------
function parseAb(s) {
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
let abMap = null;
async function getAb() {
  if (abMap) return abMap;
  abMap = {};
  try {
    const raw = await browser.localStorage.getItem("rl_ab");
    if (raw) abMap = JSON.parse(raw) || {};
  } catch (_) {}
  try {
    if (!debugMode) debugMode = (await browser.sessionStorage.getItem("rl_debug")) === "1";
    else await browser.sessionStorage.setItem("rl_debug", "1");
  } catch (_) {}
  return abMap;
}
async function updateAb(next) {
  if (abString(next) === abString(abMap)) return;
  abMap = next;
  try {
    await browser.localStorage.setItem("rl_ab", JSON.stringify(next));
  } catch (_) {}
}

// ---------- push (sérialisé : l'ordre du dataLayer suit l'ordre des events Shopify) ----------
let chain = Promise.resolve();
function serial(fn) {
  chain = chain.then(fn).catch(() => {});
  return chain;
}
function push(eventName, params, ecommerce, event) {
  return serial(() => pushNow(eventName, params, ecommerce, event));
}
async function pushNow(eventName, params, ecommerce, event) {
  await getAb();
  const msg = Object.assign(
    { event: eventName, ab: abString(abMap) || undefined, debug_mode: debugMode || undefined },
    pageContext(event && event.context),
    params || {},
  );
  clean(msg);
  msg.ecommerce = ecommerce || null;
  window.dataLayer.push({ ecommerce: null });
  if (debugMode) console.log("[rl-gtm]", eventName, msg);
  window.dataLayer.push(msg);
}

function checkoutEcommerce(c) {
  c = c || {};
  const items = itemsFromLines(c.lineItems, "variant");
  const discount = (Array.isArray(c.discountApplications) ? c.discountApplications : [])
    .map((d) => d && d.title)
    .filter(Boolean)
    .join(",");
  return clean({
    currency: c.currencyCode || (c.totalPrice && c.totalPrice.currencyCode),
    value: amount(c.totalPrice),
    coupon: discount || undefined,
    items,
  });
}

// ---------- Shopify standard events ----------
analytics.subscribe("page_viewed", (event) => {
  push("page_view", {}, null, event).catch(() => {});
});

analytics.subscribe("product_viewed", (event) => {
  const v = event.data && event.data.productVariant;
  const item = itemFromVariant(v);
  const items = item ? [item] : [];
  push(
    "view_item",
    { ads_items: adsItems(items) },
    clean({ currency: v && v.price && v.price.currencyCode, value: amount(v && v.price), items }),
    event,
  ).catch(() => {});
});

analytics.subscribe("collection_viewed", (event) => {
  const col = (event.data && event.data.collection) || {};
  const items = (col.productVariants || [])
    .slice(0, MAX_LIST_ITEMS)
    .map((v, i) => itemFromVariant(v, 1, { index: i, item_list_name: col.title }))
    .filter(Boolean);
  push(
    "view_item_list",
    { ads_items: adsItems(items) },
    clean({ item_list_id: shortId(col.id) || undefined, item_list_name: col.title, items }),
    event,
  ).catch(() => {});
});

analytics.subscribe("search_submitted", (event) => {
  const r = (event.data && event.data.searchResult) || {};
  const items = (r.productVariants || []).slice(0, MAX_LIST_ITEMS).map((v) => itemFromVariant(v)).filter(Boolean);
  push("search", { search_term: String(r.query || "").slice(0, 100), ads_items: adsItems(items) }, null, event).catch(
    () => {},
  );
});

let lastAtcId = "";
analytics.subscribe("product_added_to_cart", (event) => {
  if (event.id && event.id === lastAtcId) return;
  lastAtcId = event.id || "";
  const line = (event.data && event.data.cartLine) || {};
  const item = itemFromVariant(line.merchandise, line.quantity);
  const items = item ? [item] : [];
  push(
    "add_to_cart",
    { ads_items: adsItems(items) },
    clean({
      currency: line.cost && line.cost.totalAmount && line.cost.totalAmount.currencyCode,
      value: amount(line.cost && line.cost.totalAmount),
      items,
    }),
    event,
  ).catch(() => {});
});

analytics.subscribe("cart_viewed", (event) => {
  const cart = (event.data && event.data.cart) || {};
  const total = cart.cost && cart.cost.totalAmount;
  const items = itemsFromLines(cart.lines, "merchandise");
  push(
    "view_cart",
    { ads_items: adsItems(items) },
    clean({ currency: total && total.currencyCode, value: amount(total), items }),
    event,
  ).catch(() => {});
});

analytics.subscribe("checkout_started", (event) => {
  const ec = checkoutEcommerce(event.data && event.data.checkout);
  push("begin_checkout", { ads_items: adsItems(ec.items || []) }, ec, event).catch(() => {});
});

analytics.subscribe("checkout_contact_info_submitted", (event) => {
  push("add_contact_info", {}, checkoutEcommerce(event.data && event.data.checkout), event).catch(() => {});
});

analytics.subscribe("checkout_address_info_submitted", (event) => {
  const c = (event.data && event.data.checkout) || {};
  const country = c.shippingAddress && c.shippingAddress.countryCode;
  push("add_address_info", { shipping_country: country }, checkoutEcommerce(c), event).catch(() => {});
});

analytics.subscribe("checkout_shipping_info_submitted", (event) => {
  const c = (event.data && event.data.checkout) || {};
  const opt = c.delivery && c.delivery.selectedDeliveryOptions && c.delivery.selectedDeliveryOptions[0];
  const ec = checkoutEcommerce(c);
  ec.shipping_tier = (opt && opt.title) || undefined;
  push("add_shipping_info", {}, clean(ec), event).catch(() => {});
});

analytics.subscribe("payment_info_submitted", (event) => {
  const c = (event.data && event.data.checkout) || {};
  const tx = (Array.isArray(c.transactions) && c.transactions[0]) || null;
  const ec = checkoutEcommerce(c);
  ec.payment_type = (tx && tx.paymentMethod && (tx.paymentMethod.name || tx.paymentMethod.type)) || undefined;
  push("add_payment_info", {}, clean(ec), event).catch(() => {});
});

analytics.subscribe("checkout_completed", (event) => {
  const c = (event.data && event.data.checkout) || {};
  const ec = checkoutEcommerce(c);
  ec.transaction_id = shortId(c.order && c.order.id) || c.token || undefined;
  ec.tax = amount(c.totalTax);
  ec.shipping = amount(c.shippingLine && c.shippingLine.price);
  push(
    "purchase",
    { transaction_id: ec.transaction_id, ads_items: adsItems(ec.items || []) },
    clean(ec),
    event,
  ).catch(() => {});
});

analytics.subscribe("alert_displayed", (event) => {
  const a = (event.data && event.data.alert) || {};
  push(
    "checkout_error",
    {
      error_type: a.type,
      error_target: a.target ? String(a.target).slice(0, 100) : undefined,
      error_message: a.value ? String(a.value).slice(0, 100) : undefined,
    },
    null,
    event,
  ).catch(() => {});
});

// ---------- theme custom events (Shopify.analytics.publish via window.rsAB.track) ----------
function customItem(d) {
  const id = itemId(d.productId, d.variantId);
  if (!id) return null;
  return clean({ item_id: id, item_variant: d.size, price: num(d.price), quantity: 1 });
}
function customParams(d) {
  return {
    product_id: shortId(d.productId) || undefined,
    variant_id: shortId(d.variantId) || undefined,
    item_id: itemId(d.productId, d.variantId),
    size: d.size !== undefined && d.size !== null ? String(d.size) : undefined,
    lane: d.lane,
    price: num(d.price),
    value: num(d.price),
    currency: d.currency || "CHF",
    source: d.source,
  };
}
async function syncAbFrom(name, d) {
  await getAb();
  let next = typeof d.ab === "string" && d.ab ? parseAb(d.ab) : Object.assign({}, abMap);
  if (name === "ab_assigned" && AB_ID_RE.test(String(d.experiment || "")) && AB_VARIANT_RE.test(String(d.variant || ""))) {
    next[String(d.experiment)] = String(d.variant);
  }
  if (name === "ab_upsell_assigned" && AB_VARIANT_RE.test(String(d.variant || ""))) next.upsell = String(d.variant);
  await updateAb(next);
}
function sub(name, handler) {
  analytics.subscribe(name, (event) => {
    const d = event.customData || {};
    serial(() => syncAbFrom(name, d).then(() => handler(d, event)));
  });
}

sub("ab_assigned", (d, event) =>
  pushNow("ab_assigned", { experiment: d.experiment, variant: d.variant }, null, event),
);
sub("ab_upsell_assigned", () => {});

let lastVariantKey = "";
sub("rs_variant_selected", (d, event) => {
  const key = `${shortId(d.variantId)}|${d.lane || ""}`;
  if (key === lastVariantKey) return;
  lastVariantKey = key;
  const item = customItem(d);
  const items = item ? [item] : [];
  return pushNow(
    "view_item_variant",
    Object.assign(customParams(d), { ads_items: adsItems(items) }),
    clean({ currency: d.currency || "CHF", value: num(d.price), items }),
    event,
  );
});

sub("size_selected", (d, event) => {
  const item = customItem(d);
  return pushNow(
    "size_selected",
    customParams(d),
    clean({ currency: d.currency || "CHF", value: num(d.price), items: item ? [item] : [] }),
    event,
  );
});

sub("upsell_shown", (d, event) => pushNow("upsell_shown", customParams(d), null, event));

sub("upsell_accepted", (d, event) => {
  const item = customItem(d);
  return pushNow(
    "upsell_accepted",
    Object.assign(customParams(d), {
      upsell_item: itemId(d.productId, d.variantId),
      upsell_type: d.upsellType,
      parent_product_id: shortId(d.parentProductId) || undefined,
    }),
    clean({ currency: d.currency || "CHF", value: num(d.price), items: item ? [item] : [] }),
    event,
  );
});

sub("upsell_skipped", (d, event) =>
  pushNow("upsell_skipped", Object.assign(customParams(d), { reason: d.reason }), null, event),
);

sub("flow_cart_opened", (d, event) => pushNow("flow_cart_opened", customParams(d), null, event));

sub("flow_checkout_redirect", (d, event) =>
  pushNow(
    "flow_checkout_redirect",
    { source: d.source, flow: d.flow, upsell_variant: d.upsell },
    null,
    event,
  ),
);
