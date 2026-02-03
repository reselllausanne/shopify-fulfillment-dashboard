export type GalaxusOrderLineInput = {
  lineNumber: number;
  supplierSku?: string;
  supplierVariantId?: string;
  productName: string;
  description?: string;
  size?: string;
  gtin?: string;
  providerKey?: string;
  quantity: number;
  vatRate: string;
  unitNetPrice: string;
  lineNetAmount: string;
  currencyCode?: string;
};

export type GalaxusShipmentInput = {
  shipmentId: string;
  deliveryNoteNumber?: string;
  deliveryNoteCreatedAt?: string;
  incoterms?: string;
  sscc?: string;
  carrier?: string;
  trackingNumber?: string;
  shippedAt?: string;
};

export type GalaxusOrderStatusEventInput = {
  source?: string;
  type: string;
  payloadJson?: unknown;
  createdAt?: string;
};

export type GalaxusOrderInput = {
  galaxusOrderId: string;
  orderNumber?: string;
  orderDate: string;
  deliveryDate?: string;
  currencyCode?: string;
  customerName: string;
  customerAddress1: string;
  customerAddress2?: string;
  customerPostalCode: string;
  customerCity: string;
  customerCountry: string;
  customerVatId?: string;
  recipientName?: string;
  recipientAddress1?: string;
  recipientAddress2?: string;
  recipientPostalCode?: string;
  recipientCity?: string;
  recipientCountry?: string;
  recipientPhone?: string;
  referencePerson?: string;
  yourReference?: string;
  afterSalesHandling?: boolean;
  lines: GalaxusOrderLineInput[];
  shipments?: GalaxusShipmentInput[];
  statusEvents?: GalaxusOrderStatusEventInput[];
};
