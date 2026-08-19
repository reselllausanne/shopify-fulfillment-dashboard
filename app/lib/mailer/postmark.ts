import type { MailSendResult, Mailer, StockXMilestoneEmailInput } from "@/app/lib/mailer/types";
import type { StockXState } from "@/app/lib/stockxTracking";
import { resolveSwissPostCustomerTracking } from "@/app/lib/swissPostCustomerTracking";

type PostmarkSendResponse = {
  MessageID?: string;
  ErrorCode?: number;
  Message?: string;
};

type MailLanguage = "fr" | "en";

function normalizePublicBaseUrl(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return null;
    return `${url.origin}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function resolveTrackingBaseUrl(): string | null {
  return (
    normalizePublicBaseUrl(process.env.TRACKING_BASE_URL) ||
    normalizePublicBaseUrl(process.env.BRAND_HOME_URL) ||
    normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL) ||
    normalizePublicBaseUrl(process.env.APP_BASE_URL) ||
    normalizePublicBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    normalizePublicBaseUrl(process.env.VERCEL_URL)
  );
}

function isCustomerTrackingEnabled(): boolean {
  const raw = String(process.env.CUSTOMER_TRACKING_LINK_ENABLED || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function toLocalizedDate(d: Date | null, language: MailLanguage): string | null {
  if (!d) return null;
  try {
    const locale = language === "fr" ? "fr-CH" : "en-CH";
    return d.toLocaleDateString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return null;
  }
}

function addBusinessDays(date: Date | null, days: number): Date | null {
  if (!date || !Number.isFinite(days) || days <= 0) return date;
  const result = new Date(date.getTime());
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) {
      added += 1;
    }
  }
  return result;
}

const isExpressFlow = (
  checkoutType: string | null,
  orderNumber: string | null,
  states: StockXState[] | null
): boolean => {
  const normalizedStates = states || [];
  const hasDfs = normalizedStates.some((s) => s?.sourceType === "DFS");
  const shortFlow = normalizedStates.length > 0 && normalizedStates.length <= 4;
  if (hasDfs && shortFlow) return true;
  if (orderNumber?.startsWith("01-")) return true;
  if (orderNumber?.startsWith("03-")) return false;
  return !!checkoutType && checkoutType.startsWith("EXPRESS");
};

function detectLanguage(input: StockXMilestoneEmailInput): MailLanguage {
  const override = (process.env.POSTMARK_LANGUAGE_OVERRIDE || "").trim().toLowerCase();
  if (override === "fr" || override === "en") return override;
  if (input.language === "fr" || input.language === "en") return input.language;

  const emailDomain = input.to.split("@")[1]?.toLowerCase() || "";
  const mapRaw = (process.env.POSTMARK_LANGUAGE_DOMAIN_MAP || "").trim();
  if (mapRaw) {
    try {
      const parsed = JSON.parse(mapRaw) as Record<string, string>;
      const mapped = (parsed[emailDomain] || "").toLowerCase();
      if (mapped === "fr" || mapped === "en") return mapped;
    } catch {
      // Ignore invalid env map; continue with heuristic.
    }
  }

  if (/\.(fr|be|ch|qc)$/i.test(emailDomain)) return "fr";
  if (/\.(uk|us|com|net|org)$/i.test(emailDomain)) return "en";
  return "fr";
}

const COPY: Record<
  MailLanguage,
  {
    stepLabelsStandard: string[];
    stepLabelsExpress: string[];
    trackingCta: string;
    trackingPending: string;
    labelOrder: string;
    labelEta: string;
    labelTracking: string;
    labelStatus: string;
    labelStyleId: string;
    labelSize: string;
    labelOrderNumber: string;
    labelSalePrice: string;
    faqIntro: string;
    faqLinkText: string;
    footerRights: string;
    footerSender: string;
    footerHelp: string;
    topNote: string;
    subjectPrefix: string;
    statusNoteStandard: string;
    statusNoteExpress: string;
    statusNoteShipped: string;
    nextStepsTitle: string;
    nextStepStandard1: string;
    nextStepStandard2: string;
    nextStepStandard3: string;
    nextStepExpress1: string;
    nextStepExpress2: string;
    nextStepExpress3: string;
    closing1: string;
    closing2: string;
    laPosteReady: string;
    laPostePending: string;
    laPosteCta: string;
    laPosteTrackingNumberLabel: string;
    trackingLabelLaPoste: string;
  }
> = {
  fr: {
    stepLabelsStandard: [
      "Commande confirmée",
      "Authentification en cours",
      "Préparation expédition",
      "Expédiée via La Poste",
    ],
    stepLabelsExpress: ["Commande confirmée", "Authentification en cours", "Préparation expédition", "Expédiée via La Poste"],
    trackingCta: "Voir le suivi complet",
    trackingPending: "Suivi local disponible après prise en charge transporteur",
    labelOrder: "Commande",
    labelEta: "Arrivée estimée",
    labelTracking: "Suivi",
    labelStatus: "Statut",
    labelStyleId: "ID de style",
    labelSize: "Taille",
    labelOrderNumber: "Numéro de commande",
    labelSalePrice: "Prix de vente",
    faqIntro: "FAQ, delais et retours :",
    faqLinkText: "Voir la page d'aide",
    footerRights: "Tous droits réservés.",
    footerSender:
      "Expéditeur: Resell Lausanne, Chemin de Bas de Plan 6, 1030 Bussigny, Suisse.",
    footerHelp: "Besoin d'aide ?",
    topNote: "Mise à jour automatique de ta commande.",
    subjectPrefix: "Suivi commande",
    statusNoteStandard:
      "Bonne nouvelle ! Ton article est arrive dans notre centre de verification. Une fois la verification effectuee, nous te l'expedions et te communiquons toutes les informations utiles.",
    statusNoteExpress:
      "Bonne nouvelle ! Ta commande prioritaire suit un parcours accelere. Apres verification, nous expedions rapidement ton colis avec toutes les infos utiles.",
    statusNoteShipped:
      "Bonne nouvelle. Ton colis est en route via La Poste. Suis la livraison avec le bouton ci-dessous.",
    nextStepsTitle: "Avant de contacter le support :",
    nextStepStandard1: "Tu recevras un e-mail automatique a chaque etape.",
    nextStepStandard2: "Merci d'attendre la date de livraison estimee indiquee ci-dessus.",
    nextStepStandard3: "Si rien n'est livre 48h apres cette date, contacte-nous avec ton numero de commande.",
    nextStepExpress1: "Tu recevras un e-mail automatique a chaque etape.",
    nextStepExpress2: "Merci d'attendre la date de livraison estimee indiquee ci-dessus.",
    nextStepExpress3: "Si rien n'est livre 48h apres cette date, contacte-nous avec ton numero de commande.",
    closing1: "La plupart des reponses sont dans notre page d'aide.",
    closing2: "Support prioritaire si la commande depasse la date estimee de 48h.",
    laPosteReady: "Ton colis est pris en charge par La Poste.",
    laPostePending: "Le suivi La Poste est envoye des la prise en charge.",
    laPosteCta: "Suivre mon colis",
    laPosteTrackingNumberLabel: "Numero de suivi La Poste",
    trackingLabelLaPoste: "Suivi La Poste",
  },
  en: {
    stepLabelsStandard: [
      "Order confirmed",
      "Authentication in progress",
      "Preparing shipment",
      "Shipped via Swiss Post",
    ],
    stepLabelsExpress: ["Order confirmed", "Authentication in progress", "Preparing shipment", "Shipped via Swiss Post"],
    trackingCta: "Open full tracking",
    trackingPending: "Local tracking appears after carrier pickup",
    labelOrder: "Order",
    labelEta: "Estimated arrival",
    labelTracking: "Tracking",
    labelStatus: "Status",
    labelStyleId: "Style ID",
    labelSize: "Size",
    labelOrderNumber: "Order number",
    labelSalePrice: "Sale price",
    faqIntro: "FAQ, delays and returns:",
    faqLinkText: "Open help page",
    footerRights: "All rights reserved.",
    footerSender:
      "Sender: Resell Lausanne, Chemin de Bas de Plan 6, 1030 Bussigny, Switzerland.",
    footerHelp: "Need help?",
    topNote: "Automatic update for your order.",
    subjectPrefix: "Order update",
    statusNoteStandard:
      "Great news. Your item has reached our verification center. Once verification is complete, we ship it and share all useful delivery details.",
    statusNoteExpress:
      "Great news. Your priority order is moving quickly. After verification, we dispatch your parcel and share all useful delivery details.",
    statusNoteShipped:
      "Great news. Your parcel is on the way with Swiss Post. Track delivery with the button below.",
    nextStepsTitle: "Before contacting support:",
    nextStepStandard1: "You receive an automatic email at each step.",
    nextStepStandard2: "Please wait until the estimated delivery date shown above.",
    nextStepStandard3: "If nothing is delivered 48h after that date, contact us with your order number.",
    nextStepExpress1: "You receive an automatic email at each step.",
    nextStepExpress2: "Please wait until the estimated delivery date shown above.",
    nextStepExpress3: "If nothing is delivered 48h after that date, contact us with your order number.",
    closing1: "Most answers are available on our help page.",
    closing2: "Priority support applies when delivery is 48h past estimated date.",
    laPosteReady: "Your parcel has been handed over to Swiss Post.",
    laPostePending: "Swiss Post tracking is shared as soon as carrier pickup is complete.",
    laPosteCta: "Track my parcel",
    laPosteTrackingNumberLabel: "Swiss Post tracking number",
    trackingLabelLaPoste: "Swiss Post tracking",
  },
};

function buildTemplateModel(input: StockXMilestoneEmailInput) {
  const checkoutType = input.match.stockxCheckoutType || null;
  const orderNumber = input.match.stockxOrderNumber || null;
  const states = (input.stockxStates as StockXState[] | null) || null;
  const isExpress = isExpressFlow(checkoutType, orderNumber, states);
  const language = detectLanguage(input);
  const copy = COPY[language];

  const stepLabels = isExpress ? copy.stepLabelsExpress : copy.stepLabelsStandard;

  // Step 4 button only when we explicitly pass Swiss Post outbound fields.
  // Never infer from StockX inbound tracking.
  const outbound = resolveSwissPostCustomerTracking({
    trackingNumber: input.match.swissPostTrackingNumber || null,
    trackingUrl: input.match.swissPostTrackingUrl || null,
  });

  const completedCount = (() => {
    if (!states || states.length === 0) return 1;
    const done = states.filter((s) => {
      if (!s) return false;
      if (s.status === "UPCOMING" || s.progress === "UPCOMING") return false;
      return s.progress === "COMPLETED" || s.status === "SUCCESS";
    }).length;
    return Math.max(1, Math.min(3, done));
  })();

  const activeIndex = outbound ? 4 : completedCount;
  const styleFor = (idx: number) =>
    activeIndex === idx
      ? "font-weight:700;color:#3ea8f4;"
      : "font-weight:500;color:#9ca3af;";

  const trackingBaseUrl = resolveTrackingBaseUrl();
  const brandHomeUrl = trackingBaseUrl || "https://resell-lausanne.ch";

  const brandName = "Resell-Lausanne";
  const brandLogoUrl =
    process.env.BRAND_LOGO_URL ||
    "https://www.resell-lausanne.ch/cdn/shop/t/30/assets/logo-fullstack.png?v=22424771050372487161777561326";

  // Hero background image (the “StockX-style” textured/duotone banner).
  // For best email-client compatibility, this should be a pre-rendered image URL (PNG/JPG/SVG).
  const brandHeroImageUrl =
    process.env.BRAND_HERO_IMAGE_URL ||
    "";

  const supportEmail = process.env.SUPPORT_EMAIL || process.env.POSTMARK_FROM_EMAIL || "";
  const faqUrl =
    process.env.FAQ_URL ||
    (language === "fr"
      ? "https://www.resell-lausanne.ch/fr-fr/pages/faq"
      : "https://www.resell-lausanne.ch/en/pages/faq");

  const purchasePriceChf =
    typeof input.match.shopifyTotalPriceChf === "number" && Number.isFinite(input.match.shopifyTotalPriceChf)
      ? input.match.shopifyTotalPriceChf.toFixed(2)
      : "";
  const salePriceChf = purchasePriceChf;
  const displayPriceChf = salePriceChf || purchasePriceChf;

  const styleId = input.match.shopifySku || input.match.stockxSkuKey || "";
  const sizeLabel = input.match.shopifySizeEU || input.match.stockxSizeEU || "";


  const stripTrailingSize = (title: string, size: string | null): string => {
    let result = title;
    if (size) {
      const normalized = size.replace(/umat/gi, "").trim();
      const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\s*[-–]\\s*${escaped}$`, "i");
      result = result.replace(re, "").trim();
    }
    // Fallback: remove trailing numeric size like "- 42" or "- EU 42"
    result = result.replace(/\s*[-–]\s*(EU\s*)?\d+(?:[.,]\d+)?$/i, "").trim();
    return result;
  };

  const emailSubject = `${copy.subjectPrefix} ${input.match.shopifyOrderName}`;

  const estimatedStart = input.match.stockxEstimatedDelivery;
  const estimatedEnd = input.match.stockxLatestEstimatedDelivery || input.match.stockxEstimatedDelivery;
  const estimatedStartPlus2 = addBusinessDays(estimatedStart, 2);
  const estimatedEndPlus2 = addBusinessDays(estimatedEnd, 2);

  let trackingUrl = "";
  const trackingEnabled = isCustomerTrackingEnabled();
  const token = (input.match.customerTrackingToken || "").trim();
  const activeLabel = stepLabels[activeIndex - 1] || "";
  const statusNote =
    activeIndex === 4 ? copy.statusNoteShipped : isExpress ? copy.statusNoteExpress : copy.statusNoteStandard;
  const nextStep1 = isExpress ? copy.nextStepExpress1 : copy.nextStepStandard1;
  const nextStep2 = isExpress ? copy.nextStepExpress2 : copy.nextStepStandard2;
  const nextStep3 = isExpress ? copy.nextStepExpress3 : copy.nextStepStandard3;
  const laPosteTrackingUrlResolved = outbound?.trackingUrl || "";
  const laPosteTrackingNumber = outbound?.trackingNumber || "";
  const hasLaPosteTrackingNumber = Boolean(laPosteTrackingNumber);
  const hasLaPosteTracking = Boolean(laPosteTrackingUrlResolved);
  const hasLaPosteTrackingData = hasLaPosteTracking || hasLaPosteTrackingNumber;
  if (hasLaPosteTracking) {
    trackingUrl = laPosteTrackingUrlResolved;
  } else if (trackingEnabled && token && trackingBaseUrl) {
    trackingUrl = `${trackingBaseUrl}/track/${token}`;
  }
  const hasTracking = Boolean(trackingUrl);

  const trackingLabel = hasLaPosteTracking ? copy.trackingLabelLaPoste : copy.labelTracking;
  const trackingCta = hasLaPosteTracking ? copy.laPosteCta : copy.trackingCta;
  const trackingPendingText = hasLaPosteTrackingNumber
    ? `${copy.laPosteTrackingNumberLabel}: ${laPosteTrackingNumber}`
    : copy.trackingPending;
  const hasLaPosteBlock = hasLaPosteTracking;
  const laPosteLabel = trackingLabel;
  const laPosteNumberLine = trackingPendingText;
  const laPosteCta = trackingCta;
  const auxShow = hasLaPosteBlock;
  const auxLabel = laPosteLabel;
  const auxValue = laPosteNumberLine;
  const auxHref = laPosteTrackingUrlResolved;
  const auxCta = laPosteCta;

  return {
    // Header
    brand_home_url: brandHomeUrl,
    brand_name: brandName,
    brand_logo_url: brandLogoUrl,
    order_name: input.match.shopifyOrderName,

    // Hero
    email_subject: emailSubject,
    preheader_text: activeLabel || input.milestone.description || "",
    headline: activeLabel || input.milestone.description || "",
    hero_text: activeLabel || input.milestone.description || "",
    estimated_arrival_start: toLocalizedDate(estimatedStartPlus2, language),
    estimated_arrival_end: toLocalizedDate(estimatedEndPlus2, language),
    hero_image_url: input.match.shopifyLineItemImageUrl || brandHeroImageUrl,
    top_note: copy.topNote,
    tracking_url: trackingUrl,
    tracking_label: trackingLabel,
    tracking_pending_text: trackingPendingText,
    cta_track: trackingCta,
    has_tracking: hasTracking,
    has_laposte: hasLaPosteBlock,
    laposte_url: laPosteTrackingUrlResolved,
    laposte_label: laPosteLabel,
    laposte_number_line: laPosteNumberLine,
    laposte_cta: laPosteCta,
    a_show: auxShow,
    a_label: auxLabel,
    a_value: auxValue,
    a_href: auxHref,
    a_cta: auxCta,
    language,
    is_fr: language === "fr",
    is_en: language === "en",
    status_note: statusNote,

    // Status
    active_step_title: stepLabels[activeIndex - 1],
    active_step_subtitle: activeLabel || input.milestone.description || "",
    step_1: stepLabels[0] || "",
    step_2: stepLabels[1] || "",
    step_3: stepLabels[2] || "",
    step_4: stepLabels[3] || "",
    step_5: "",
    has_step4: Boolean(stepLabels[3]),
    has_step5: false,
    step1_active: activeIndex === 1,
    step2_active: activeIndex === 2,
    step3_active: activeIndex === 3,
    step4_active: activeIndex === 4,
    step5_active: activeIndex === 5,
    step1_style: styleFor(1),
    step2_style: styleFor(2),
    step3_style: styleFor(3),
    step4_style: styleFor(4),
    step5_style: styleFor(5),

    // Article
    product_title: stripTrailingSize(input.match.shopifyProductTitle || "", sizeLabel),
    product_image_url: input.match.shopifyLineItemImageUrl || "",
    product_image_alt: stripTrailingSize(input.match.shopifyProductTitle || "", sizeLabel),
    style_id: styleId,
    size_label: sizeLabel,
    purchase_price_chf: purchasePriceChf,
    total_price_chf: purchasePriceChf,
    sale_price_chf: salePriceChf,
    display_price_chf: displayPriceChf,

    // Footer
    faq_url: faqUrl,
    current_year: String(new Date().getFullYear()),
    support_email: supportEmail,
    label_order: copy.labelOrder,
    label_eta: copy.labelEta,
    label_status: copy.labelStatus,
    label_style_id: copy.labelStyleId,
    label_size: copy.labelSize,
    label_order_number: copy.labelOrderNumber,
    label_sale_price: copy.labelSalePrice,
    faq_intro: copy.faqIntro,
    faq_link_text: copy.faqLinkText,
    footer_rights: copy.footerRights,
    footer_sender: copy.footerSender,
    footer_help: copy.footerHelp,
    next_steps_title: copy.nextStepsTitle,
    next_step_1: nextStep1,
    next_step_2: nextStep2,
    next_step_3: nextStep3,
    closing_1: copy.closing1,
    closing_2: copy.closing2,
    laposte_ready_text: copy.laPosteReady,
    laposte_pending_text: copy.laPostePending,
    laposte_cta: copy.laPosteCta,
    laposte_tracking_url: laPosteTrackingUrlResolved,
    has_laposte_tracking: hasLaPosteTracking,
    laposte_tracking_number_label: copy.laPosteTrackingNumberLabel,
    laposte_tracking_number: laPosteTrackingNumber,
    has_laposte_tracking_number: hasLaPosteTrackingNumber,
    has_laposte_tracking_data: hasLaPosteTrackingData,
    laposte_step_active: activeIndex >= 4,
  };
}

export function createPostmarkMailer(): Mailer {
  const token = process.env.POSTMARK_SERVER_TOKEN || "";
  const from = process.env.POSTMARK_FROM_EMAIL || "";
  const fromName = (process.env.POSTMARK_FROM_NAME || "Resell Lausanne").trim();
  const fromHeader = fromName ? `${fromName} <${from}>` : from;
  const messageStreamRaw = process.env.POSTMARK_MESSAGE_STREAM || "";
  const messageStream = messageStreamRaw.trim() || undefined;
  const templateAliasNormal = (process.env.POSTMARK_TEMPLATE_ALIAS_NORMAL || "normal-ship").trim();
  const templateAliasExpress = (process.env.POSTMARK_TEMPLATE_ALIAS_EXPRESS || "express-ship").trim();

  return {
    async sendStockXMilestoneEmail(input: StockXMilestoneEmailInput): Promise<MailSendResult> {
      const overrideTo = (process.env.POSTMARK_OVERRIDE_TO || "").trim();
      const to = overrideTo || input.to;

      if (!token || !from) {
        return {
          ok: false,
          provider: "postmark",
          to,
          skipped: true,
          error:
            "Postmark not configured (missing POSTMARK_SERVER_TOKEN and/or POSTMARK_FROM_EMAIL).",
        };
      }

      const checkoutType = input.match.stockxCheckoutType || null;
      const orderNumber = input.match.stockxOrderNumber || null;
      const states = (input.stockxStates as StockXState[] | null) || null;
      const templateAlias = isExpressFlow(checkoutType, orderNumber, states)
        ? templateAliasExpress
        : templateAliasNormal;

      const templateModel = buildTemplateModel(input);

      const res = await fetch("https://api.postmarkapp.com/email/withTemplate", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": token,
        },
        body: JSON.stringify({
          From: fromHeader,
          To: to,
          TemplateAlias: templateAlias,
          TemplateModel: templateModel,
          InlineCss: true,
          MessageStream: messageStream,
        }),
      });

      const json = (await res.json().catch(() => null)) as PostmarkSendResponse | null;

      if (!res.ok) {
        return {
          ok: false,
          provider: "postmark",
          to,
          error: `Postmark HTTP ${res.status}: ${JSON.stringify(json)}`,
        };
      }

      return {
        ok: true,
        provider: "postmark",
        to,
        providerMessageId: json?.MessageID,
      };
    },
  };
}

