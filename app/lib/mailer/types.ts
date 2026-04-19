export type MailSendResult =
  | { ok: true; provider: string; providerMessageId?: string; to: string }
  | { ok: false; provider: string; to: string; error: string; skipped?: boolean };

export type StockXMilestoneEmailInput = {
  to: string;
  stockxStates?: any[] | null;
  match: {
    id: string;
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
    stockxEstimatedDelivery: Date | null; // estimated_arrival_start
    stockxLatestEstimatedDelivery: Date | null; // estimated_arrival_end
  };
  milestone: {
    key: string;
    title: string;
    description: string;
  };
};

export type Mailer = {
  sendStockXMilestoneEmail(input: StockXMilestoneEmailInput): Promise<MailSendResult>;
};

