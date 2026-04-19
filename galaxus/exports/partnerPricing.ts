import { prisma } from "@/app/lib/prisma";
import type { PricingOverrides } from "@/galaxus/exports/pricing";

/** Minimal Prisma select to know which supplier prefixes are partner-sourced. */
export const PARTNER_KEY_SELECT = { key: true } as const;

/** @deprecated Same as {@link PARTNER_KEY_SELECT}; kept for older imports. */
export const PARTNER_PRICING_SELECT = PARTNER_KEY_SELECT;

export function partnerKeysLowerSet(partners: { key: string }[]): Set<string> {
  return new Set(partners.map((p) => String(p.key ?? "").toLowerCase()).filter(Boolean));
}

export async function loadPartnerKeysLowerFromDb(): Promise<Set<string>> {
  const rows = await prisma.partner.findMany({ select: PARTNER_KEY_SELECT });
  return partnerKeysLowerSet(rows);
}

/**
 * @deprecated Partner row pricing overrides were removed; this always returns `null` so callers fall back to globals.
 * Prefer {@link partnerKeysLowerSet} + {@link resolveGalaxusSellExVatForChannel} from `@/galaxus/exports/pricing`.
 */
export function createResolvePartnerPricingOverrides(
  _partners: { key: string }[]
): (supplierKey: string | null) => PricingOverrides | null {
  return () => null;
}
