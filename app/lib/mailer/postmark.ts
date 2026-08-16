import type { MailSendResult, Mailer, StockXMilestoneEmailInput } from "@/app/lib/mailer/types";
import type { StockXState } from "@/app/lib/stockxTracking";

type PostmarkSendResponse = {
  MessageID?: string;
  ErrorCode?: number;
  Message?: string;
};

type MailLanguage = "fr" | "en";

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
  }
> = {
  fr: {
    stepLabelsStandard: [
      "Commande confirmée",
      "Authentification en cours",
      "En route vers la Suisse",
      "Livraison locale en préparation",
    ],
    stepLabelsExpress: ["Commande confirmée", "En route vers la Suisse", "Livraison locale en préparation"],
    trackingCta: "Voir le suivi complet",
    trackingPending: "Suivi en préparation",
    labelOrder: "Commande",
    labelEta: "Arrivée estimée",
    labelTracking: "Suivi",
    labelStatus: "Statut",
    labelStyleId: "ID de style",
    labelSize: "Taille",
    labelOrderNumber: "Numéro de commande",
    labelSalePrice: "Prix de vente",
    faqIntro: "Une question sur ta commande ?",
    faqLinkText: "Consulte notre page d'informations",
    footerRights: "Tous droits réservés.",
    footerSender:
      "Expéditeur: Resell Lausanne, Chemin de Bas de Plan 6, 1030 Bussigny, Suisse.",
    footerHelp: "Besoin d'aide ?",
    topNote: "Mise à jour automatique de ta commande.",
    subjectPrefix: "Suivi commande",
  },
  en: {
    stepLabelsStandard: [
      "Order confirmed",
      "Authentication in progress",
      "In transit to Switzerland",
      "Local delivery preparation",
    ],
    stepLabelsExpress: ["Order confirmed", "In transit to Switzerland", "Local delivery preparation"],
    trackingCta: "Open full tracking",
    trackingPending: "Tracking will be available soon",
    labelOrder: "Order",
    labelEta: "Estimated arrival",
    labelTracking: "Tracking",
    labelStatus: "Status",
    labelStyleId: "Style ID",
    labelSize: "Size",
    labelOrderNumber: "Order number",
    labelSalePrice: "Sale price",
    faqIntro: "Questions about your order?",
    faqLinkText: "Visit our information page",
    footerRights: "All rights reserved.",
    footerSender:
      "Sender: Resell Lausanne, Chemin de Bas de Plan 6, 1030 Bussigny, Switzerland.",
    footerHelp: "Need help?",
    topNote: "Automatic update for your order.",
    subjectPrefix: "Order update",
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
  const maxSteps = stepLabels.length;

  // Determine active step index (1..5) from StockX states progression.
  // This is more reliable than milestoneKey alone, especially for EXPRESS where StockX has fewer distinct titles.
  const completedCount = (() => {
    if (!states || states.length === 0) return 1;
    const done = states.filter((s) => {
      if (!s) return false;
      if (s.status === "UPCOMING" || s.progress === "UPCOMING") return false;
      return s.progress === "COMPLETED" || s.status === "SUCCESS";
    }).length;
    return Math.max(1, Math.min(maxSteps, done));
  })();

  const activeIndex = completedCount; // 1..5
  const styleFor = (idx: number) =>
    activeIndex === idx
      ? "font-weight:700;color:#55b3f3;"
      : "font-weight:500;color:#9ca3af;";

  const brandHomeUrl =
    process.env.BRAND_HOME_URL || process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

  const brandName = process.env.BRAND_NAME || "Resell Lausanne";
  const brandLogoUrl =
    process.env.BRAND_LOGO_URL ||
    `${brandHomeUrl.replace(/\/$/, "")}/logo.png`;

  // Hero background image (the “StockX-style” textured/duotone banner).
  // For best email-client compatibility, this should be a pre-rendered image URL (PNG/JPG/SVG).
  const brandHeroImageUrl =
    process.env.BRAND_HERO_IMAGE_URL ||
    "";

  const supportEmail = process.env.SUPPORT_EMAIL || process.env.POSTMARK_FROM_EMAIL || "";
  const faqUrl = process.env.FAQ_URL || `${brandHomeUrl.replace(/\/$/, "")}/faq`;

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
  const token = (input.match.customerTrackingToken || "").trim();
  if (token) {
    const baseUrl = brandHomeUrl.replace(/\/$/, "");
    trackingUrl = `${baseUrl}/track/${token}`;
  }

  const hasTracking = Boolean(trackingUrl);
  const activeLabel = stepLabels[activeIndex - 1] || "";

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
    tracking_label: copy.labelTracking,
    tracking_pending_text: copy.trackingPending,
    cta_track: copy.trackingCta,
    has_tracking: hasTracking,
    language,

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
    step5_active: false,
    step1_style: styleFor(1),
    step2_style: styleFor(2),
    step3_style: styleFor(3),
    step4_style: styleFor(4),
    step5_style: styleFor(4),

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
  };
}

export function createPostmarkMailer(): Mailer {
  const token = process.env.POSTMARK_SERVER_TOKEN || "";
  const from = process.env.POSTMARK_FROM_EMAIL || "";
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
          From: from,
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

