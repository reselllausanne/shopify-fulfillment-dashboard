/**
 * Tags: remove auth-pending + money-kickz variants, keep single `jmoney-kicks`.
 * Product type: Streetwear on apparel/streetwear SKUs.
 * Usage: npx tsx scripts/money-kickz-fix-tags-type.ts --write
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const WRITE = process.argv.includes("--write");
const KEEP_TAG = "jmoney-kicks";
const DROP_TAGS = new Set([
  "auth-pending",
  "money-kickz",
  "supplier-money-kickz",
  "jmoney kicks",
  "jmoney kicz",
  "jmoneykicks",
  "j money kicks",
]);

function isStreetwear(title: string, handle: string, productType: string): boolean {
  const t = `${title} ${handle} ${productType}`.toLowerCase();
  // Underwear packs stay non-Streetwear
  if (/boxer|briefs/.test(t)) return false;
  // Rest of MK drop = streetwear (tees, hoodies, socks, hat, keychain…)
  return true;
}

async function main() {
  const status = JSON.parse(
    readFileSync("tmp/money-kickz/final-status-2026-08-08.json", "utf8")
  ) as { rows: Array<{ id: string; handle: string }> };

  const ids = status.rows.map((r) => r.id);
  const { data, errors } = await shopifyGraphQL<{
    nodes: Array<{
      id: string;
      handle: string;
      title: string;
      tags: string[];
      productType: string;
    } | null>;
  }>(
    `query($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product { id handle title tags productType }
      }
    }`,
    { ids }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));

  const report: Array<Record<string, unknown>> = [];

  for (const product of (data?.nodes ?? []).filter(Boolean) as NonNullable<
    (typeof data)["nodes"][number]
  >[]) {
    const beforeTags = [...(product.tags ?? [])];
    const nextTags = beforeTags.filter((t) => !DROP_TAGS.has(t.toLowerCase()));
    if (!nextTags.some((t) => t.toLowerCase() === KEEP_TAG)) {
      nextTags.push(KEEP_TAG);
    }

    const streetwear = isStreetwear(product.title, product.handle, product.productType);
    const nextType = streetwear ? "Streetwear" : product.productType;

    const tagsChanged =
      JSON.stringify([...beforeTags].map((t) => t.toLowerCase()).sort()) !==
      JSON.stringify([...nextTags].map((t) => t.toLowerCase()).sort());
    const typeChanged = streetwear && product.productType !== "Streetwear";

    if (!tagsChanged && !typeChanged) {
      report.push({
        handle: product.handle,
        status: "noop",
        tags: nextTags,
        productType: product.productType,
      });
      continue;
    }

    if (WRITE) {
      const input: Record<string, unknown> = { id: product.id };
      if (tagsChanged) input.tags = nextTags;
      if (typeChanged) input.productType = nextType;

      const upd = await shopifyGraphQL<{
        productUpdate: { userErrors: Array<{ message: string }> };
      }>(
        `mutation($input: ProductInput!) {
          productUpdate(input: $input) { userErrors { message } }
        }`,
        { input }
      );
      const ue = upd.data?.productUpdate?.userErrors ?? [];
      if (upd.errors?.length || ue.length) {
        throw new Error(
          `${product.handle}: ${
            (upd.errors ?? []).map((e) => e.message).join("; ") ||
            ue.map((e) => e.message).join("; ")
          }`
        );
      }
    }

    report.push({
      handle: product.handle,
      status: WRITE ? "updated" : "would_update",
      tagsBefore: beforeTags,
      tagsAfter: nextTags,
      productTypeBefore: product.productType,
      productTypeAfter: nextType,
      streetwear,
    });
    console.log(
      `${WRITE ? "OK" : "WOULD"} ${product.handle} tags=${nextTags.join(",")} type=${nextType}`
    );
  }

  const outDir = path.join(process.cwd(), "tmp/money-kickz");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "fix-tags-type.json");
  writeFileSync(
    outPath,
    JSON.stringify({ at: new Date().toISOString(), write: WRITE, keepTag: KEEP_TAG, report }, null, 2)
  );

  console.log(
    JSON.stringify(
      {
        write: WRITE,
        updated: report.filter((r) => String(r.status).includes("update")).length,
        streetwearSet: report.filter((r) => r.streetwear && r.productTypeAfter === "Streetwear")
          .length,
        skippedUnderwearSocks: report.filter((r) => r.streetwear === false).length,
        outPath,
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
