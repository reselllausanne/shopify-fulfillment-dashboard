// Shopify custom pixel — Google Ads dynamic remarketing on size choice (resell-lausanne.ch)
//
// Pourquoi : le pixel Simprosys (AW-11152326139 / G-828PXC8REN) n'écoute que les events
// standard Shopify. product_viewed ne part qu'au chargement de la page ; choisir une taille
// dans la modale met à jour ?variant= sans rien envoyer à Google. Ce pixel envoie un
// view_item Google Ads pour la variante choisie (même format d'id que le flux Merchant
// Center : shopify_CH_<productId>_<variantId>).
//
// Source de l'event : thème, assets/product-size-selection-modal.js, au clic sur une taille :
//   Shopify.analytics.publish('rs_variant_selected',
//     { productId, variantId, size, lane: 'standard'|'express', price, currency })
// (price = prix affiché pour la voie choisie, en CHF ; express si la voie express est active).
// Le comportement "page sans ?variant" n'est pas modifié (Simprosys reste seul sur product_viewed).
//
// ── Installation (Shopify Admin) ─────────────────────────────────────────────────────────
// 1. Paramètres > Événements clients > Ajouter un pixel personnalisé.
//    Nom : "Google Ads – taille choisie (rs_variant_selected)".
// 2. Autorisations : "Requis" puis cocher UNIQUEMENT "Marketing"
//    (le pixel ne se charge pas sans consentement marketing dans les régions concernées).
//    Vente de données : "Qualifie comme vente de données" (remarketing publicitaire).
// 3. Coller ce fichier entier dans le champ Code, Enregistrer, puis "Connecter".
// 4. Vérifier : page produit > choisir une taille > Google Tag Assistant (ou Google Ads >
//    Outils > Audiences > source "Google Ads tag") : event view_item avec items[0].id =
//    shopify_CH_<pid>_<vid>. Côté Shopify : Événements clients > ce pixel > "Tester".
// Ne pas ajouter AW-11152326139 ailleurs dans le thème (doublon avec Simprosys).

const GOOGLE_ADS_ID = "AW-11152326139";
const ITEM_PREFIX = "shopify_CH_";

let marketingAllowed = true;
try {
  const cp = init && init.customerPrivacy;
  if (cp && cp.marketingAllowed === false) marketingAllowed = false;
} catch (_) {}

window.dataLayer = window.dataLayer || [];
function gtag() {
  window.dataLayer.push(arguments);
}

let gtagLoaded = false;
function loadGtag() {
  if (gtagLoaded || !marketingAllowed) return;
  gtagLoaded = true;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`;
  document.head.appendChild(script);
  gtag("consent", "default", {
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
    analytics_storage: "denied",
  });
  gtag("js", new Date());
  gtag("config", GOOGLE_ADS_ID, { send_page_view: false });
}

try {
  const privacyApi =
    (typeof customerPrivacy !== "undefined" && customerPrivacy) ||
    (typeof api !== "undefined" && api && api.customerPrivacy) ||
    null;
  if (privacyApi && typeof privacyApi.subscribe === "function") {
    privacyApi.subscribe("visitorConsentCollected", (event) => {
      const cp = event && event.customerPrivacy;
      if (cp && typeof cp.marketingAllowed === "boolean") {
        marketingAllowed = cp.marketingAllowed;
        if (marketingAllowed) loadGtag();
      }
    });
  }
} catch (_) {}

loadGtag();

function shortId(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

let lastSent = "";
analytics.subscribe("rs_variant_selected", (event) => {
  if (!marketingAllowed) return;
  const d = event.customData || {};
  const pid = shortId(d.productId);
  const vid = shortId(d.variantId);
  if (!/^\d+$/.test(pid) || !/^\d+$/.test(vid)) return;
  const key = `${vid}|${d.lane || ""}`;
  if (key === lastSent) return;
  lastSent = key;
  loadGtag();

  const value = Number(d.price);
  const loc = (event.context && event.context.document && event.context.document.location) || {};
  const params = {
    send_to: GOOGLE_ADS_ID,
    currency: d.currency || "CHF",
    items: [{ id: `${ITEM_PREFIX}${pid}_${vid}`, google_business_vertical: "retail" }],
  };
  if (Number.isFinite(value) && value > 0) params.value = value;
  if (loc.href) params.page_location = loc.href;
  gtag("event", "view_item", params);
});
