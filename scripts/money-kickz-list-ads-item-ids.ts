/**
 * Print Google Shopping / Ads item IDs for Money Kickz products:
 *   shopify_ch_{productId}_{variantId}
 * Usage: npx tsx scripts/money-kickz-list-ads-item-ids.ts
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

async function main() {
  const status = JSON.parse(
    readFileSync("tmp/money-kickz/final-status-2026-08-08.json", "utf8")
  ) as { rows: Array<{ id: string; handle: string; title: string }> };

  const ids = status.rows.map((r) => r.id);
  const { data, errors } = await shopifyGraphQL<{
    nodes: Array<{
      id: string;
      legacyResourceId: string;
      handle: string;
      title: string;
      variants: {
        nodes: Array<{
          id: string;
          legacyResourceId: string;
          title: string;
          selectedOptions: Array<{ name: string; value: string }>;
        }>;
      };
    } | null>;
  }>(
    `query($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          legacyResourceId
          handle
          title
          variants(first: 100) {
            nodes {
              id
              legacyResourceId
              title
              selectedOptions { name value }
            }
          }
        }
      }
    }`,
    { ids }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));

  const lines: string[] = [];
  const detail: Array<Record<string, string>> = [];

  for (const p of (data?.nodes ?? []).filter(Boolean) as NonNullable<
    (typeof data)["nodes"][number]
  >[]) {
    for (const v of p.variants.nodes) {
      const itemId = `shopify_ch_${p.legacyResourceId}_${v.legacyResourceId}`;
      lines.push(itemId);
      const size =
        v.selectedOptions.find((o) => /size|taille/i.test(o.name))?.value ?? v.title;
      detail.push({
        itemId,
        handle: p.handle,
        title: p.title,
        size,
        productId: p.legacyResourceId,
        variantId: v.legacyResourceId,
      });
    }
  }

  const outDir = path.join(process.cwd(), "tmp/money-kickz");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "mk-ads-item-ids.txt"), lines.join("\n") + "\n");
  writeFileSync(path.join(outDir, "mk-ads-item-ids-detail.json"), JSON.stringify(detail, null, 2));

  // stdout = pasteable list only
  console.log(lines.join("\n"));
  console.error(`count=${lines.length} products=${status.rows.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
