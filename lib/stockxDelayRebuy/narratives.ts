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

  if (kind === "SUPPLIER_CHANGE_DELAY") {
    const copy =
      language === "de"
        ? {
            subject: `Bestellung ${c.shopifyOrderName} — Lieferung verzögert`,
            headline: "Lieferung verzögert",
            statusLine: "Das geplante Datum gilt nicht mehr.",
            body: [
              "Der Verkäufer hat den Artikel nicht rechtzeitig verschickt. Deine Lieferung verzögert sich.",
              "Du musst nichts tun. Wir schreiben dir, sobald das neue Datum feststeht.",
            ],
            next: [
              "Du musst nichts unternehmen.",
              "Die nächste E-Mail nennt das neue Lieferdatum.",
              "Bei Fragen antworte auf diese E-Mail mit deiner Bestellnummer.",
            ],
          }
        : language === "en"
          ? {
              subject: `Order ${c.shopifyOrderName} — delivery delayed`,
              headline: "Delivery delayed",
              statusLine: "The planned date no longer stands.",
              body: [
                "The seller did not ship the item on time. Your delivery is delayed.",
                "You don't need to do anything. We'll email you once the new date is set.",
              ],
              next: [
                "Nothing to do on your side.",
                "The next email will give the new delivery date.",
                "If you have a question, reply to this email with your order number.",
              ],
            }
          : {
              subject: `Commande ${c.shopifyOrderName} — livraison retardée`,
              headline: "Livraison retardée",
              statusLine: "La date prévue n'est plus valable.",
              body: [
                "Le vendeur n'a pas expédié l'article dans le délai prévu. Ta livraison prend du retard.",
                "Tu n'as rien à faire. On t'écrit dès que la nouvelle date est connue.",
              ],
              next: [
                "Tu n'as rien à faire.",
                "Le prochain e-mail donne la nouvelle date de livraison.",
                "Pour une question, réponds à cet e-mail avec ton numéro de commande.",
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
      activeStepLabel: chrome.steps[1],
      etaLabel: chrome.etaLabel,
      etaLine: chrome.dateToConfirm,
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
