export type DecathlonExportType = "products" | "offers";

export type DecathlonExportRow = Record<string, string | number | null | undefined>;

export type DecathlonExclusionReason =
  | "MISSING_PROVIDER_KEY"
  | "INVALID_PROVIDER_KEY"
  | "MISSING_GTIN"
  | "INVALID_GTIN"
  | "AMBIGUOUS_MAPPING"
  | "BRAND_NOT_ALLOWED"
  | "MISSING_PRODUCT_FIELDS"
  | "MISSING_OFFER_FIELDS"
  | "MISSING_PRICE"
  | "MISSING_STOCK";

export type DecathlonExclusion = {
  reason: DecathlonExclusionReason;
  message: string;
  fileType?: DecathlonExportType;
  providerKey?: string | null;
  supplierVariantId?: string | null;
  gtin?: string | null;
};

export type DecathlonExclusionSummary = {
  totals: Record<DecathlonExclusionReason, number>;
  samples: Record<DecathlonExclusionReason, DecathlonExclusion[]>;
};

export type DecathlonExportCandidate = {
  providerKey: string;
  gtin: string;
  mapping: any;
  variant: any;
  kickdbVariant: any | null;
  product: any | null;
};

export type DecathlonExportFilePayload = {
  type: DecathlonExportType;
  headers: string[];
  rows: DecathlonExportRow[];
};
