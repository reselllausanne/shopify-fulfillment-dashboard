export type OpsJobKey = "partner-stock-sync" | "stx-refresh" | "edi-in" | "image-sync";

export type FeedScope = "stock-price" | "full" | "master-specs" | "stock" | "price";

export type FeedTriggerSource =
  | "partner-sync"
  | "stx-refresh"
  | "manual"
  | "manual-pricing"
  | "partner-admin"
  | "order-ingest"
  | "image-sync"
  | "admin"
  | "unknown";
