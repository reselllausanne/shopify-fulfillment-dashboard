/**
 * Typed business errors. `code` is stable (UI + tests switch on it); `status` is the HTTP status.
 * A thrown WarehouseError always means "nothing was written" (the transaction rolled back).
 */
export type WarehouseErrorCode =
  | "MODULE_DISABLED"
  | "WRITES_DISABLED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "OPKEY_REUSED"
  | "UNKNOWN_CODE"
  | "WRONG_CODE_TYPE"
  | "UNKNOWN_GTIN"
  | "AMBIGUOUS_GTIN"
  | "SITE_MISMATCH"
  | "SITE_NOT_IN_PILOT"
  | "LOCATION_NOT_USABLE"
  | "LEVEL_FULL"
  | "NO_SLOT_AVAILABLE"
  | "DESTINATION_MISMATCH"
  | "CONFIRMATION_REQUIRED"
  | "UNIT_NOT_PRESENT"
  | "UNIT_STATE_CONFLICT"
  | "VERSION_CONFLICT"
  | "BATCH_NOT_OPEN"
  | "SESSION_CONFLICT"
  | "SESSION_STALE"
  | "SIZE_PROFILE_MISMATCH"
  | "STORAGE_UNAVAILABLE"
  | "ALREADY_ALLOCATED"
  | "PRINT_ROUTE_MISSING"
  | "PRINT_STATE_CONFLICT"
  | "JOURNAL_NOT_EXPORTED"
  | "CONFLICT";

export class WarehouseError extends Error {
  readonly code: WarehouseErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: WarehouseErrorCode, message: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "WarehouseError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what: string, details?: Record<string, unknown>) =>
  new WarehouseError("NOT_FOUND", `${what} introuvable`, 404, details);
export const invalid = (message: string, details?: Record<string, unknown>) =>
  new WarehouseError("INVALID_INPUT", message, 400, details);
export const conflict = (code: WarehouseErrorCode, message: string, details?: Record<string, unknown>) =>
  new WarehouseError(code, message, 409, details);

export function isWarehouseError(err: unknown): err is WarehouseError {
  return err instanceof WarehouseError || (typeof err === "object" && err !== null && (err as any).name === "WarehouseError");
}

/** Postgres unique violation surfaced by Prisma (raw or model query). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as any;
  if (!e) return false;
  if (e.code === "P2002") return true;
  if (e.code === "P2010" && (e.meta?.code === "23505" || /23505|unique constraint/i.test(String(e.message)))) return true;
  return /23505|duplicate key value violates unique constraint/i.test(String(e.message ?? ""));
}

/** Serialization failure / deadlock: safe to retry the whole transaction. */
export function isRetryableTxError(err: unknown): boolean {
  const e = err as any;
  const msg = String(e?.message ?? "");
  return (
    e?.code === "P2034" ||
    /40001|40P01|deadlock detected|could not serialize access/i.test(msg) ||
    /Transaction already closed|Transaction API error/i.test(msg)
  );
}
