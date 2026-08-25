export const AUTO_ORDR_MODES = ["WITHOUT_POSITIONS", "WITH_ARRIVAL_DATES"] as const;
export type AutoOrdrMode = (typeof AUTO_ORDR_MODES)[number];

export const AUTO_ORDR_CATCHUP_DAYS = 14;
export const AUTO_ORDR_CATCHUP_LIMIT = 40;

export type AutoOrdrOrder = {
  cancelledAt?: Date | null;
  ordrSentAt?: Date | null;
  ordrStatus?: string | null;
  ordrMode?: string | null;
};

export function isValidOrdrMode(mode: string | null | undefined): mode is AutoOrdrMode {
  return mode === "WITHOUT_POSITIONS" || mode === "WITH_ARRIVAL_DATES";
}

/** Confirm file already accepted by our side with a spec-valid mode. */
export function hasConfirmedOrdr(order: AutoOrdrOrder): boolean {
  if (order.cancelledAt) return true;
  return Boolean(order.ordrSentAt) && order.ordrStatus === "SENT" && isValidOrdrMode(order.ordrMode);
}

export function orderNeedsAutoOrdr(order: AutoOrdrOrder): boolean {
  if (order.cancelledAt) return false;
  return !hasConfirmedOrdr(order);
}

export function assertOrdrUploaded(
  results: Array<{ docType?: string; status?: string; message?: string | null }>
): void {
  const ordr = results.find((row) => row.docType === "ORDR");
  if (!ordr) throw new Error("ORDR not returned");
  if (ordr.status !== "uploaded") {
    throw new Error(ordr.message?.trim() || `ORDR ${ordr.status ?? "failed"}`);
  }
}
