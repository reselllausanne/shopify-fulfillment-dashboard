import type { MailSendResult, Mailer, StockXMilestoneEmailInput } from "@/app/lib/mailer/types";
import type { StockXState } from "@/app/lib/stockxTracking";

type PostmarkSendResponse = {
  MessageID?: string;
  ErrorCode?: number;
  Message?: string;
};

function toFrDate(d: Date | null): string | null {
  if (!d) return null;
  try {
    return d.toLocaleDateString("fr-CH", { year: "numeric", month: "2-digit", day: "2-digit" });
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

function buildTemplateModel(input: StockXMilestoneEmailInput) {
  const checkoutType = input.match.stockxCheckoutType || null;
  const isExpress = !!checkoutType && checkoutType.startsWith("EXPRESS");

  // Customer-facing steps (French). Express uses 3 steps only.
  const stepLabels = isExpress
    ? ["Commande confirmée", "Préparation express", "Livraison en cours"]
    : [
        "Commande confirmée",
        "Commande en cours chez notre partenaire",
        "Contrôle & préparation",
        "Expédition vers la Suisse",
        "Livraison en cours",
      ];
  const maxSteps = stepLabels.length;

  // Determine active step index (1..5) from StockX states progression.
  // This is more reliable than milestoneKey alone, especially for EXPRESS where StockX has fewer distinct titles.
  const states = (input.stockxStates as StockXState[] | null) || null;
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

  const shippingOriginLabel =
    checkoutType && checkoutType.startsWith("EXPRESS") ? "StockX Express" : "StockX";

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

  const emailSubject = `${input.match.shopifyOrderName} — ${input.milestone.title}`;

  const estimatedStart = input.match.stockxEstimatedDelivery;
  const estimatedEnd = input.match.stockxLatestEstimatedDelivery || input.match.stockxEstimatedDelivery;
  const estimatedEndPlus2 = addBusinessDays(estimatedEnd, 2);

  return {
    // Header
    brand_home_url: brandHomeUrl,
    brand_name: brandName,
    brand_logo_url: brandLogoUrl,
    order_name: input.match.shopifyOrderName,

    // Hero
    email_subject: emailSubject,
    preheader_text: input.milestone.description || "",
    headline: input.milestone.description || "",
    hero_text: input.milestone.description || "",
    estimated_arrival_start: toFrDate(estimatedStart),
    estimated_arrival_end: toFrDate(estimatedEndPlus2),
    hero_image_url: input.match.shopifyLineItemImageUrl || brandHeroImageUrl,
    top_note: "",
    tracking_url: input.match.stockxTrackingUrl || "",
    tracking_label: "",

    // Status
    active_step_title: stepLabels[activeIndex - 1],
    active_step_subtitle: input.milestone.description || "",
    step_1: stepLabels[0] || "",
    step_2: stepLabels[1] || "",
    step_3: stepLabels[2] || "",
    step_4: stepLabels[3] || "",
    step_5: stepLabels[4] || "",
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
      const overrideTo = process.env.POSTMARK_OVERRIDE_TO || "theomanzi10@gmail.com";
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
      const templateAlias =
        checkoutType && checkoutType.startsWith("EXPRESS")
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

