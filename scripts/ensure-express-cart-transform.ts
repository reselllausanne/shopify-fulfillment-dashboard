/**
 * Ensures the Express cart transform is active on the shop.
 *
 * Express lane = same variant + `_delivery=express` line property; the price
 * (variant metafield custom.express_price) is only charged by the
 * `express-price` cart transform function of the ALLIN-ONE-code app.
 * Deploying an app version without that extension deletes the function AND
 * the cartTransform record, silently charging Express lines the standard price.
 *
 * Usage:
 *   npx tsx scripts/ensure-express-cart-transform.ts          # check only
 *   npx tsx scripts/ensure-express-cart-transform.ts --apply  # create if missing
 */
import "dotenv/config";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const FUNCTION_HANDLE = "express-price";

type State = {
  cartTransforms: { nodes: Array<{ id: string; functionId: string; blockOnFailure: boolean }> };
  shopifyFunctions: { nodes: Array<{ id: string; title: string; apiType: string; app: { title: string } }> };
};

async function main() {
  const apply = process.argv.includes("--apply");

  const state = await shopifyGraphQL<State>(`{
    cartTransforms(first: 10) { nodes { id functionId blockOnFailure } }
    shopifyFunctions(first: 50) { nodes { id title apiType app { title } } }
  }`);
  if (state.errors?.length) throw new Error(JSON.stringify(state.errors));

  const fns = state.data.shopifyFunctions.nodes.filter((f) => f.apiType === "cart_transform");
  const transforms = state.data.cartTransforms.nodes;
  console.log("cart_transform functions:", fns.map((f) => `${f.title} ${f.id}`));
  console.log("cartTransforms:", transforms);

  if (fns.length === 0) {
    console.error(
      `No cart_transform function deployed. Deploy the "${FUNCTION_HANDLE}" extension of ALLIN-ONE-code first.`,
    );
    process.exit(2);
  }

  const active = transforms.find((t) => fns.some((f) => f.id === t.functionId));
  if (active) {
    console.log("OK: Express cart transform active:", active.id);
    return;
  }

  if (!apply) {
    console.error("MISSING: no cartTransform bound to the function. Re-run with --apply.");
    process.exit(1);
  }

  const created = await shopifyGraphQL<{
    cartTransformCreate: {
      cartTransform: { id: string; functionId: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(
    `mutation($functionId: String!) {
      cartTransformCreate(functionId: $functionId, blockOnFailure: false) {
        cartTransform { id functionId }
        userErrors { field message }
      }
    }`,
    { functionId: fns[0].id },
  );
  if (created.errors?.length) throw new Error(JSON.stringify(created.errors));
  const { cartTransform, userErrors } = created.data.cartTransformCreate;
  if (userErrors.length || !cartTransform) throw new Error(JSON.stringify(userErrors));
  console.log("CREATED:", cartTransform);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
