import { convergeVariant } from "../shopify/inventory/convergence";
import { findShopifyVariantByGtin } from "../shopify/restock/shopifyRestockInventory";
import { applyLiquidationSaleDisplay } from "../shopify/restock/liquidationPricing";
import { prisma } from "../app/lib/prisma";

const gtins = process.argv.slice(2);
if (!gtins.length) throw new Error("usage: retry-gtins.ts <gtin...>");

async function main() {
  for (const gtin of gtins) {
    await new Promise((r) => setTimeout(r, 4000));
    const { match } = await findShopifyVariantByGtin(gtin);
    if (match) {
      const liq = await applyLiquidationSaleDisplay({
        gtin,
        variant: match,
        slug: match.productHandle,
        sizeEu: match.variantTitle,
      });
      console.log(gtin, "liq", liq.applied, liq.salePrice, liq.warnings.join(";"));
    }
    const res = await convergeVariant(gtin, { postPhysicalRestock: true });
    console.log(gtin, "converge", res.desired, res.changed, res.error ?? "", res.warnings.join(";"));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
