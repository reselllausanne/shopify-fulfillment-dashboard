export type EdiParty = {
  id: string;
  name: string;
  street: string;
  street2?: string | null;
  postalCode: string;
  city: string;
  country: string;
  vatId?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type EdiOrderLine = {
  lineNumber: number;
  description: string;
  quantity: number;
  unitNetPrice: number;
  lineNetAmount: number;
  vatRate: number;
  supplierPid?: string | null;
  buyerPid?: string | null;
  orderUnit?: string | null;
  providerKey?: string | null;
  gtin?: string | null;
  orderReferenceId?: string | null;
  dispatchPackages?: Array<{
    packageId: string;
    quantity: number;
  }>;
};

export type EdiTotals = {
  net: number;
  vat: number;
  gross: number;
};

export type EdiVatSummaryLine = {
  vatRate: number;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
};

export type EdiBaseDocument = {
  docId: string;
  orderId: string;
  orderNumber?: string | null;
  orderDate: Date;
  currency: string;
  buyer: EdiParty;
  supplier: EdiParty;
};

export type EdiOrderResponseDocument = EdiBaseDocument & {
  responseDate: Date;
  lines: EdiOrderLine[];
  status: "ACCEPTED" | "REJECTED" | "OUT_OF_STOCK";
  statusReason?: string | null;
  deliveryDate?: Date | null;
};

export type EdiDispatchDocument = EdiBaseDocument & {
  generationDate: Date;
  dispatchNotificationId: string;
  dispatchDate: Date;
  lines: EdiOrderLine[];
  shipmentId?: string | null;
  shipmentCarrier?: string | null;
  deliveryParty?: EdiParty | null;
};

export type EdiInvoiceDocument = EdiBaseDocument & {
  invoiceDate: Date;
  lines: EdiOrderLine[];
  totals: EdiTotals;
  vatSummary: EdiVatSummaryLine[];
};
