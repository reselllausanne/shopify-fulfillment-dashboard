export type OpsJobKey = "partner-stock-sync" | "stx-refresh" | "edi-in";

export type FeedScope = "stock-price" | "full";

export type FeedTriggerSource =
  | "partner-sync"
  | "stx-refresh"
  | "manual"
  | "manual-pricing"
  | "partner-admin"
  | "order-ingest"
  | "admin"
  | "unknown";
