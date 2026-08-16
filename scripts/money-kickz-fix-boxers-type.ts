import "dotenv/config";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const IDS = [
  "gid://shopify/Product/15074846179714", // black - from final-status earlier pattern; query by handle instead
];

async function main() {
  const q = await shopifyGraphQL<{
    products: { nodes: Array<{ id: string; handle: string; productType: string; tags: string[] }> };
  }>(
    `query {
      products(first: 10, query: "tag:jmoney-kicks AND (title:Boxer OR title:Briefs)") {
        nodes { id handle productType tags }
      }
    }`
  );
  const nodes = q.data?.products?.nodes ?? [];
  console.log("found", nodes);
  for (const p of nodes) {
    const tags = (p.tags || []).filter(t => !["auth-pending","money-kickz","supplier-money-kickz"].includes(t.toLowerCase()));
    if (!tags.some(t => t.toLowerCase() === "jmoney-kicks")) tags.push("jmoney-kicks");
    const upd = await shopifyGraphQL<{ productUpdate: { userErrors: Array<{ message: string }> } }>(
      `mutation($input: ProductInput!) { productUpdate(input: $input) { userErrors { message } } }`,
      { input: { id: p.id, productType: "Underwear", tags } }
    );
    console.log(p.handle, upd.data?.productUpdate?.userErrors, "-> Underwear");
  }
}
main().catch(e=>{console.error(e); process.exit(1);});
