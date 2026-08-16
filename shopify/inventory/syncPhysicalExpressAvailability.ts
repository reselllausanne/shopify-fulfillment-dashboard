/**
 * Warehouse 48h / express eligibility.
 *
 * Rule: express 48h only when physical warehouse stock > 0
 * (Bussigny / Antica / Lab / COLD BIEN). Dropship-only → express OFF.
 * Normal sell price is never changed here.
 *
 * Applies per Shopify variant — never per product. A size can offer 48h only
 * when that exact size has physical inventory.
 */
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  readShopifyDelivery48h,
  writeShopifyDelivery48h,
} from "@/shopify/restock/bussignyDeliveryMetafield";
import {
  readShopifyExpressPriceMetafield,
  writeShopifyExpressPriceMetafield,
} from "@/shopify/restock/liquidationExpressPrice";
import {
  resolveInStockFixedPrice,
  type InStockFixedPriceConfig,
} from "@/shopify/inventory/inStockFixedPrice";

export const EXPRESS_AVAILABLE_METAFIELD = {
  namespace: "custom",
  key: "express_available",
} as const;

const READ_EXPRESS_AVAILABLE = /* GraphQL */ `
query ReadExpressAvailable($id: ID!) {
  productVariant(id: $id) {
    id
    metafield(namespace: "custom", key: "express_available") { value }
  }
}
`;

const SET_METAFIELDS = /* GraphQL */ `
mutation SetExpressAvailable($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}
`;

function isTruthyMetafield(raw: string | null | undefined): boolean {
  return String(raw ?? "").trim().toLowerCase() === "true";
}

export async function readShopifyExpressAvailable(variantId: string): Promise<boolean> {
  const { data, errors } = await shopifyGraphQL<{
    productVariant: { metafield: { value: string | null } | null } | null;
  }>(READ_EXPRESS_AVAILABLE, { id: variantId });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return isTruthyMetafield(data?.productVariant?.metafield?.value);
}

export async function writeShopifyExpressAvailable(
  variantId: string,
  available: boolean
): Promise<void> {
  const { errors, data } = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(SET_METAFIELDS, {
    metafields: [
      {
        ownerId: variantId,
        namespace: EXPRESS_AVAILABLE_METAFIELD.namespace,
        key: EXPRESS_AVAILABLE_METAFIELD.key,
        type: "boolean",
        value: available ? "true" : "false",
      },
    ],
  });
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.metafieldsSet?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}

export type SyncPhysicalExpressResult = {
  physicalQty: number;
  expressAvailable: boolean;
  delivery48h: boolean;
  changes: string[];
  warnings: string[];
};

/**
 * Sync express_available + delivery_48h from exact variant physical qty.
 * Never mutates variant.price / compareAt / price_locked.
 */
export async function syncPhysicalExpressAvailability(input: {
  variantId: string;
  physicalQty: number;
  /** When set (Essentials/Bape/…), also keeps express_price aligned while in stock. */
  fixedPriceRule?: InStockFixedPriceConfig | null;
  sku?: string | null;
  title?: string | null;
  productId?: string | null;
}): Promise<SyncPhysicalExpressResult> {
  const changes: string[] = [];
  const warnings: string[] = [];
  const physicalQty = Math.max(0, Math.floor(input.physicalQty ?? 0));
  const hasPhysical = physicalQty > 0;

  const rule =
    input.fixedPriceRule ??
    resolveInStockFixedPrice({
      sku: input.sku,
      title: input.title,
      productId: input.productId,
    });

  // Express availability is exact-variant physical availability. StockX
  // delivery lanes must never make another size appear as warehouse 48h.
  const wantExpress = hasPhysical;
  const want48h = hasPhysical && Boolean(rule);

  try {
    const hasExpress = await readShopifyExpressAvailable(input.variantId);
    if (rule) {
      if (hasExpress !== wantExpress) {
        await writeShopifyExpressAvailable(input.variantId, wantExpress);
        changes.push(
          `Shopify express_available=${wantExpress} (physical=${physicalQty})`
        );
      }
    } else if (hasExpress !== wantExpress) {
      // delivery_48h may already have been cleared by convergence. Never use it
      // as a prerequisite for clearing this exact-variant availability flag.
      await writeShopifyExpressAvailable(input.variantId, wantExpress);
      changes.push(`Shopify express_available=${wantExpress} (physical=${physicalQty})`);
    }
  } catch (err: any) {
    warnings.push(`express_available sync failed: ${err?.message ?? err}`);
  }

  try {
    if (rule) {
      const has48h = await readShopifyDelivery48h(input.variantId);
      if (has48h !== want48h) {
        await writeShopifyDelivery48h(input.variantId, want48h);
        changes.push(`Shopify delivery_48h=${want48h} (physical=${physicalQty})`);
      }
    } else if (!hasPhysical) {
      const has48h = await readShopifyDelivery48h(input.variantId);
      if (has48h) {
        await writeShopifyDelivery48h(input.variantId, false);
        changes.push(`Shopify delivery_48h=false (physical=0)`);
      }
    }
  } catch (err: any) {
    warnings.push(`delivery_48h sync failed: ${err?.message ?? err}`);
  }

  // Keep express_price amount correct while physical stock remains (Essentials 89, …).
  // When physical=0 we leave the money metafield in place but express_available=false
  // so storefront cannot offer it — normal price untouched.
  if (rule?.expressChf != null && hasPhysical) {
    try {
      const current = await readShopifyExpressPriceMetafield(input.variantId);
      if (current == null || Math.abs(current - rule.expressChf) > 0.005) {
        await writeShopifyExpressPriceMetafield(input.variantId, rule.expressChf);
        changes.push(`Shopify express_price=${rule.expressChf.toFixed(2)} (${rule.label})`);
      }
    } catch (err: any) {
      warnings.push(`express_price sync failed: ${err?.message ?? err}`);
    }
  }

  return {
    physicalQty,
    expressAvailable: wantExpress,
    delivery48h: want48h,
    changes,
    warnings,
  };
}
