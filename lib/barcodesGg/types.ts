export type BarcodesGgSizeRow = {
  eu?: string | null;
  uk?: string | null;
  us?: string | null;
  ean?: string | null;
  upc?: string | null;
};

export type BarcodesGgProductDetails = {
  error?: boolean;
  message?: string;
  request_debited?: boolean;
  request_fulfilled?: boolean;
  product?: {
    sku?: string | null;
    title?: string | null;
    brand?: string | null;
    product_unique_id?: string | null;
    colourway?: string | null;
    sizes?: BarcodesGgSizeRow[];
  } | null;
};

export type BarcodesGgCacheStatus = "found" | "not_found" | "error";

export type PickedGtin = {
  gtin: string;
  source: "upc" | "ean";
  eu: string | null;
  us: string | null;
};
