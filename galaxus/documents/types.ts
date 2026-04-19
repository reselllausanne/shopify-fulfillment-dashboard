type Money = {
  amount: number;
  currency: string;
};

export type Address = {
  name: string;
  line1: string;
  line2?: string | null;
  postalCode: string;
  city: string;
  country: string;
  vatId?: string | null;
};

export type Company = {
  name: string;
  addressLines: string[];
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  vatId?: string | null;
};

export type OrderLine = {
  lineNumber: number;
  articleNumber?: string | null;
  description: string;
  size?: string | null;
  gtin?: string | null;
  providerKey?: string | null;
  sku?: string | null;
  quantity: number;
  vatRate: number;
  unitNetPrice: number;
  lineNetAmount: number;
  /** Per unit; when set, VAT column uses this × qty (Galaxus lines often store this while vatRate is 0). */
  taxAmountPerUnit?: number | null;
};

export type VatSummaryLine = {
  vatRate: number;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
};

export type InvoiceData = {
  invoiceNumber: string;
  orderNumber?: string | null;
  orderDate: Date;
  /** Date printed as “Invoice date” (generation time). */
  invoiceDate: Date;
  deliveryDate?: Date | null;
  currency: string;
  buyer: Address;
  supplier: Company;
  lines: OrderLine[];
  vatSummary: VatSummaryLine[];
  totals: {
    net: number;
    vat: number;
    gross: number;
  };
};

export type DeliveryNoteOrderGroup = {
  orderNumber: string;
  deliveryDate?: Date | null;
  lines: OrderLine[];
};

export type DeliveryNoteData = {
  shipmentId: string;
  createdAt: Date;
  deliveryNoteNumber: string;
  incoterms?: string | null;
  buyer: Address;
  supplier: Company;
  orderReference?: string | null;
  referencePerson?: string | null;
  yourReference?: string | null;
  buyerPhone?: string | null;
  afterSalesHandling?: boolean;
  legalNotice?: string | null;
  groups: DeliveryNoteOrderGroup[];
};

export type LabelData = {
  shipmentId: string;
  orderNumbers: string[];
  sender: Address;
  recipient: Address;
  sscc: string;
  barcodeDataUrl: string;
};
