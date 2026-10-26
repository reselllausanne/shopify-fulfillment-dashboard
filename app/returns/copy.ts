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
  excludedTitle: string;
  excludedSaleOrPromo: string;
  excludedPriceOverLimit: string;
  returnPolicyExcluded: string;
  quantity: string;
  max: string;
  orderedSizeLabel: string;
  reasonLabel: string;
  reasons: Record<string, string>;
  commentLabel: string;
  commentHint: string;
  commentPlaceholder: string;
  consentLabel: string;
  consentRequiredError: string;
  policyLinkLabel: string;
  policyLinkHref: string;
  returnWindowExpired: string;
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
  pathTitle: string;
  pathReturnTitle: string;
  pathReturnHint: string;
  pathExchangeTitle: string;
  pathExchangeHint: string;
  replacementLabel: string;
  replacementLoading: string;
  replacementNone: string;
  replacementNoneOutOfStock: string;
  exchangeMultiQtyHint: string;
  replacementPickRequired: string;
  exchangePriceDiffDue: string;
  payExchangeDiff: string;
  validateExchange: string;
  successTitleExchange: string;
  successBodyExchange: string;
  successNextExchange: string[];
  exchangePayBeforeLabelTitle: string;
  exchangePayBeforeLabelBody: string;
  exchangePayBeforeLabelNext: string[];
  successRequestReceivedTitle: string;
  successRequestReceivedBody: string;
  successEmailHint: string;
  successPayEmailHint: string;
  exchangeCreditDue: string;
  confirmSummaryTitle: string;
  confirmEditProducts: string;
  confirmReason: string;
  confirmReplacement: string;
  /** Recap line: "Echange pour la {size}" */
  confirmExchangeForSize: string;
  confirmPathReturn: string;
  confirmPathExchange: string;
  /** Size picker: only show Δ vs ordered pair */
  priceDiffSame: string;
  priceDiffPlus: string;
  priceDiffMinus: string;
  confirmMoneyTitle: string;
  confirmAmountDue: string;
  confirmAmountSave: string;
  confirmAmountEven: string;
  confirmPayBeforeShip: string;
  confirmRefundOriginal: string;
  confirmRefundStoreCredit: string;
  confirmRefundRuleHint: string;
  confirmReturnRefundTitle: string;
  confirmReturnRefundAmount: string;
};

const REASONS_FR = {
  SIZE_TOO_SMALL: "Taille trop petite",
  SIZE_TOO_LARGE: "Taille trop grande",
  UNWANTED: "Changement d’avis",
  NOT_AS_DESCRIBED: "Article non conforme à la description",
  WRONG_ITEM: "Mauvais article reçu",
  DEFECTIVE: "Article endommagé ou défectueux",
  STYLE: "Style ne convient pas",
  COLOR: "Couleur ne convient pas",
  OTHER: "Autre raison",
};

const REASONS_EN = {
  SIZE_TOO_SMALL: "Size was too small",
  SIZE_TOO_LARGE: "Size was too large",
  UNWANTED: "Changed my mind",
  NOT_AS_DESCRIBED: "Item not as described",
  WRONG_ITEM: "Wrong item received",
  DEFECTIVE: "Damaged or defective",
  STYLE: "Style",
  COLOR: "Color",
  OTHER: "Other reason",
};

const REASONS_DE = {
  SIZE_TOO_SMALL: "Groesse war zu klein",
  SIZE_TOO_LARGE: "Groesse war zu gross",
  UNWANTED: "Meinung geaendert",
  NOT_AS_DESCRIBED: "Artikel nicht wie beschrieben",
  WRONG_ITEM: "Falscher Artikel erhalten",
  DEFECTIVE: "Beschaedigt oder defekt",
  STYLE: "Stil",
  COLOR: "Farbe",
  OTHER: "Anderer Grund",
};

export const RETURNS_COPY: Record<ReturnsLocale, ReturnsCopy> = {
  fr: {
    brand: "Resell Lausanne",
    pageTitle: "Resell Lausanne",
    pageSubtitle: "",
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
    excludedTitle: "Articles non eligibles au retour",
    excludedSaleOrPromo:
      "Article Soldes / promo (prix barre) — retour non accepte en ligne.",
    excludedPriceOverLimit: "Article a plus de CHF 650.– — retour non accepte en ligne.",
    returnPolicyExcluded:
      "Aucun article de cette commande n'est eligible au retour en ligne (Soldes/promo ou prix > CHF 650).",
    quantity: "Quantite",
    max: "max",
    orderedSizeLabel: "Taille",
    reasonLabel: "Pourquoi retournez-vous ?",
    reasons: REASONS_FR,
    commentLabel: "Remarque",
    commentHint: "Facultatif",
    commentPlaceholder: "Ex. trop petit, trop grand…",
    consentLabel:
      "J'ai pris connaissance des conditions de retour et j'accepte de suivre la procedure en ligne.",
    consentRequiredError: "Vous devez accepter les conditions de retour pour continuer.",
    policyLinkLabel: "Voir les conditions de retour",
    policyLinkHref: "https://www.resell-lausanne.ch/pages/faq?category=echanges-et-retours",
    returnWindowExpired:
      "Le delai de retour de 14 jours apres livraison est depasse pour cette commande.",
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
    pathTitle: "Que voulez-vous faire ?",
    pathReturnTitle: "Retour",
    pathReturnHint: "Renvoyer l'article, remboursement en avoir apres controle.",
    pathExchangeTitle: "Échange",
    pathExchangeHint: "Meme modele, autre variante en stock sur le site.",
    replacementLabel: "Nouvelle variante",
    replacementLoading: "Chargement des tailles…",
    replacementNone: "Aucune variante disponible pour un echange en ligne.",
    replacementNoneOutOfStock:
      "Les autres tailles de ce modele sont en rupture de stock pour un echange en ligne.",
    exchangeMultiQtyHint:
      "Plusieurs paires sur cette ligne : une seule nouvelle taille s'appliquera a toutes les quantites retournees.",
    replacementPickRequired: "Choisissez une variante de remplacement pour chaque article.",
    exchangePriceDiffDue: "Différence à régler : CHF {amount}",
    payExchangeDiff: "Traitement prioritaire du retour — payer la différence (lien sécurisé)",
    validateExchange: "Valider mon échange",
    successTitleExchange: "Demande d'echange prise en compte",
    successBodyExchange:
      "Merci. Votre demande est enregistree. Vous allez recevoir un e-mail avec la suite.",
    successNextExchange: [
      "Surveillez votre e-mail pour l'etiquette / la suite.",
      "Emballez la paire dans sa boite d'origine.",
      "Deposez le colis a la Poste avec l'etiquette.",
      "Apres controle, nous envoyons le remplacement.",
    ],
    exchangePayBeforeLabelTitle: "Demande d'échange enregistrée",
    exchangePayBeforeLabelBody:
      "Merci. Votre demande est prise en compte. La facture de la différence vous est envoyée par e-mail. Pour un traitement prioritaire, payez directement la différence via le lien sécurisé ci-dessous — vous recevrez ensuite l'étiquette de retour.",
    exchangePayBeforeLabelNext: [
      "Facture de la différence envoyée par e-mail — vous pouvez aussi payer via le bouton.",
      "Traitement prioritaire : payez la différence maintenant sur le lien sécurisé.",
      "Après paiement, vous recevez l'étiquette de retour par e-mail.",
      "Ensuite seulement, renvoyez votre paire.",
    ],
    successRequestReceivedTitle: "Demande prise en compte",
    successRequestReceivedBody:
      "Votre demande a bien ete enregistree. Vous allez recevoir un e-mail avec la suite.",
    successEmailHint: "Verifiez votre boite mail (et les spams).",
    successPayEmailHint:
      "Facture de la différence envoyée par e-mail — vous pouvez aussi payer via le bouton (paiement sécurisé).",
    exchangeCreditDue: "Avoir prevu apres controle : CHF {amount}",
    confirmSummaryTitle: "Recapitulatif",
    confirmEditProducts: "Modifier",
    confirmReason: "Motif",
    confirmReplacement: "Remplacement",
    confirmExchangeForSize: "Echange pour la {size}",
    confirmPathReturn: "Retour (avoir)",
    confirmPathExchange: "Echange",
    priceDiffSame: "Même prix",
    priceDiffPlus: "+ CHF {amount}",
    priceDiffMinus: "− CHF {amount}",
    confirmMoneyTitle: "Différence de prix",
    confirmAmountDue: "CHF {amount}",
    confirmAmountSave: "Économie CHF {amount}",
    confirmAmountEven: "CHF 0.00",
    confirmPayBeforeShip:
      "Pas d'expedition / etiquette avant reglement de la difference.",
    confirmRefundOriginal:
      "Remboursement de CHF {amount} sur votre moyen de paiement initial (ecart ≤ CHF 50).",
    confirmRefundStoreCredit:
      "Avoir magasin de CHF {amount} (ecart > CHF 50).",
    confirmRefundRuleHint:
      "Ecart ≤ CHF 50 → remboursement sur le moyen de paiement d'origine. Au-dela → avoir magasin.",
    confirmReturnRefundTitle: "Remboursement apres controle",
    confirmReturnRefundAmount: "Montant estime : CHF {amount}",
  },
  en: {
    brand: "Resell Lausanne",
    pageTitle: "Resell Lausanne",
    pageSubtitle: "",
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
    excludedTitle: "Items not eligible for return",
    excludedSaleOrPromo: "Sale / promo item (compare-at price) — online return not accepted.",
    excludedPriceOverLimit: "Item over CHF 650 — online return not accepted.",
    returnPolicyExcluded:
      "No item on this order is eligible for an online return (sale/promo or price over CHF 650).",
    quantity: "Quantity",
    max: "max",
    orderedSizeLabel: "Size",
    reasonLabel: "Why are you returning?",
    reasons: REASONS_EN,
    commentLabel: "Note",
    commentHint: "Optional",
    commentPlaceholder: "e.g. too small, too big…",
    consentLabel:
      "I have read the return conditions and I agree to follow the online return process.",
    consentRequiredError: "You must accept the return conditions to continue.",
    policyLinkLabel: "View return FAQ",
    policyLinkHref: "https://www.resell-lausanne.ch/en/pages/faq?category=echanges-et-retours",
    returnWindowExpired:
      "The 14-day return window after delivery has passed for this order.",
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
    pathTitle: "What do you want to do?",
    pathReturnTitle: "Return",
    pathReturnHint: "Send item back for store credit after inspection.",
    pathExchangeTitle: "Exchange",
    pathExchangeHint: "Same product, another in-stock variant.",
    replacementLabel: "New variant",
    replacementLoading: "Loading sizes…",
    replacementNone: "No variant available online.",
    replacementNoneOutOfStock:
      "Other sizes of this model are out of stock for an online exchange.",
    exchangeMultiQtyHint:
      "Multiple pairs on this line: one replacement size applies to all returned units.",
    replacementPickRequired: "Pick a replacement for each item.",
    exchangePriceDiffDue: "Amount due: CHF {amount}",
    payExchangeDiff: "Priority return processing — pay the difference (secure link)",
    validateExchange: "Confirm exchange",
    successTitleExchange: "Exchange request received",
    successBodyExchange:
      "Thanks — your request is registered. You will get an email with next steps.",
    successNextExchange: [
      "Watch your email for the label / next steps.",
      "Pack the pair in its original box.",
      "Drop the parcel at the Post Office with the label.",
      "After inspection we ship the replacement.",
    ],
    exchangePayBeforeLabelTitle: "Exchange request registered",
    exchangePayBeforeLabelBody:
      "Thanks — your request is recorded. The price-difference invoice is sent by email. For priority processing, pay the difference now via the secure link below — you will then receive the return label.",
    exchangePayBeforeLabelNext: [
      "Price-difference invoice sent by email — you can also pay with the button.",
      "Priority processing: pay the difference now on the secure link.",
      "After payment, you receive the return label by email.",
      "Only then send your pair back.",
    ],
    successRequestReceivedTitle: "Request received",
    successRequestReceivedBody:
      "Your request is registered. You will get an email with next steps.",
    successEmailHint: "Check your inbox (and spam).",
    successPayEmailHint:
      "Price-difference invoice sent by email — you can also pay with the button (secure payment).",
    exchangeCreditDue: "Store credit after inspection: CHF {amount}",
    confirmSummaryTitle: "Summary",
    confirmEditProducts: "Edit",
    confirmReason: "Reason",
    confirmReplacement: "Replacement",
    confirmExchangeForSize: "Exchange for size {size}",
    confirmPathReturn: "Return (credit)",
    confirmPathExchange: "Exchange",
    priceDiffSame: "Same price",
    priceDiffPlus: "+ CHF {amount}",
    priceDiffMinus: "− CHF {amount}",
    confirmMoneyTitle: "Price difference",
    confirmAmountDue: "CHF {amount}",
    confirmAmountSave: "You save CHF {amount}",
    confirmAmountEven: "CHF 0.00",
    confirmPayBeforeShip: "No label / shipping until the difference is paid.",
    confirmRefundOriginal:
      "CHF {amount} refunded to your original payment method (gap ≤ CHF 50).",
    confirmRefundStoreCredit: "CHF {amount} store credit (gap > CHF 50).",
    confirmRefundRuleHint:
      "Gap ≤ CHF 50 → refund to original payment. Above → store credit.",
    confirmReturnRefundTitle: "Refund after inspection",
    confirmReturnRefundAmount: "Estimated amount: CHF {amount}",
  },
  de: {
    brand: "Resell Lausanne",
    pageTitle: "Resell Lausanne",
    pageSubtitle: "",
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
    excludedTitle: "Nicht rueckgabefaehige Artikel",
    excludedSaleOrPromo: "Sale-/Promo-Artikel (Streichpreis) — Online-Retoure nicht moeglich.",
    excludedPriceOverLimit: "Artikel ueber CHF 650 — Online-Retoure nicht moeglich.",
    returnPolicyExcluded:
      "Kein Artikel dieser Bestellung ist online rueckgabefaehig (Sale/Promo oder Preis > CHF 650).",
    quantity: "Menge",
    max: "max",
    orderedSizeLabel: "Groesse",
    reasonLabel: "Warum senden Sie zurueck?",
    reasons: REASONS_DE,
    commentLabel: "Bemerkung",
    commentHint: "Optional",
    commentPlaceholder: "z. B. zu klein, zu gross…",
    consentLabel:
      "Ich habe die Retourenbedingungen gelesen und akzeptiere den Online-Retourenprozess.",
    consentRequiredError: "Sie muessen die Retourenbedingungen akzeptieren, um fortzufahren.",
    policyLinkLabel: "FAQ zu Retouren ansehen",
    policyLinkHref: "https://www.resell-lausanne.ch/de/pages/faq?category=echanges-et-retours",
    returnWindowExpired:
      "Die 14-Tage-Retourenfrist nach Lieferung ist fuer diese Bestellung abgelaufen.",
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
    pathTitle: "Was moechten Sie tun?",
    pathReturnTitle: "Retoure",
    pathReturnHint: "Artikel zurueck, Guthaben nach Kontrolle.",
    pathExchangeTitle: "Umtausch",
    pathExchangeHint: "Gleiches Produkt, andere Variante.",
    replacementLabel: "Neue Variante",
    replacementLoading: "Groessen laden…",
    replacementNone: "Keine Variante online verfuegbar.",
    replacementNoneOutOfStock:
      "Andere Groessen dieses Modells sind fuer einen Online-Umtausch nicht auf Lager.",
    exchangeMultiQtyHint:
      "Mehrere Paare in dieser Zeile: eine Ersatzgroesse gilt fuer alle zurueckgesendeten Stueck.",
    replacementPickRequired: "Ersatz pro Artikel waehlen.",
    exchangePriceDiffDue: "Zu zahlen: CHF {amount}",
    payExchangeDiff: "Prioritaets-Retoure — Differenz bezahlen (sichere Zahlung)",
    validateExchange: "Umtausch bestaetigen",
    successTitleExchange: "Umtausch-Anfrage erhalten",
    successBodyExchange:
      "Danke — Ihre Anfrage ist erfasst. Sie erhalten eine E-Mail mit den naechsten Schritten.",
    successNextExchange: [
      "E-Mail fuer Label / naechste Schritte pruefen.",
      "Paar in Originalbox verpacken.",
      "Paket mit Label zur Post bringen.",
      "Nach Kontrolle senden wir den Ersatz.",
    ],
    exchangePayBeforeLabelTitle: "Umtausch-Anfrage erfasst",
    exchangePayBeforeLabelBody:
      "Danke — Ihre Anfrage ist erfasst. Die Differenzrechnung wird per E-Mail gesendet. Fuer eine prioritaere Bearbeitung zahlen Sie die Differenz jetzt ueber den sicheren Link unten — danach erhalten Sie das Retourenlabel.",
    exchangePayBeforeLabelNext: [
      "Differenzrechnung per E-Mail gesendet — Sie koennen auch ueber den Button zahlen.",
      "Prioritaets-Retoure: Differenz jetzt ueber den sicheren Link bezahlen.",
      "Nach Zahlung erhalten Sie das Retourenlabel per E-Mail.",
      "Erst dann das Paar zuruecksenden.",
    ],
    successRequestReceivedTitle: "Anfrage erhalten",
    successRequestReceivedBody:
      "Ihre Anfrage ist erfasst. Sie erhalten eine E-Mail mit den naechsten Schritten.",
    successEmailHint: "Posteingang und Spam pruefen.",
    successPayEmailHint:
      "Differenzrechnung per E-Mail — Sie koennen auch ueber den Button zahlen (sichere Zahlung).",
    exchangeCreditDue: "Guthaben nach Kontrolle: CHF {amount}",
    confirmSummaryTitle: "Zusammenfassung",
    confirmEditProducts: "Aendern",
    confirmReason: "Grund",
    confirmReplacement: "Ersatz",
    confirmExchangeForSize: "Umtausch fuer Groesse {size}",
    confirmPathReturn: "Retoure",
    confirmPathExchange: "Umtausch",
    priceDiffSame: "Gleicher Preis",
    priceDiffPlus: "+ CHF {amount}",
    priceDiffMinus: "− CHF {amount}",
    confirmMoneyTitle: "Preisdifferenz",
    confirmAmountDue: "CHF {amount}",
    confirmAmountSave: "Ersparnis CHF {amount}",
    confirmAmountEven: "CHF 0.00",
    confirmPayBeforeShip: "Kein Label / Versand vor Zahlung der Differenz.",
    confirmRefundOriginal:
      "CHF {amount} Rueckerstattung auf die urspruengliche Zahlung (Differenz ≤ CHF 50).",
    confirmRefundStoreCredit: "CHF {amount} Store-Guthaben (Differenz > CHF 50).",
    confirmRefundRuleHint:
      "Differenz ≤ CHF 50 → Rueckerstattung auf Originalzahlung. Darueber → Store-Guthaben.",
    confirmReturnRefundTitle: "Rueckerstattung nach Kontrolle",
    confirmReturnRefundAmount: "Geschaetzter Betrag: CHF {amount}",
  },
};

export const RETURNS_LOCALES: ReturnsLocale[] = ["fr", "en", "de"];

export function isReturnsLocale(value: string): value is ReturnsLocale {
  return RETURNS_LOCALES.includes(value as ReturnsLocale);
}
