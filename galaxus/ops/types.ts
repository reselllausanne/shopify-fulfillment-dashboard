export type OpsJobKey =
  | "partner-stock-sync"
  | "stx-refresh"
  | "edi-in"
  | "image-sync"
  | "shopify-order-sync"
  | "multichannel-stock-sync"
  | "inventory-reconcile";

export type FeedScope = "stock-price" | "full" | "master-specs" | "stock" | "price";

export type FeedTriggerSource =
  | "partner-sync"
  | "stx-refresh"
  | "manual"
  | "manual-pricing"
  | "partner-admin"
  | "partner-order-fulfilled"
  | "partner-shipment-fulfilled"
  | "decathlon-partner-ship"
  | "decathlon-partner-ship-reconciled"
  | "inventory-sync"
  | "order-ingest"
  | "image-sync"
  | "admin"
  | "unknown";
