/** Seasonal candidates (UGG / ASICS / Essentials), active, not soldes_48h. Writes /tmp/bfcm-seasonal.json */
import { writeFileSync } from "node:fs";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const Q = `query($q:String!,$cursor:String){products(first:50,after:$cursor,query:$q){pageInfo{hasNextPage endCursor}nodes{id handle title vendor tags productType totalInventory featuredImage{url} soldes:metafield(namespace:"custom",key:"soldes_48h"){value} variants(first:60){nodes{id title availableForSale inventoryQuantity price selectedOptions{name value}}}}}}`;

async function pull(q: string) {
  const out: any[] = [];
  let cursor: string | null = null;
  for (;;) {
    const r: any = await shopifyGraphQL(Q, { q, cursor });
    const p = r.data?.products ?? r.products;
    out.push(...p.nodes);
    if (!p.pageInfo.hasNextPage) break;
    cursor = p.pageInfo.endCursor;
  }
  return out;
}

(async () => {
  const res: Record<string, any[]> = {};
  for (const [k, q] of [
    ["ugg", "status:ACTIVE vendor:UGG"],
    ["asics", "status:ACTIVE vendor:ASICS"],
    ["essentials", "status:ACTIVE title:*Essentials* title:*Hoodie*"],
  ] as const) {
    const all = await pull(q);
    res[k] = all
      .filter((p) => p.soldes?.value !== "true" && !/kids|\(gs\)|\(ps\)|\(td\)|toddler|infant|baby|women|wmns|\(w\)/i.test(`${p.title} ${p.tags.join(" ")}`))
      .map((p) => ({
        handle: p.handle, title: p.title, image: p.featuredImage?.url, tags: p.tags.slice(0, 8),
        inStock: p.variants.nodes.filter((v: any) => v.availableForSale && (v.inventoryQuantity ?? 1) > 0).map((v: any) => ({ id: v.id.split("/").pop(), size: v.selectedOptions[0]?.value, price: v.price })),
      }))
      .filter((p) => p.inStock.length);
    console.log(k, all.length, "raw ->", res[k].length, "adult/non-sale in stock");
    for (const p of res[k].slice(0, 12)) console.log("  ", p.title, "|", p.inStock.map((v: any) => v.size).join(","));
  }
  writeFileSync("/tmp/bfcm-seasonal.json", JSON.stringify(res));
})();
