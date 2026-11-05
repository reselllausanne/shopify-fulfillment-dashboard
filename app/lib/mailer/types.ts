export type MailSendResult =
  | { ok: true; provider: string; providerMessageId?: string; to: string }
  | { ok: false; provider: string; to: string; error: string; skipped?: boolean };

/** Optional presentation overrides (delay / cancel-rebuy apology mails). */
export type StockXMilestoneTemplateOverrides = {
  /** Full subject line (replaces default "Suivi commande #…"). */
  emailSubject?: string;
  headline?: string;
  statusNote?: string;
  preheaderText?: string;
  /** 1–4 status tracker active step. */
  activeStepIndex?: 1 | 2 | 3 | 4;
  /** When set, used as ETA window (skips +2 business-day pad). */
  estimatedArrivalStart?: Date | null;
  estimatedArrivalEnd?: Date | null;
  nextStep1?: string;
  nextStep2?: string;
  nextStep3?: string;
};

export type StockXMilestoneEmailInput = {
  to: string;
  stockxStates?: any[] | null;
  language?: "fr" | "en" | "de";
  /** Shopify order customerLocale (de-CH, fr-CH, en). Wins over the email-domain guess. */
  customerLocale?: string | null;
  /** TEST / forced recipient — do not redirect via POSTMARK_OVERRIDE_TO. */
  ignoreOverride?: boolean;
  /** Delay / cancel-rebuy copy + ETA on the same Postmark ship templates. */
  templateOverrides?: StockXMilestoneTemplateOverrides;
  match: {
    id: string;
    customerTrackingToken?: string | null;
    shopifyOrderName: string;
    shopifyProductTitle: string;
    shopifySku?: string | null;
    shopifySizeEU?: string | null;
    shopifyTotalPriceChf?: number | null;
    shopifyLineItemImageUrl: string | null;
    shopifyCustomerFirstName: string | null;
    shopifyCustomerLastName: string | null;
    stockxCheckoutType?: string | null;
    stockxOrderNumber?: string | null;
    stockxSkuKey?: string | null;
    stockxSizeEU?: string | null;
    stockxTrackingUrl: string | null;
    stockxAwb: string | null;
    swissPostTrackingUrl?: string | null;
    swissPostTrackingNumber?: string | null;
    stockxEstimatedDelivery: Date | null; // estimated_arrival_start
    stockxLatestEstimatedDelivery: Date | null; // estimated_arrival_end
  };
  milestone: {
    key: string;
    title: string;
    description: string;
  };
};

export type RawEmailInput = {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  /** Internal/ops mail must ignore POSTMARK_OVERRIDE_TO (always reach the operator). */
  ignoreOverride?: boolean;
};

export type Mailer = {
  sendStockXMilestoneEmail(input: StockXMilestoneEmailInput): Promise<MailSendResult>;
  sendRawEmail(input: RawEmailInput): Promise<MailSendResult>;
};

