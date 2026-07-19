export type ReturnsLocale = "fr" | "en" | "de";

export type ReturnsCopy = {
  brand: string;
  pageTitle: string;
  pageSubtitle: string;
  steps: { order: string; products: string; confirm: string };
  langLabel: string;
  orderNumberLabel: string;
  orderNumberHint: string;
  orderNumberPlaceholder: string;
  orderNumberInvalid: string;
  emailLabel: string;
  emailHint: string;
  emailPlaceholder: string;
  emailInvalid: string;
  continue: string;
  checking: string;
  back: string;
  productsTitle: string;
  productsHint: string;
  noEligibleProducts: string;
  quantity: string;
  max: string;
  reasonLabel: string;
  reasons: Record<string, string>;
  commentLabel: string;
  commentPlaceholder: string;
  commentRequired: string;
  consentLabel: string;
  consentRequiredError: string;
  policyLinkLabel: string;
  policyLinkHref: string;
  validateReturn: string;
  validating: string;
  selectOneProduct: string;
  successTitle: string;
  successBody: string;
  successNextTitle: string;
  successNext: string[];
  downloadLabel: string;
  tracking: string;
  anotherRequest: string;
  lookupFailed: string;
  orderHelpTitle: string;
  orderHelpIntro: string;
  orderHelpItems: string[];
};

const REASONS_FR = {
  SIZE_CHANGE: "Mauvaise taille",
  CHANGE_OF_MIND: "Je change d'avis",
  DEFECTIVE_ITEM: "Article abime ou defectueux",
  WRONG_ITEM_RECEIVED: "Mauvais article recu",
  NON_CONFORMITY: "Article pas conforme",
  OTHER: "Autre raison",
};

const REASONS_EN = {
  SIZE_CHANGE: "Wrong size",
  CHANGE_OF_MIND: "I changed my mind",
  DEFECTIVE_ITEM: "Damaged or defective item",
  WRONG_ITEM_RECEIVED: "Wrong item received",
  NON_CONFORMITY: "Item not as described",
  OTHER: "Other reason",
};

const REASONS_DE = {
  SIZE_CHANGE: "Falsche Groesse",
  CHANGE_OF_MIND: "Ich habe meine Meinung geaendert",
  DEFECTIVE_ITEM: "Beschaedigter oder defekter Artikel",
  WRONG_ITEM_RECEIVED: "Falscher Artikel erhalten",
  NON_CONFORMITY: "Artikel nicht wie beschrieben",
  OTHER: "Anderer Grund",
};

export const RETURNS_COPY: Record<ReturnsLocale, ReturnsCopy> = {
  fr: {
    brand: "Resell Lausanne",
    pageTitle: "Demande de retours",
    pageSubtitle: "Demandez votre retours en ligne rapidement",
    steps: { order: "1. Commande", products: "2. Article", confirm: "3. Confirmer" },
    langLabel: "Langue",
    orderNumberLabel: "Numero de commande",
    orderNumberHint: "Seulement le # suivi de chiffres. Exemple : #6141",
    orderNumberPlaceholder: "6141",
    orderNumberInvalid: "Format incorrect. Ecrivez comme ceci : #6141",
    emailLabel: "Votre e-mail de commande",
    emailHint: "Le meme e-mail que lors de l'achat.",
    emailPlaceholder: "exemple@email.com",
    emailInvalid: "E-mail invalide. Verifiez l'orthographe.",
    continue: "Continuer",
    checking: "Verification en cours...",
    back: "Retour",
    productsTitle: "Quel article voulez-vous retourner ?",
    productsHint: "Cochez le ou les produits concernés.",
    noEligibleProducts: "Aucun article disponible pour un retour sur cette commande.",
    quantity: "Quantite",
    max: "max",
    reasonLabel: "Pourquoi retournez-vous ?",
    reasons: REASONS_FR,
    commentLabel: "Petite explication (obligatoire)",
    commentPlaceholder: "Exemple : trop petit, trop grand, mauvais modele...",
    commentRequired: "Ecrivez une courte explication pour continuer.",
    consentLabel:
      "J'ai pris connaissance des conditions de retour et je ne renverrai aucun produit sans validation préalable du support.",
    consentRequiredError: "Vous devez accepter les conditions de retour pour continuer.",
    policyLinkLabel: "Conditions de retour",
    policyLinkHref: "https://www.resell-lausanne.ch/policies/refund-policy",
    validateReturn: "Valider mon retour",
    validating: "Envoi en cours...",
    selectOneProduct: "Cochez au moins un article.",
    successTitle: "Votre retour est enregistre",
    successBody: "Prochaine etape : imprimez l'etiquette, emballez l'article, allez a la Poste.",
    successNextTitle: "Que faire maintenant ?",
    successNext: [
      "Imprimez l'etiquette de retour.",
      "Mettez l'article dans sa boite d'origine.",
      "Collez l'etiquette sur le colis (bien visible).",
      "Deposez le colis a la Poste.",
      "Apres controle, vous recevez un avoir magasin.",
    ],
    downloadLabel: "Telecharger l'etiquette PDF",
    tracking: "Numero de suivi",
    anotherRequest: "Faire un autre retour",
    lookupFailed:
      "Commande introuvable. Verifiez le numero (#6141) et l'e-mail exact de l'achat.",
    orderHelpTitle: "Ou trouver mon numero de commande ?",
    orderHelpIntro: "Le numero commence toujours par #. Exemple : #6141",
    orderHelpItems: [
      "Dans l'e-mail de confirmation d'achat.",
      "Dans votre compte client > Mes commandes.",
      "Sur la facture PDF recue par e-mail.",
    ],
  },
  en: {
    brand: "Resell Lausanne",
    pageTitle: "Return request",
    pageSubtitle: "Request your return online quickly",
    steps: { order: "1. Order", products: "2. Item", confirm: "3. Confirm" },
    langLabel: "Language",
    orderNumberLabel: "Order number",
    orderNumberHint: "Only # followed by digits. Example: #6141",
    orderNumberPlaceholder: "6141",
    orderNumberInvalid: "Wrong format. Write it like this: #6141",
    emailLabel: "Your order email",
    emailHint: "Same email used when you bought the item.",
    emailPlaceholder: "example@email.com",
    emailInvalid: "Invalid email. Please check spelling.",
    continue: "Continue",
    checking: "Checking...",
    back: "Back",
    productsTitle: "Which item do you want to return?",
    productsHint: "Tick the product(s) concerned.",
    noEligibleProducts: "No returnable items found for this order.",
    quantity: "Quantity",
    max: "max",
    reasonLabel: "Why are you returning?",
    reasons: REASONS_EN,
    commentLabel: "Short explanation (required)",
    commentPlaceholder: "Example: too small, too big, wrong model...",
    commentRequired: "Please write a short explanation to continue.",
    consentLabel:
      "I have read the return conditions and I will not send any product without prior support approval.",
    consentRequiredError: "You must accept the return conditions to continue.",
    policyLinkLabel: "Return policy",
    policyLinkHref: "https://www.resell-lausanne.ch/policies/refund-policy",
    validateReturn: "Confirm my return",
    validating: "Sending...",
    selectOneProduct: "Please select at least one item.",
    successTitle: "Your return is registered",
    successBody: "Next: print the label, pack the item, go to the Post Office.",
    successNextTitle: "What to do now?",
    successNext: [
      "Print the return label.",
      "Put the item in its original box.",
      "Stick the label clearly on the parcel.",
      "Drop the parcel at the Post Office.",
      "After inspection, you receive store credit.",
    ],
    downloadLabel: "Download PDF label",
    tracking: "Tracking number",
    anotherRequest: "Start another return",
    lookupFailed:
      "Order not found. Check the number (#6141) and the exact checkout email.",
    orderHelpTitle: "Where is my order number?",
    orderHelpIntro: "The number always starts with #. Example: #6141",
    orderHelpItems: [
      "In your order confirmation email.",
      "In your customer account > My orders.",
      "On the PDF invoice sent by email.",
    ],
  },
  de: {
    brand: "Resell Lausanne",
    pageTitle: "Retourenanfrage",
    pageSubtitle: "Retoure schnell online anfragen",
    steps: { order: "1. Bestellung", products: "2. Artikel", confirm: "3. Bestaetigen" },
    langLabel: "Sprache",
    orderNumberLabel: "Bestellnummer",
    orderNumberHint: "Nur # und Ziffern. Beispiel: #6141",
    orderNumberPlaceholder: "6141",
    orderNumberInvalid: "Falsches Format. So schreiben: #6141",
    emailLabel: "Ihre Bestell-E-Mail",
    emailHint: "Dieselbe E-Mail wie beim Kauf.",
    emailPlaceholder: "beispiel@email.com",
    emailInvalid: "Ungueltige E-Mail. Bitte pruefen.",
    continue: "Weiter",
    checking: "Pruefung...",
    back: "Zurueck",
    productsTitle: "Welchen Artikel wollen Sie zuruecksenden?",
    productsHint: "Produkt(e) ankreuzen.",
    noEligibleProducts: "Keine rueckgabefaehigen Artikel fuer diese Bestellung.",
    quantity: "Menge",
    max: "max",
    reasonLabel: "Warum senden Sie zurueck?",
    reasons: REASONS_DE,
    commentLabel: "Kurze Erklaerung (pflicht)",
    commentPlaceholder: "Beispiel: zu klein, zu gross, falsches Modell...",
    commentRequired: "Bitte kurze Erklaerung schreiben.",
    consentLabel:
      "Ich habe die Retourenbedingungen gelesen und werde kein Produkt ohne vorherige Freigabe durch den Support zuruecksenden.",
    consentRequiredError: "Sie muessen die Retourenbedingungen akzeptieren, um fortzufahren.",
    policyLinkLabel: "Retourenbedingungen",
    policyLinkHref: "https://www.resell-lausanne.ch/policies/refund-policy",
    validateReturn: "Retoure bestaetigen",
    validating: "Wird gesendet...",
    selectOneProduct: "Bitte mindestens einen Artikel waehlen.",
    successTitle: "Ihre Retoure ist erfasst",
    successBody: "Naechster Schritt: Label drucken, Artikel verpacken, zur Post gehen.",
    successNextTitle: "Was jetzt tun?",
    successNext: [
      "Retourenlabel drucken.",
      "Artikel in Originalbox legen.",
      "Label gut sichtbar aufkleben.",
      "Paket bei der Post abgeben.",
      "Nach Kontrolle erhalten Sie Store-Guthaben.",
    ],
    downloadLabel: "PDF-Label herunterladen",
    tracking: "Sendungsnummer",
    anotherRequest: "Weitere Retoure starten",
    lookupFailed:
      "Bestellung nicht gefunden. Nummer (#6141) und exakte Kauf-E-Mail pruefen.",
    orderHelpTitle: "Wo finde ich meine Bestellnummer?",
    orderHelpIntro: "Die Nummer beginnt immer mit #. Beispiel: #6141",
    orderHelpItems: [
      "In der Bestellbestaetigung per E-Mail.",
      "Im Kundenkonto > Meine Bestellungen.",
      "Auf der PDF-Rechnung per E-Mail.",
    ],
  },
};

export const RETURNS_LOCALES: ReturnsLocale[] = ["fr", "en", "de"];

export function isReturnsLocale(value: string): value is ReturnsLocale {
  return RETURNS_LOCALES.includes(value as ReturnsLocale);
}
