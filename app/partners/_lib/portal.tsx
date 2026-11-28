"use client";

import { createContext, useContext } from "react";
import type { PartnerApiError, PartnerStockSummary } from "./api";

export type PartnerInfo = {
  id: string;
  key: string;
  name: string;
};

/**
 * `loading`  — not known yet (first answer pending).
 * `enabled`  — the partner has stock in deposit: the stock area is shown.
 * `disabled` — the API answered MODULE_DISABLED: the portal stays exactly as it was.
 * `error`    — the stock service did not answer; nothing is assumed.
 */
export type StockModuleState = "loading" | "enabled" | "disabled" | "error";

export type PartnerPortalValue = {
  partner: PartnerInfo | null;
  partnerLoading: boolean;
  moduleState: StockModuleState;
  summary: PartnerStockSummary | null;
  summaryError: PartnerApiError | null;
  /** Reloads the counters (after a request was sent, for example). */
  refreshSummary: () => void;
};

const PartnerPortalContext = createContext<PartnerPortalValue | null>(null);

export const PartnerPortalProvider = PartnerPortalContext.Provider;

export function usePartnerPortal(): PartnerPortalValue {
  const value = useContext(PartnerPortalContext);
  if (!value) throw new Error("usePartnerPortal doit être utilisé dans l'espace partenaire.");
  return value;
}
