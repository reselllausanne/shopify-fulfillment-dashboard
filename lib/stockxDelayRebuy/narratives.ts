import type { MailLanguage } from "@/app/lib/mailer/language";
import { formatMailDate } from "@/lib/stockxDelayRebuy/eta";
import type { DelayNarrativeKind, DelayRebuyCase } from "@/lib/stockxDelayRebuy/types";

export type DelayMailChrome = {
  lang: MailLanguage;
  steps: [string, string, string, string];
  topNote: string;
  orderWord: string;
  etaLabel: string;
  styleId: string;
  size: string;
  orderNumber: string;
  shipping: string;
  price: string;
  nextTitle: string;
  faqIntro: string;
  faqLink: string;
  faqUrl: string;
  rights: string;
  sender: string;
  help: string;
  standard: string;
  express: string;
  dateToConfirm: string;
  etaPrefix: string;
  product: string;
  status: string;
};

const CHROME: Record<MailLanguage, DelayMailChrome> = {
  fr: {
    lang: "fr",
    steps: [
      "Commande confirmée",
      "Authentification en cours",
      "Préparation expédition",
      "Expédiée via La Poste",
    ],
    topNote: "Mise à jour de ta commande.",
    orderWord: "Commande",
    etaLabel: "Livraison",
    styleId: "ID de style",
    size: "Taille",
    orderNumber: "Numéro de commande",
    shipping: "Livraison",
    price: "Prix",
    nextTitle: "Et ensuite",
    faqIntro: "FAQ, délais et retours :",
    faqLink: "Voir la page d'aide",
    faqUrl: "https://www.resell-lausanne.ch/pages/faq",
    rights: "Tous droits réservés.",
    sender: "Expéditeur : Resell Lausanne, Chemin de Bas de Plan 6, 1030 Bussigny, Suisse.",
    help: "Besoin d'aide ?",
    standard: "Standard",
    express: "Prioritaire",
    dateToConfirm: "Date à confirmer",
    etaPrefix: "Arrivée estimée",
    product: "Produit",
    status: "Statut",
  },
  de: {
    lang: "de",
    steps: [
      "Bestellung bestätigt",
      "Authentifizierung läuft",
      "Versand wird vorbereitet",
      "Unterwegs mit der Schweizerischen Post",
    ],
    topNote: "Update zu deiner Bestellung.",
    orderWord: "Bestellung",
    etaLabel: "Lieferung",
    styleId: "Style-ID",
    size: "Grösse",
    orderNumber: "Bestellnummer",
    shipping: "Lieferung",
    price: "Preis",
    nextTitle: "Wie weiter",
    faqIntro: "FAQ, Fristen und Retouren:",
    faqLink: "Hilfe-Seite öffnen",
    faqUrl: "https://www.resell-lausanne.ch/de/pages/faq",
    rights: "Alle Rechte vorbehalten.",
    sender: "Absender: Resell Lausanne, Chemin de Bas de Plan 6, 1030 Bussigny, Schweiz.",
    help: "Brauchst du Hilfe?",
    standard: "Standard",
    express: "Priorität",
    dateToConfirm: "Datum folgt",
    etaPrefix: "Voraussichtliche Ankunft",
    product: "Produkt",
    status: "Status",
  },
  en: {
    lang: "en",
    steps: [
      "Order confirmed",
      "Authentication in progress",
      "Preparing shipment",
      "Shipped via Swiss Post",
    ],
    topNote: "Update on your order.",
    orderWord: "Order",
    etaLabel: "Delivery",
    styleId: "Style ID",
    size: "Size",
    orderNumber: "Order number",
    shipping: "Delivery",
    price: "Price",
    nextTitle: "What happens next",
    faqIntro: "FAQ, delays and returns:",
    faqLink: "Open help page",
    faqUrl: "https://www.resell-lausanne.ch/en/pages/faq",
    rights: "All rights reserved.",
    sender: "Sender: Resell Lausanne, Chemin de Bas de Plan 6, 1030 Bussigny, Switzerland.",
    help: "Need help?",
    standard: "Standard",
    express: "Priority",
    dateToConfirm: "Date to be confirmed",
    etaPrefix: "Estimated arrival",
    product: "Product",
    status: "Status",
  },
};

export function delayMailChrome(language: MailLanguage = "fr"): DelayMailChrome {
  return CHROME[language];
}

export type CustomerNarrative = {
  kind: DelayNarrativeKind;
  language: MailLanguage;
  chrome: DelayMailChrome;
  subject: string;
  /** Short status title. Sits above the ETA band, not inside a paragraph. */
  headline: string;
  /** One sentence under the title. Never the full apology. */
  statusLine: string;
  greeting: string;
  /** Two short paragraphs under the order summary. */
  bodyParagraphs: string[];
  nextLines: string[];
  activeStepLabel: string;
  etaLabel: string;
  etaLine: string;
  /** Standard or Prioritaire — order-summary row, not prose. */
  shippingLabel: string;
};

function greeting(name: string, language: MailLanguage): string {
  if (language === "de") return name ? `Hallo ${name},` : "Hallo,";
  if (language === "en") return name ? `Hi ${name},` : "Hi,";
  return name ? `Bonjour ${name},` : "Bonjour,";
}

/** Client-facing copy. Never mention StockX. Delay warning does not claim a new purchase. */
export function buildCustomerNarrative(
  c: DelayRebuyCase,
  kind: DelayNarrativeKind,
  language: MailLanguage = "fr"
): CustomerNarrative {
  const chrome = delayMailChrome(language);
  const name = (c.customerFirstName || "").trim();
  const hello = greeting(name, language);
  const shippingLabel = c.rebuyLane === "EXPRESS" ? chrome.express : chrome.standard;
  const rebuyEtaRange = `${formatMailDate(c.rebuyEtaStart, language)} – ${formatMailDate(c.rebuyEtaEnd, language)}`;

  if (kind === "SUPPLIER_CHANGE_DELAY" || kind === "ORDER_CANCELED") {
    const canceled = kind === "ORDER_CANCELED";
    const copy = canceled
      ? language === "de"
        ? {
            subject: `Bestellung ${c.shopifyOrderName} — Aktualisierung`,
            headline: "Es tut uns leid",
            statusLine: "Der Verkäufer konnte Ihren Artikel nicht versenden.",
            eta: "Neues Datum folgt",
            body: [
              "Wir haben die Bestellung bei diesem Verkäufer storniert und suchen einen neuen Verkäufer für denselben Artikel in derselben Grösse.",
              "Finden wir einen, schreiben wir Ihnen mit dem aktualisierten Lieferdatum. Andernfalls erhalten Sie eine volle Rückerstattung auf Ihr ursprüngliches Zahlungsmittel. Sie müssen nichts unternehmen.",
            ],
            next: ["Sie müssen nichts unternehmen."],
          }
        : language === "en"
          ? {
              subject: `Order ${c.shopifyOrderName} — update`,
              headline: "We're sorry",
              statusLine: "The seller was unable to ship your item.",
              eta: "New date to follow",
              body: [
                "We've canceled the order with that seller and we're looking for a new one for the same item and size.",
                "If we find a match, we'll email you with an updated delivery estimate. If we can't, you'll receive a full refund to your original payment method. You don't need to do anything.",
              ],
              next: ["You don't need to do anything."],
            }
          : {
              subject: `Commande ${c.shopifyOrderName} — mise à jour`,
              headline: "Nous sommes désolés",
              statusLine: "Le vendeur n'a pas pu expédier votre article.",
              eta: "Nouvelle estimation à venir",
              body: [
                "Nous avons annulé la commande auprès de ce vendeur. Nous recherchons un nouveau vendeur pour le même article, dans la même taille.",
                "Si nous en trouvons un, nous vous écrivons avec la date de livraison mise à jour. Si nous n'en trouvons pas, vous recevrez un remboursement intégral sur votre moyen de paiement d'origine. Vous n'avez rien à faire.",
              ],
              next: ["Vous n'avez rien à faire."],
            }
      : language === "de"
        ? {
            subject: `Bestellung ${c.shopifyOrderName} — dauert länger als erwartet`,
            headline: "Länger als erwartet",
            statusLine: "Der Verkäufer hat Ihren Artikel noch nicht versendet.",
            eta: "Kann sich ändern",
            body: [
              "Ihre Bestellung dauert länger als erwartet. Wir kümmern uns darum und schreiben Ihnen, falls sich das voraussichtliche Lieferdatum ändert.",
              "Sie müssen nichts unternehmen.",
            ],
            next: ["Sie müssen nichts unternehmen."],
          }
        : language === "en"
          ? {
              subject: `Order ${c.shopifyOrderName} — taking longer than expected`,
              headline: "Taking longer than expected",
              statusLine: "The seller has not shipped your item yet.",
              eta: "May change",
              body: [
                "Your order is taking longer than expected. We're on it and we'll email you if your estimated delivery date changes.",
                "You don't need to do anything.",
              ],
              next: ["You don't need to do anything."],
            }
          : {
              subject: `Commande ${c.shopifyOrderName} — plus de temps que prévu`,
              headline: "Plus de temps que prévu",
              statusLine: "Le vendeur n'a pas encore expédié votre article.",
              eta: "Peut changer",
              body: [
                "Votre commande prend plus de temps que prévu. Nous suivons la situation et nous vous écrirons si la date de livraison estimée change.",
                "Vous n'avez rien à faire.",
              ],
              next: ["Vous n'avez rien à faire."],
            };
    return {
      kind,
      language,
      chrome,
      subject: copy.subject,
      headline: copy.headline,
      statusLine: copy.statusLine,
      greeting: hello,
      bodyParagraphs: copy.body,
      nextLines: copy.next,
      activeStepLabel: chrome.steps[0],
      etaLabel: chrome.etaLabel,
      etaLine: copy.eta,
      shippingLabel,
    };
  }

  if (kind === "CANCEL_REBUY_LEGIT") {
    const copy =
      language === "de"
        ? {
            subject: `Bestellung ${c.shopifyOrderName} — Artikel ersetzt`,
            headline: "Artikel ersetzt",
            statusLine: "Gleicher Artikel. Neues Datum unten.",
            body: [
              "Bei der Echtheitsprüfung wurde der Artikel nicht freigegeben. Wir haben sofort dasselbe Modell, dieselbe Grösse, bei einem anderen geprüften Verkäufer bestellt.",
              "Das tut uns leid. Deine Bestellung bleibt aktiv. Du musst nichts tun.",
            ],
            next: [
              "Du erhältst bei jedem Schritt eine automatische E-Mail.",
              "Das neue Lieferdatum steht oben.",
              "Kommt 48 Stunden danach nichts an, schreib uns mit deiner Bestellnummer.",
            ],
          }
        : language === "en"
          ? {
              subject: `Order ${c.shopifyOrderName} — item replaced`,
              headline: "Item replaced",
              statusLine: "Same item. New date below.",
              body: [
                "The item did not pass authentication. We immediately ordered the same model and size from another verified seller.",
                "Sorry about the delay. Your order stays open. Nothing to do on your side.",
              ],
              next: [
                "You get an automatic email at each step.",
                "The new delivery date is shown above.",
                "If nothing arrives 48 hours after that date, reply with your order number.",
              ],
            }
          : {
              subject: `Commande ${c.shopifyOrderName} — article remplacé`,
              headline: "Article remplacé",
              statusLine: "Même référence recommandée. Nouvelle date ci-dessous.",
              body: [
                "Lors du contrôle d'authenticité, l'article n'a pas été validé. Nous avons immédiatement commandé le même modèle, même taille, auprès d'un autre vendeur vérifié.",
                "Nous sommes désolés pour ce contretemps. Ta commande reste active. Aucune action de ton côté.",
              ],
              next: [
                "Un e-mail automatique part à chaque étape.",
                "La nouvelle date de livraison figure ci-dessus.",
                "Si rien n'est livré 48 h après cette date, contacte-nous avec ton numéro de commande.",
              ],
            };
    return {
      kind,
      language,
      chrome,
      subject: copy.subject,
      headline: copy.headline,
      statusLine: copy.statusLine,
      greeting: hello,
      bodyParagraphs: copy.body,
      nextLines: copy.next,
      activeStepLabel: chrome.steps[0],
      etaLabel: chrome.etaPrefix,
      etaLine: rebuyEtaRange,
      shippingLabel,
    };
  }

  const fallback =
    language === "de"
      ? {
          subject: `Bestellung ${c.shopifyOrderName} — wichtiges Update`,
          headline: "Bestellung nicht abgeschlossen",
          statusLine: "Wir melden uns mit einer Lösung.",
          body: [
            "Der Verkäufer konnte diese Bestellung nicht abschliessen. Wir melden uns bald mit einem neuen Artikel oder einer Rückerstattung.",
            "Das tut uns leid.",
          ],
        }
      : language === "en"
        ? {
            subject: `Order ${c.shopifyOrderName} — important update`,
            headline: "Order not completed",
            statusLine: "We'll write again with a solution.",
            body: [
              "The seller could not complete this order. We'll contact you shortly with a replacement or a refund.",
              "Sorry about this.",
            ],
          }
        : {
            subject: `Commande ${c.shopifyOrderName} — mise à jour importante`,
            headline: "Commande non finalisée",
            statusLine: "Nous te recontactons avec une solution.",
            body: [
              "Le vendeur n'a pas pu finaliser cette commande. Nous te recontactons très vite avec un nouvel article ou un remboursement.",
              "Nous sommes désolés pour ce contretemps.",
            ],
          };
  return {
    kind,
    language,
    chrome,
    subject: fallback.subject,
    headline: fallback.headline,
    statusLine: fallback.statusLine,
    greeting: hello,
    bodyParagraphs: fallback.body,
    nextLines: [],
    activeStepLabel: chrome.steps[0],
    etaLabel: chrome.etaLabel,
    etaLine: chrome.dateToConfirm,
    shippingLabel,
  };
}

export function fmtPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "n/a";
  return `${(pct * 100).toFixed(1)}%`;
}
