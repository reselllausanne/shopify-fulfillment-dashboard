import { fmtFactor, fmtMoney, fmtPercent } from "./format";

export type WarehousePartnerRow = {
  id: string;
  key: string;
  name: string;
  active: boolean;
  unitsHeld: number;
  unitsSaleAuthorized: number;
  unitsPriced: number;
  pricesToValidate: number;
  openRequests: number;
  agreementId: string | null;
  agreementVersion: number | null;
  saleAllowed: boolean | null;
  pricingMode: string | null;
  pricingFactor: string | null;
  pricingBasisIs: string | null;
  commissionRate: string | null;
  fixedFee: string | null;
  currency: string | null;
};

export function agreementSummary(p: Pick<WarehousePartnerRow, "agreementId" | "saleAllowed" | "pricingMode" | "pricingFactor" | "commissionRate" | "fixedFee" | "currency">): string {
  if (!p.agreementId) return "Aucun accord de dépôt";
  const parts = [p.saleAllowed ? "Vente autorisée" : "Stockage seul"];
  parts.push(p.pricingMode === "STOCKX_BUYNOW_FACTOR" ? `StockX × ${fmtFactor(p.pricingFactor)}` : "Prix saisis à la main");
  if (p.commissionRate !== null) parts.push(`commission ${fmtPercent(p.commissionRate)}`);
  if (p.fixedFee !== null && Number(p.fixedFee) > 0) parts.push(`frais fixes ${fmtMoney(p.fixedFee, p.currency)}`);
  return parts.join(" · ");
}
