import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { gtinCandidates } from "@/shopify/restock/gtinNormalize";
import { writeShopifyDelivery48h } from "@/shopify/restock/bussignyDeliveryMetafield";
import { syncLiquidationExpressPriceMetafield } from "@/shopify/restock/liquidationExpressPrice";

const METAFIELD_SET_MUTATION = /* GraphQL */ `
mutation OperatorRestockPriceLock($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}
`;

async function writeShopifyPriceLocked(variantId: string, locked: boolean): Promise<void> {
  const { errors, data } = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(METAFIELD_SET_MUTATION, {
    metafields: [
      {
        ownerId: variantId,
        namespace: "custom",
        key: "price_locked",
        type: "boolean",
        value: locked ? "true" : "false",
      },
    ],
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.metafieldsSet?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}

export const RESTOCK_FIXED_PRICE_NOTE_PREFIX = "restock:fixed-price";

export function isRestockFixedPriceNote(note: string | null | undefined): boolean {
  return /restock\s*:\s*fixed-price/i.test(String(note ?? ""));
}

export function buildRestockFixedPriceNote(compareAt: number | null): string {
  if (compareAt != null && Number.isFinite(compareAt) && compareAt > 0) {
    return `${RESTOCK_FIXED_PRICE_NOTE_PREFIX} compareAt=${compareAt.toFixed(2)}`;
  }
  return RESTOCK_FIXED_PRICE_NOTE_PREFIX;
}

export function parseRestockFixedCompareAt(note: string | null | undefined): number | null {
  const match = String(note ?? "").match(/compareAt\s*=\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Operator compare-at wins. Else keep existing sale anchor / current list if still above sell. */
export function resolveOperatorCompareAt(input: {
  salePrice: number;
  operatorCompareAt: number | null;
  currentPrice: number | null;
  currentCompareAt: number | null;
  alreadyOnSale: boolean;
}): number | null {
  const sell = input.salePrice;
  if (input.operatorCompareAt != null && input.operatorCompareAt > sell) {
    return input.operatorCompareAt;
  }
  if (
    input.alreadyOnSale &&
    input.currentCompareAt != null &&
    input.currentCompareAt > sell
  ) {
    return input.currentCompareAt;
  }
  if (input.currentPrice != null && input.currentPrice > sell) {
    return input.currentPrice;
  }
  return null;
}

/**
 * Persist operator restock prices so post-scan / cron convergence cannot
 * rewrite Shopify back to StockX −30% soldes.
 */
export async function lockOperatorRestockPrice(input: {
  gtin: string;
  variantId: string;
  salePrice: number;
  compareAtPrice: number | null;
}): Promise<{ locked: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  const salePrice = Number(input.salePrice);
  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    return { locked: false, warnings: ["operator lock skipped — invalid salePrice"] };
  }

  try {
    await writeShopifyPriceLocked(input.variantId, true);
  } catch (err: any) {
    warnings.push(`price_locked metafield failed: ${err?.message ?? err}`);
  }

  try {
    const cands = gtinCandidates(input.gtin);
    const stxRow = await prisma.supplierVariant.findFirst({
      where: {
        gtin: { in: cands.length > 0 ? cands : [input.gtin] },
        supplierVariantId: { startsWith: "stx_" },
      },
      select: { id: true, manualLock: true, manualPrice: true, manualNote: true },
    });
    if (stxRow) {
      const note = buildRestockFixedPriceNote(input.compareAtPrice);
      const needUpdate =
        !stxRow.manualLock ||
        Number(stxRow.manualPrice ?? 0) !== salePrice ||
        String(stxRow.manualNote ?? "") !== note;
      if (needUpdate) {
        await prisma.supplierVariant.update({
          where: { id: stxRow.id },
          data: {
            manualLock: true,
            manualPrice: salePrice,
            manualStock: null,
            manualUpdatedAt: new Date(),
            manualNote: note,
          },
        });
      }
    } else {
      warnings.push(
        `No stx_ row for ${input.gtin} — operator price written on Shopify, DB lock missing`
      );
    }
  } catch (err: any) {
    warnings.push(`DB operator price lock skipped: ${err?.message ?? err}`);
  }

  try {
    await writeShopifyDelivery48h(input.variantId, true);
  } catch (err: any) {
    warnings.push(`delivery_48h failed: ${err?.message ?? err}`);
  }

  try {
    await syncLiquidationExpressPriceMetafield({
      variantId: input.variantId,
      liquidationPriceChf: salePrice,
    });
  } catch (err: any) {
    warnings.push(`express_price metafield failed: ${err?.message ?? err}`);
  }

  return { locked: true, warnings };
}
