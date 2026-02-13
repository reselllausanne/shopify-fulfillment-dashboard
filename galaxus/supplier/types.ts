export type SupplierAuthConfig = {
  baseUrl: string;
  apiKey: string;
  apiKeyHeader: string;
  apiKeyPrefix: string;
};

export type GoldenFlatSize = {
  id: number;
  sku: string;
  product_name: string;
  brand_name: string;
  size_mapper_name: string;
  barcode?: string | null;
  size_us: string;
  size_eu?: string | null;
  offer_price?: string | null;
  presented_price?: string | null;
  available_quantity?: string | null;
  image?: string | null;
  image_full_url?: string | null;
};

export type SupplierCatalogItem = {
  supplierVariantId: string;
  supplierSku: string;
  price: number | null;
  stock: number | null;
  sizeRaw: string | null;
  images: string[];
  leadTimeDays: number | null;
  sourcePayload: GoldenFlatSize;
};

export type SupplierClient = {
  supplierKey: string;
  fetchCatalog(): Promise<SupplierCatalogItem[]>;
  fetchStockAndPrice(): Promise<SupplierCatalogItem[]>;
  createDropshipOrder?: (
    request: SupplierDropshipOrderRequest
  ) => Promise<SupplierDropshipOrderResponse>;
  getDropshipOrderDetails?: (orderId: string) => Promise<SupplierDropshipOrderDetails>;
};

export type SupplierDropshipOrderAddress = {
  name: string;
  city: string;
  zipCode: string;
  street: string;
  countryCode: string;
  phone: string;
  email: string;
};

export type SupplierDropshipOrderItem = {
  sizeId?: number;
  sku?: string;
  sizeUs?: string;
  quantity: number;
};

export type SupplierDropshipOrderRequest = {
  deliveryAddress: SupplierDropshipOrderAddress;
  clientProvidesShippingLabel?: boolean;
  items: SupplierDropshipOrderItem[];
};

export type SupplierDropshipOrderResponse = {
  orderId: string;
  totalPrice?: number | null;
  dropshipPackageId?: string | null;
  raw?: unknown;
};

export type SupplierDropshipOrderDetails = {
  orderId: string;
  status:
    | "UNCONFIRMED"
    | "TO_SHIP"
    | "ENDED"
    | "CANCELED"
    | "WAITING_FOR_INVOICE"
    | string;
  totalAmount?: number | null;
  currency?: string | null;
  createdAt?: string | null;
  dropshipPackageId?: string | null;
  trackingNumbers?: string[];
  raw?: unknown;
};
