/** Local workflow statuses for marketplace return receipts. */
export const MARKETPLACE_RETURN_LOCAL_STATUSES = [
  "pending_receipt",
  "received",
  "rejected",
  "processing",
  "completed",
  "failed",
] as const;

export type MarketplaceReturnLocalStatus = (typeof MARKETPLACE_RETURN_LOCAL_STATUSES)[number];

/** Idempotent process checkpoint — never re-run completed remote steps. */
export const MARKETPLACE_RETURN_PROCESS_STEPS = [
  "pending",
  "receive_done",
  "refund_done",
  "close_done",
] as const;

export type MarketplaceReturnProcessStep = (typeof MARKETPLACE_RETURN_PROCESS_STEPS)[number];

export const MARKETPLACE_RETURN_PLATFORM_DECATHLON = "decathlon";

export type ReturnAuditEntry = {
  at: string;
  step: string;
  dryRun?: boolean;
  ok: boolean;
  endpoint?: string;
  request?: unknown;
  response?: unknown;
  error?: string;
};

export function isReturnAutomationDryRun(): boolean {
  const raw = String(process.env.RETURN_AUTOMATION_DRY_RUN ?? "true").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

/** Shop-specific Mirakl OR28 reason_code. Override via DECATHLON_MIRAKL_REFUND_REASON_CODE.
 * Decathlon shop RE01: code "17" = "Item returned customer wish". */
export function getDecathlonRefundReasonCode(): string {
  const fromEnv = String(process.env.DECATHLON_MIRAKL_REFUND_REASON_CODE ?? "").trim();
  return fromEnv || "17";
}

export const RETURN_SYNC_OVERLAP_MS = 5 * 60 * 1000;

/** Connect v2 active statuses for receipt workflow (exclude CLOSED / REQUEST_DECLINED). */
export const CONNECT_V2_ACTIVE_RETURN_STATUSES = "OPENED,RECEIVED";

/** RT11 active states for receipt workflow. */
export const RT11_ACTIVE_RETURN_STATES = "WAITING_ACCEPTANCE,IN_PROGRESS,RECEIVED";
