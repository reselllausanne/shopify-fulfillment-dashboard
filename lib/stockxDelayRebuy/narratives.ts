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
            subject: `Bestellung ${c.shopifyOrderName} — Verkäufer hat nicht verschickt`,
            headline: "Verkäufer hat nicht verschickt",
            statusLine: "Wir suchen einen anderen Verkäufer für denselben Artikel.",
            eta: "Neues Datum folgt",
            body: [
              "Der Verkäufer hat nicht rechtzeitig verschickt. Dieser Kauf ist annulliert.",
              "Wir suchen einen anderen Verkäufer, gleiches Modell, gleiche Grösse. Finden wir einen, schicken wir das neue Datum. Sonst erstatten wir auf dein Zahlungsmittel.",
            ],
            next: ["Du musst nichts tun.", "Die nächste E-Mail bringt das neue Datum oder die Rückerstattung."],
          }
        : language === "en"
          ? {
              subject: `Order ${c.shopifyOrderName} — the seller did not ship`,
              headline: "The seller could not ship",
              statusLine: "We're looking for another seller for the same item.",
              eta: "New date to follow",
              body: [
                "The seller did not ship your order in time. That purchase is canceled.",
                "We're looking for another seller, same item, same size. If we find one, we'll email the new date. If we can't, you get a refund to your original payment method.",
              ],
              next: ["You don't need to do anything.", "The next email brings either the new date or the refund."],
            }
          : {
              subject: `Commande ${c.shopifyOrderName} — le vendeur n'a pas expédié`,
              headline: "Le vendeur n'a pas pu expédier",
              statusLine: "On cherche un autre vendeur pour le même article.",
              eta: "Nouvelle date à venir",
              body: [
                "Le vendeur n'a pas expédié ta commande dans le délai. Cet achat est annulé.",
                "On cherche un autre vendeur, même article, même taille. Si on le trouve, on t'écrit avec la nouvelle date. Sinon, tu es remboursé sur ton moyen de paiement.",
              ],
              next: ["Tu n'as rien à faire.", "Le prochain e-mail donne la nouvelle date, ou le remboursement."],
            }
      : language === "de"
        ? {
            subject: `Bestellung ${c.shopifyOrderName} — dauert länger als geplant`,
            headline: "Dauert länger als geplant",
            statusLine: "Der Verkäufer hat deinen Artikel noch nicht verschickt.",
            eta: "Kann sich ändern",
            body: [
              "Deine Bestellung dauert länger als geplant. Wir bleiben dran und schreiben dir, wenn sich das Lieferdatum ändert.",
              "Du musst gerade nichts tun.",
            ],
            next: ["Du musst nichts tun.", "Wir schreiben, wenn sich das Datum ändert."],
          }
        : language === "en"
          ? {
              subject: `Order ${c.shopifyOrderName} — taking longer than expected`,
              headline: "Taking longer than expected",
              statusLine: "The seller has not shipped your item yet.",
              eta: "May change",
              body: [
                "Your order is taking longer than expected. We're on it and we'll email you if the delivery date changes.",
                "You don't need to do anything right now.",
              ],
              next: ["You don't need to do anything.", "We'll email you if the date changes."],
            }
          : {
              subject: `Commande ${c.shopifyOrderName} — ça prend plus de temps que prévu`,
              headline: "Ça prend plus de temps que prévu",
              statusLine: "Le vendeur n'a pas encore expédié ton article.",
              eta: "Peut changer",
              body: [
                "Ta commande prend plus de temps que prévu. On suit le dossier et on t'écrit si la date de livraison change.",
                "Tu n'as rien à faire pour l'instant.",
              ],
              next: ["Tu n'as rien à faire.", "On t'écrit si la date change."],
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
