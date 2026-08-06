import { isNerWarehouseSupplierSku, galaxusLineWarehouseStockHint } from "@/galaxus/warehouse/lineInventorySource";

/** Your cut on NER partner marketplace CA (chiffre d'affaires). */
export const NER_MARGIN_SHARE_OF_CA = 0.1;

export function nerMarginFromCaChf(caChf: number): number {
  if (!Number.isFinite(caChf) || caChf <= 0) return 0;
  return caChf * NER_MARGIN_SHARE_OF_CA;
}

export function isNerGalaxusMarketplaceLine(line: {
  supplierSku?: string | null;
  providerKey?: string | null;
  supplierPid?: string | null;
  supplierVariantId?: string | null;
}): boolean {
  return galaxusLineWarehouseStockHint(line) === "NER_STOCK";
}

export function isNerDecathlonMarketplaceLine(line: {
  offerSku?: string | null;
  providerKey?: string | null;
  supplierSku?: string | null;
  partnerKey?: string | null;
  orderPartnerKey?: string | null;
}): boolean {
  if (
    isNerWarehouseSupplierSku(line.offerSku) ||
    isNerWarehouseSupplierSku(line.providerKey) ||
    isNerWarehouseSupplierSku(line.supplierSku)
  ) {
    return true;
  }
  const pk = String(line.partnerKey ?? line.orderPartnerKey ?? "")
    .trim()
    .toLowerCase();
  return pk === "ner";
}
