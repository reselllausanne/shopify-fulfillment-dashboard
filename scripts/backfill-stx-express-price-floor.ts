/**
 * Backfill STX dropship custom.express_price to satisfy the floor
 *   express_price >= psychRoundUp(variant.price + STX_EXPRESS_SURCHARGE_CHF)
 *
 * Since Aug 25 2026 the standard SHIP_F bake jumped from 7 → 14.5 CHF but the
 * express side kept the same 5% upsell → the express metafield stopped beating
 * the standard price by any meaningful margin (Shopify orders #7111-#7113
 * paid standard prices on the express lane). This script rewrites every
 * variant where the metafield is under the floor.
 *
 * Also DELETES the express_price metafield when custom.express_available=false
 * so a hidden express option can never charge yesterday's stale price.
 *
 * Skips:
 *  - price_locked variants (Essentials / Bape / soldes) — their express price
 *    is managed by shopify/inventory/syncPhysicalExpressAvailability.
 *
 * Usage:
 *   npx tsx scripts/backfill-stx-express-price-floor.ts                # dry-run
 *   npx tsx scripts/backfill-stx-express-price-floor.ts --write        # apply
 *   npx tsx scripts/backfill-stx-express-price-floor.ts --limit 500    # cap
 */
import { shopifyGraphQL } from "../lib/shopifyAdmin";
import {
  applyStxExpressFloor,
  readStxExpressSurchargeChf,
} from "../shopify/pricing/calcShopifySellPrice";
import { parseExpressPriceMetafieldAmount } from "../shopify/restock/liquidationExpressPrice";

const WRITE = process.argv.includes("--write");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Math.max(1, Number(LIMIT_ARG.slice("--limit=".length))) : Infinity;

const PAGE_QUERY = /* GraphQL */ `
query ExpressBackfillPage($cursor: String) {
  productVariants(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      price
      priceLocked: metafield(namespace: "custom", key: "price_locked") { value }
      expressAvailable: metafield(namespace: "custom", key: "express_available") { value }
      expressPrice: metafield(namespace: "custom", key: "express_price") { value }
      product { id title handle }
    }
  }
}
`;

const SET_MUTATION = /* GraphQL */ `
mutation ExpressBackfillSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}
`;

const DELETE_MUTATION = /* GraphQL */ `
mutation ExpressBackfillDelete($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $metafields) {
    userErrors { field message }
  }
}
`;

type VariantRow = {
  id: string;
  price: string;
  priceLocked: { value: string | null } | null;
  expressAvailable: { value: string | null } | null;
  expressPrice: { value: string | null } | null;
  product: { id: string; title: string; handle: string };
};

type Bucket = "raise" | "delete_hidden" | "skip_locked" | "ok" | "no_metafield";

async function setExpressPrice(variantId: string, newPrice: number): Promise<string | null> {
  const value = JSON.stringify({ amount: newPrice.toFixed(2), currency_code: "CHF" });
  const { data, errors } = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(SET_MUTATION, {
    metafields: [
      {
        ownerId: variantId,
        namespace: "custom",
        key: "express_price",
        type: "money",
        value,
      },
    ],
  });
  if (errors?.length) return errors.map((e) => e.message).join("; ");
  const ue = data?.metafieldsSet?.userErrors ?? [];
  return ue.length ? ue.map((e) => e.message).join("; ") : null;
}

async function deleteExpressPrice(variantId: string): Promise<string | null> {
  const { data, errors } = await shopifyGraphQL<{
    metafieldsDelete: { userErrors: Array<{ message: string }> };
  }>(DELETE_MUTATION, {
    metafields: [
      { ownerId: variantId, namespace: "custom", key: "express_price" },
    ],
  });
  if (errors?.length) return errors.map((e) => e.message).join("; ");
  const ue = data?.metafieldsDelete?.userErrors ?? [];
  return ue.length ? ue.map((e) => e.message).join("; ") : null;
}

async function main() {
  const surcharge = readStxExpressSurchargeChf();
  console.log(
    JSON.stringify({ write: WRITE, limit: LIMIT === Infinity ? "all" : LIMIT, surcharge }, null, 2)
  );

  const buckets: Record<Bucket, number> = {
    raise: 0,
    delete_hidden: 0,
    skip_locked: 0,
    ok: 0,
    no_metafield: 0,
  };
  const errorsList: Array<{ variantId: string; kind: string; error: string }> = [];
  const examples: Array<{ handle: string; variant: string; from: number | null; to: number | "DELETE"; price: number }> = [];

  let cursor: string | null = null;
  let scanned = 0;
  let changed = 0;

  while (true) {
    if (scanned >= LIMIT) break;
    const { data, errors } = await shopifyGraphQL<{
      productVariants: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: VariantRow[];
      };
    }>(PAGE_QUERY, { cursor });
    if (errors?.length) {
      console.error("[FATAL] page query", errors.map((e) => e.message).join("; "));
      break;
    }
    const page = data?.productVariants;
    if (!page) break;

    for (const v of page.nodes) {
      if (scanned >= LIMIT) break;
      scanned += 1;

      const priceNum = Number(v.price);
      if (!Number.isFinite(priceNum) || priceNum <= 0) continue;

      const isLocked = String(v.priceLocked?.value ?? "").toLowerCase() === "true";
      const expressAvail = String(v.expressAvailable?.value ?? "").toLowerCase() === "true";
      const currentExpress = parseExpressPriceMetafieldAmount(v.expressPrice?.value ?? null);

      // Case A: express is hidden but a stale metafield lingers → delete.
      if (!expressAvail && currentExpress != null) {
        if (isLocked) {
          buckets.skip_locked += 1;
          continue;
        }
        buckets.delete_hidden += 1;
        examples.length < 10 &&
          examples.push({
            handle: v.product.handle,
            variant: v.id,
            from: currentExpress,
            to: "DELETE",
            price: priceNum,
          });
        if (WRITE) {
          const err = await deleteExpressPrice(v.id);
          if (err) errorsList.push({ variantId: v.id, kind: "delete", error: err });
          else changed += 1;
        }
        continue;
      }

      // Case B: express is available AND metafield present → enforce floor.
      if (expressAvail && currentExpress != null) {
        const floor = applyStxExpressFloor(priceNum, currentExpress) ?? currentExpress;
        if (floor > currentExpress + 0.5) {
          if (isLocked) {
            buckets.skip_locked += 1;
            continue;
          }
          buckets.raise += 1;
          examples.length < 10 &&
            examples.push({
              handle: v.product.handle,
              variant: v.id,
              from: currentExpress,
              to: floor,
              price: priceNum,
            });
          if (WRITE) {
            const err = await setExpressPrice(v.id, floor);
            if (err) errorsList.push({ variantId: v.id, kind: "set", error: err });
            else changed += 1;
          }
          continue;
        }
        buckets.ok += 1;
        continue;
      }

      buckets.no_metafield += 1;
    }

    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
    if (scanned % 500 === 0) {
      console.log(`[PROGRESS] scanned=${scanned} raise=${buckets.raise} delete_hidden=${buckets.delete_hidden}`);
    }
  }

  console.log("\n=== SAMPLE ===");
  for (const e of examples) {
    const to = e.to === "DELETE" ? "DELETE" : `${e.to} CHF`;
    console.log(`${e.handle} ${e.variant} price=${e.price} express: ${e.from} → ${to}`);
  }

  console.log("\n=== SUMMARY ===");
  console.log(
    JSON.stringify(
      {
        scanned,
        write: WRITE,
        changed,
        buckets,
        errors: errorsList.length,
        firstErrors: errorsList.slice(0, 5),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
