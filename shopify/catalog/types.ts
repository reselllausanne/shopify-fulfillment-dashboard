import type { ProductPricingKind } from "@/inventory/pricingPolicy";

export type ShopifyCatalogCandidate = {
  providerKey: string;
  supplierVariantId: string;
  gtin: string | null;
  title: string;
  brand: string | null;
  sizeRaw: string | null;
  sizeNormalized: string | null;
  sizeEu: string | null;
  sizeUs: string | null;
  basePrice: number;
  targetPrice: number;
  availableStock: number;
  pricingKind: ProductPricingKind;
};

export type ShopifyCatalogSyncOptions = {
  limit?: number;
  offset?: number;
  providerKeys?: string[];
  supplierKey?: string;
  inStockOnly?: boolean;
  missingOnly?: boolean;
  checkExistingOnDryRun?: boolean;
  dryRun?: boolean;
};

export type ShopifyCatalogSyncRowResult = {
  providerKey: string;
  supplierVariantId: string;
  action: "created" | "updated" | "sold_out" | "skipped" | "error";
  reason?: string;
  productId?: string | null;
  variantId?: string | null;
  inventoryItemId?: string | null;
  stock?: number;
  price?: number;
  pricingKind?: ProductPricingKind;
};

export type ShopifyCatalogSyncResult = {
  dryRun: boolean;
  scanned: number;
  created: number;
  updated: number;
  soldOut: number;
  skipped: number;
  errors: number;
  rows: ShopifyCatalogSyncRowResult[];
};
