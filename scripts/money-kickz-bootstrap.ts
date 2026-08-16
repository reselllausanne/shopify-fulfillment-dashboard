/**
 * Money Kickz PHASE 1 bootstrap — create/update Shopify products + supplier location stock.
 *
 * Usage:
 *   npx tsx scripts/money-kickz-bootstrap.ts           # dry-run
 *   npx tsx scripts/money-kickz-bootstrap.ts --write    # apply
 *
 * Requires SHOPIFY_LOC_MONEY_KICKZ (no default fallback).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { setInventoryQuantity } from "@/shopify/catalog/graphql";

const WRITE = process.argv.includes("--write");
const LOCATION_ID = (process.env.SHOPIFY_LOC_MONEY_KICKZ ?? "").trim();
const BUFFER = Number(process.env.SUPPLIER_STOCK_BUFFER ?? "2");
const MAX_PER = Number(process.env.SUPPLIER_STOCK_MAX_PER_VARIANT ?? "5");
const SNAPSHOT_DATE = "2026-08-08";
const SOURCE_MESSAGE_ID = `money-kickz-whatsapp-${SNAPSHOT_DATE}`;

type VariantOffer = { size: string; supplier_quantity: number };
type Offer = {
  key: string;
  title: string;
  brand: string;
  vendor?: string;
  supplier_unit_cost: number;
  variants: VariantOffer[];
  note?: string;
  official_url?: string;
  /** Forced Shopify product GID when known match */
  matchProductId?: string;
  matchHandle?: string;
  matchConfidence: "exact" | "strong" | "none";
  identity_confidence: number;
  image_source_url?: string | null;
  needsExactImage?: boolean;
};

function shopifyQty(raw: number): number {
  return Math.min(Math.max(raw - BUFFER, 0), MAX_PER);
}

function retailChf(costUsd: number, brand: string, title: string): number {
  const b = brand.toLowerCase();
  const t = title.toLowerCase();
  if (b.includes("bape") && /tee|t-shirt|t shirt/.test(t) && costUsd === 40) return 89;
  if (costUsd === 50) return 99;
  return Math.round(costUsd * 2 * 100) / 100;
}

function costChfApprox(costUsd: number): number {
  // Conservative USD→CHF for inventory cost metafield only (retail uses fixed rules).
  const fx = Number(process.env.USD_CHF_RATE ?? "0.88");
  return Math.round(costUsd * fx * 100) / 100;
}

function productKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeSizeLabel(size: string): string {
  const s = size.trim();
  if (/^6-12/i.test(s) || /^one size$/i.test(s) || /^os$/i.test(s)) return "One Size";
  return s;
}

const OFFERS: Offer[] = [
  {
    key: "supreme-digital-camera-keychain-white",
    title: "Supreme Digital Camera Keychain White",
    brand: "Supreme",
    supplier_unit_cost: 100,
    variants: [{ size: "One Size", supplier_quantity: 200 }],
    matchProductId: "gid://shopify/Product/15224602132866",
    matchHandle: "supreme-digital-camera-keychain-white",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "supreme-hanes-boxer-briefs-4-pack-black",
    title: "Supreme Hanes Boxer Briefs (4 Pack) Black",
    brand: "Supreme",
    supplier_unit_cost: 22.5,
    variants: [
      { size: "S", supplier_quantity: 50 },
      { size: "M", supplier_quantity: 50 },
      { size: "L", supplier_quantity: 50 },
    ],
    note: "Cost is for one sealed 4-pack",
    matchProductId: "gid://shopify/Product/15074846179714",
    matchHandle: "supreme-hanes-boxer-briefs-black",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "supreme-hanes-boxer-briefs-4-pack-white",
    title: "Supreme Hanes Boxer Briefs (4 Pack) White",
    brand: "Supreme",
    supplier_unit_cost: 22.5,
    variants: [
      { size: "S", supplier_quantity: 50 },
      { size: "M", supplier_quantity: 50 },
      { size: "L", supplier_quantity: 50 },
    ],
    note: "Cost is for one sealed 4-pack",
    matchProductId: "gid://shopify/Product/15075733504386",
    matchHandle: "supreme-hanes-boxer-briefs-white",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "alo-unisex-half-crew-throwback-sock-black-white",
    title: "Alo Unisex Half-Crew Throwback Sock Black/White",
    brand: "ALO",
    vendor: "Alo Yoga",
    official_url:
      "https://www.aloyoga.com/products/a0480u-unisex-half-crew-throwback-sock-black-white",
    supplier_unit_cost: 8.5,
    variants: [{ size: "M", supplier_quantity: 100 }],
    matchConfidence: "none",
    identity_confidence: 0.85,
    image_source_url:
      "https://www.aloyoga.com/products/a0480u-unisex-half-crew-throwback-sock-black-white",
    needsExactImage: true,
  },
  {
    key: "alo-unisex-half-crew-throwback-sock-white-black",
    title: "Alo Unisex Half-Crew Throwback Sock White/Black",
    brand: "ALO",
    vendor: "Alo Yoga",
    official_url:
      "https://www.aloyoga.com/products/a0480u-unisex-half-crew-throwback-sock-white-black",
    supplier_unit_cost: 8.5,
    variants: [{ size: "M", supplier_quantity: 100 }],
    matchConfidence: "none",
    identity_confidence: 0.85,
    image_source_url:
      "https://www.aloyoga.com/products/a0480u-unisex-half-crew-throwback-sock-white-black",
    needsExactImage: true,
  },
  {
    key: "supreme-hanes-crew-socks-4-pack-heather-grey",
    title: "Supreme Hanes Crew Socks (4 Pack) Heather Grey",
    brand: "Supreme",
    supplier_unit_cost: 20,
    variants: [{ size: "6-12 / One Size", supplier_quantity: 100 }],
    note: "Cost is for one sealed 4-pack",
    matchProductId: "gid://shopify/Product/15379115934082",
    matchHandle: "supreme-hanes-crew-socks-4-pack-heather-grey",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "supreme-hanes-crew-socks-4-pack-black",
    title: "Supreme Hanes Crew Socks (4 Pack) Black",
    brand: "Supreme",
    supplier_unit_cost: 20,
    variants: [{ size: "6-12 / One Size", supplier_quantity: 50 }],
    note: "Existing Shopify title omits Crew; strong match",
    matchProductId: "gid://shopify/Product/15078998606210",
    matchHandle: "supreme-hanes-socks-4-pack-black",
    matchConfidence: "strong",
    identity_confidence: 0.9,
  },
  {
    key: "supreme-hanes-crew-socks-4-pack-white",
    title: "Supreme Hanes Crew Socks (4 Pack) White",
    brand: "Supreme",
    supplier_unit_cost: 20,
    variants: [{ size: "6-12 / One Size", supplier_quantity: 50 }],
    matchProductId: "gid://shopify/Product/15077869289858",
    matchHandle: "supreme-hanes-crew-socks-4-pack-white",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "godspeed-gs-forever-trucker-hat-og",
    title: "Godspeed GS Forever Trucker Hat OG",
    brand: "Godspeed",
    supplier_unit_cost: 80,
    variants: [{ size: "One Size", supplier_quantity: 20 }],
    note: "No exact OG match on store (Vanta/Yellow differ) — CREATE DRAFT",
    matchConfidence: "none",
    identity_confidence: 0.7,
    needsExactImage: true,
  },
  {
    key: "alo-accolade-hoodie-athletic-heather-grey",
    title: "Alo Accolade Hoodie Athletic Heather Grey",
    brand: "ALO",
    vendor: "Alo Yoga",
    official_url:
      "https://www.aloyoga.com/products/w3550rg-accolade-hoodie-athletic-heather-grey",
    supplier_unit_cost: 50,
    variants: [
      { size: "XS", supplier_quantity: 2 },
      { size: "S", supplier_quantity: 29 },
      { size: "M", supplier_quantity: 20 },
      { size: "L", supplier_quantity: 37 },
      { size: "XL", supplier_quantity: 13 },
    ],
    matchProductId: "gid://shopify/Product/15375599763842",
    matchHandle: "alo-yoga-accolade-cotton-blend-fleece-sweatshirt-athletic-heather-grey",
    matchConfidence: "strong",
    identity_confidence: 0.9,
  },
  {
    key: "alo-accolade-hoodie-black",
    title: "Alo Accolade Hoodie Black",
    brand: "ALO",
    vendor: "Alo Yoga",
    official_url: "https://www.aloyoga.com/products/w3550rg-accolade-hoodie-black-mens",
    supplier_unit_cost: 50,
    variants: [
      { size: "XS", supplier_quantity: 5 },
      { size: "S", supplier_quantity: 24 },
      { size: "M", supplier_quantity: 31 },
      { size: "L", supplier_quantity: 49 },
      { size: "XL", supplier_quantity: 18 },
    ],
    matchProductId: "gid://shopify/Product/15374626390402",
    matchHandle: "alo-yoga-accolade-cotton-blend-hoodie-black",
    matchConfidence: "strong",
    identity_confidence: 0.9,
  },
  {
    key: "alo-accolade-1-4-zip-pullover-black",
    title: "Alo Accolade 1/4 Zip Pullover Black",
    brand: "ALO",
    vendor: "Alo Yoga",
    official_url: "https://www.aloyoga.com/products/u3040rg-accolade-1-4-zip-pullover-black",
    supplier_unit_cost: 50,
    variants: [
      { size: "XS", supplier_quantity: 4 },
      { size: "S", supplier_quantity: 23 },
      { size: "M", supplier_quantity: 30 },
      { size: "L", supplier_quantity: 20 },
      { size: "XL", supplier_quantity: 13 },
    ],
    matchConfidence: "none",
    identity_confidence: 0.85,
    image_source_url:
      "https://www.aloyoga.com/products/u3040rg-accolade-1-4-zip-pullover-black",
    needsExactImage: true,
  },
  {
    key: "bape-color-camo-big-ape-head-tee-white-red",
    title: "BAPE Color Camo Big Ape Head Tee White Red",
    brand: "BAPE",
    supplier_unit_cost: 40,
    variants: [
      { size: "S", supplier_quantity: 19 },
      { size: "M", supplier_quantity: 19 },
      { size: "L", supplier_quantity: 4 },
      { size: "XL", supplier_quantity: 8 },
    ],
    matchProductId: "gid://shopify/Product/15375243215234",
    matchHandle: "bape-color-camo-big-ape-head-t-shirt-ss20-white-red",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "bape-college-tee-white",
    title: "BAPE College Tee White",
    brand: "BAPE",
    supplier_unit_cost: 40,
    variants: [
      { size: "S", supplier_quantity: 9 },
      { size: "M", supplier_quantity: 15 },
      { size: "L", supplier_quantity: 12 },
    ],
    matchProductId: "gid://shopify/Product/15376195584386",
    matchHandle: "bape-college-tee-white",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "bape-color-camo-big-ape-head-tee-white-purple",
    title: "BAPE Color Camo Big Ape Head Tee White Purple",
    brand: "BAPE",
    supplier_unit_cost: 40,
    variants: [
      { size: "S", supplier_quantity: 19 },
      { size: "M", supplier_quantity: 11 },
      { size: "L", supplier_quantity: 10 },
      { size: "XL", supplier_quantity: 12 },
    ],
    matchProductId: "gid://shopify/Product/15376438919554",
    matchHandle: "bape-color-camo-big-ape-head-tee-ss23-white-purple",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "bape-color-camo-by-bathing-ape-tee-white-navy",
    title: "BAPE Color Camo By Bathing Ape Tee White Navy",
    brand: "BAPE",
    supplier_unit_cost: 40,
    variants: [
      { size: "S", supplier_quantity: 41 },
      { size: "M", supplier_quantity: 43 },
      { size: "L", supplier_quantity: 37 },
      { size: "XL", supplier_quantity: 29 },
    ],
    matchProductId: "gid://shopify/Product/15375984099714",
    matchHandle: "bape-color-camo-by-bathing-ape-tee-ss22-white-navy",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "bape-a-bathing-ape-check-by-bathing-tee-white-beige",
    title: "BAPE A Bathing Ape Check By Bathing Tee White Beige",
    brand: "BAPE",
    supplier_unit_cost: 40,
    variants: [
      { size: "S", supplier_quantity: 15 },
      { size: "M", supplier_quantity: 15 },
      { size: "L", supplier_quantity: 16 },
    ],
    matchProductId: "gid://shopify/Product/15356478325122",
    matchHandle: "bape-a-bathing-ape-check-by-bathing-tee-white-beige",
    matchConfidence: "exact",
    identity_confidence: 0.98,
  },
  {
    key: "bape-sakura-tree-tee-black",
    title: "BAPE Sakura Tree Tee Black",
    brand: "BAPE",
    supplier_unit_cost: 40,
    variants: [
      { size: "S", supplier_quantity: 10 },
      { size: "M", supplier_quantity: 8 },
      { size: "L", supplier_quantity: 9 },
    ],
    matchProductId: "gid://shopify/Product/15356478423426",
    matchHandle: "bape-sakura-tree-tee-black",
    matchConfidence: "exact",
    identity_confidence: 0.98,
  },
  {
    key: "bape-color-camo-big-ape-head-tee-black-navy",
    title: "BAPE Color Camo Big Ape Head Tee Black Navy",
    brand: "BAPE",
    supplier_unit_cost: 40,
    variants: [
      { size: "S", supplier_quantity: 29 },
      { size: "M", supplier_quantity: 27 },
      { size: "L", supplier_quantity: 18 },
      { size: "XL", supplier_quantity: 18 },
    ],
    note: "Only Transform variant on store — different design; CREATE DRAFT",
    matchConfidence: "none",
    identity_confidence: 0.75,
    needsExactImage: true,
  },
  {
    key: "bape-color-camo-big-ape-head-tee-black-red",
    title: "BAPE Color Camo Big Ape Head Tee Black Red",
    brand: "BAPE",
    supplier_unit_cost: 40,
    variants: [
      { size: "S", supplier_quantity: 51 },
      { size: "M", supplier_quantity: 63 },
      { size: "L", supplier_quantity: 16 },
      { size: "XL", supplier_quantity: 15 },
    ],
    matchProductId: "gid://shopify/Product/15356478390658",
    matchHandle: "bape-color-camo-big-ape-head-t-shirt-ss20-black-red",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  // --- additional 10 ---
  {
    key: "bape-college-tee-black",
    title: "BAPE College Tee Black",
    brand: "BAPE",
    supplier_unit_cost: 40,
    variants: [
      { size: "S", supplier_quantity: 38 },
      { size: "M", supplier_quantity: 35 },
      { size: "L", supplier_quantity: 31 },
      { size: "XL", supplier_quantity: 14 },
    ],
    note: "DM for pricing — cost set to 40 per BAPE rule",
    matchProductId: "gid://shopify/Product/15224604295554",
    matchHandle: "bape-college-tee-black",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "bape-color-camo-big-ape-head-tee-black-purple",
    title: "BAPE Color Camo Big Ape Head Tee Black Purple",
    brand: "BAPE",
    supplier_unit_cost: 40,
    variants: [
      { size: "S", supplier_quantity: 14 },
      { size: "M", supplier_quantity: 11 },
      { size: "L", supplier_quantity: 3 },
      { size: "XL", supplier_quantity: 10 },
    ],
    note: "DM for pricing — cost 40",
    matchProductId: "gid://shopify/Product/15373575520642",
    matchHandle: "bape-color-camo-big-ape-head-tee-ss23-black-purple",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "bape-abc-camo-by-bathing-ape-tee-black-pink",
    title: "BAPE ABC Camo By Bathing Ape Tee Black Pink",
    brand: "BAPE",
    supplier_unit_cost: 40,
    variants: [
      { size: "S", supplier_quantity: 20 },
      { size: "M", supplier_quantity: 10 },
      { size: "L", supplier_quantity: 4 },
      { size: "XL", supplier_quantity: 6 },
    ],
    note: "DM for pricing — cost 40",
    matchProductId: "gid://shopify/Product/15373266387330",
    matchHandle: "bape-abc-camo-by-bathing-ape-tee-black-pink",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "stussy-x-our-legacy-8-ball-yin-yang-pigment-dyed-tee-black",
    title: "Stussy x Our Legacy Work Shop 8 Ball Yin Yang Pigment Dyed Tee Black",
    brand: "Stussy",
    supplier_unit_cost: 30,
    variants: [
      { size: "S", supplier_quantity: 5 },
      { size: "M", supplier_quantity: 5 },
      { size: "L", supplier_quantity: 5 },
      { size: "XL", supplier_quantity: 5 },
    ],
    matchProductId: "gid://shopify/Product/15374271185282",
    matchHandle: "stussy-x-our-legacy-work-shop-8-ball-yin-yang-pigment-dyed-tee-black",
    matchConfidence: "exact",
    identity_confidence: 0.98,
  },
  {
    key: "stussy-fuzzy-dice-tee-white",
    title: "Stussy Fuzzy Dice Tee White",
    brand: "Stussy",
    supplier_unit_cost: 30,
    variants: [
      { size: "S", supplier_quantity: 5 },
      { size: "M", supplier_quantity: 5 },
      { size: "L", supplier_quantity: 5 },
      { size: "XL", supplier_quantity: 5 },
    ],
    matchProductId: "gid://shopify/Product/15378982076802",
    matchHandle: "stussy-fuzzy-dice-tee-white",
    matchConfidence: "exact",
    identity_confidence: 0.98,
  },
  {
    key: "stussy-basic-t-shirt-white",
    title: "Stussy Basic T-Shirt White",
    brand: "Stussy",
    supplier_unit_cost: 30,
    variants: [
      { size: "S", supplier_quantity: 5 },
      { size: "M", supplier_quantity: 5 },
      { size: "XL", supplier_quantity: 5 },
    ],
    note: "No L in supplier message — do not create L",
    matchProductId: "gid://shopify/Product/15114994090370",
    matchHandle: "stussy-basic-t-shirt-white",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "stussy-basic-t-shirt-black",
    title: "Stussy Basic T-Shirt Black",
    brand: "Stussy",
    supplier_unit_cost: 32.5,
    variants: [
      { size: "S", supplier_quantity: 20 },
      { size: "M", supplier_quantity: 20 },
      { size: "L", supplier_quantity: 20 },
    ],
    note: "No XL in supplier message — do not create XL",
    matchProductId: "gid://shopify/Product/15356478259586",
    matchHandle: "stussy-basic-t-shirt-black",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "stussy-fuzzy-dice-tee-black",
    title: "Stussy Fuzzy Dice Tee Black",
    brand: "Stussy",
    supplier_unit_cost: 30,
    variants: [
      { size: "S", supplier_quantity: 5 },
      { size: "M", supplier_quantity: 5 },
      { size: "L", supplier_quantity: 5 },
      { size: "XL", supplier_quantity: 5 },
    ],
    matchProductId: "gid://shopify/Product/15356478226818",
    matchHandle: "stussy-fuzzy-dice-tee-black",
    matchConfidence: "exact",
    identity_confidence: 0.98,
  },
  {
    key: "fear-of-god-essentials-nba-tee-light-heather",
    title: "Fear of God Essentials NBA Tee Light Heather",
    brand: "Fear of God Essentials",
    vendor: "Fear of God",
    supplier_unit_cost: 25,
    variants: [
      { size: "XS", supplier_quantity: 5 },
      { size: "S", supplier_quantity: 5 },
      { size: "M", supplier_quantity: 5 },
      { size: "L", supplier_quantity: 5 },
      { size: "XL", supplier_quantity: 5 },
    ],
    note: "Supplier wrote pairs — treated as units",
    matchProductId: "gid://shopify/Product/15356478128514",
    matchHandle: "fear-of-god-essentials-nba-tee-light-heather",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
  {
    key: "fear-of-god-essentials-nba-tee-black",
    title: "Fear of God Essentials NBA Tee Black",
    brand: "Fear of God Essentials",
    vendor: "Fear of God",
    supplier_unit_cost: 25,
    variants: [
      { size: "XS", supplier_quantity: 5 },
      { size: "S", supplier_quantity: 5 },
      { size: "M", supplier_quantity: 5 },
      { size: "L", supplier_quantity: 5 },
      { size: "XL", supplier_quantity: 5 },
    ],
    note: "Supplier wrote pairs — treated as units",
    matchProductId: "gid://shopify/Product/15356478194050",
    matchHandle: "fear-of-god-essentials-nba-tee-black",
    matchConfidence: "exact",
    identity_confidence: 0.95,
  },
];

type ShopifyVariant = {
  id: string;
  title: string | null;
  displayName: string | null;
  sku: string | null;
  price: string | null;
  selectedOptions: Array<{ name: string; value: string }>;
  inventoryItem: { id: string } | null;
};

type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor: string;
  options: Array<{ id: string; name: string; values: string[] }>;
  variants: { nodes: ShopifyVariant[] };
};

async function loadProduct(id: string): Promise<ShopifyProduct | null> {
  const { data, errors } = await shopifyGraphQL<{ product: ShopifyProduct | null }>(
    `query($id: ID!) {
      product(id: $id) {
        id title handle status vendor
        options(first: 5) { id name values }
        variants(first: 100) {
          nodes {
            id title displayName sku price
            selectedOptions { name value }
            inventoryItem { id }
          }
        }
      }
    }`,
    { id }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return data?.product ?? null;
}

function findVariantForSize(product: ShopifyProduct, size: string): ShopifyVariant | null {
  const wanted = normalizeSizeLabel(size).toLowerCase();
  const nodes = product.variants.nodes;
  // Exact clothing size match only — never use sizeTitlesMatch includes()
  // (that treats XL as matching L because "xl".includes("l")).
  for (const v of nodes) {
    const opt = (
      v.selectedOptions.find((o) => /size|taille/i.test(o.name))?.value ??
      v.title ??
      ""
    )
      .trim()
      .toLowerCase();
    const optNorm = normalizeSizeLabel(opt).toLowerCase();
    if (optNorm === wanted) return v;
    if (
      wanted === "one size" &&
      (/one size|os|o\/s|default title|one-size/i.test(opt) || nodes.length === 1)
    ) {
      return v;
    }
  }
  return null;
}

async function setMetafields(
  ownerId: string,
  fields: Array<{ namespace: string; key: string; type: string; value: string }>
) {
  const metafields = fields.map((f) => ({ ownerId, ...f }));
  for (let i = 0; i < metafields.length; i += 25) {
    const chunk = metafields.slice(i, i + 25);
    const { data, errors } = await shopifyGraphQL<{
      metafieldsSet: { userErrors: Array<{ message: string }> };
    }>(
      `mutation($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) { userErrors { message } }
      }`,
      { metafields: chunk }
    );
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
    const ue = data?.metafieldsSet?.userErrors ?? [];
    if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
  }
}

async function updateVariantPriceAndCost(input: {
  productId: string;
  variantId: string;
  price: number;
  costChf: number;
  sku?: string | null;
}) {
  const variant: Record<string, unknown> = {
    id: input.variantId,
    price: input.price.toFixed(2),
    inventoryItem: {
      tracked: true,
      cost: input.costChf.toFixed(2),
    },
  };
  if (input.sku) {
    (variant.inventoryItem as Record<string, unknown>).sku = input.sku;
  }
  const { data, errors } = await shopifyGraphQL<{
    productVariantsBulkUpdate: {
      productVariants: Array<{ id: string; inventoryItem: { id: string } | null }>;
      userErrors: Array<{ message: string }>;
    };
  }>(
    `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id inventoryItem { id } }
        userErrors { message }
      }
    }`,
    { productId: input.productId, variants: [variant] }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
  return data?.productVariantsBulkUpdate?.productVariants?.[0] ?? null;
}

async function createMissingSizeVariant(input: {
  productId: string;
  optionId: string;
  size: string;
  price: number;
  costChf: number;
  sku: string;
}): Promise<{ id: string; inventoryItemId: string | null }> {
  const { data, errors } = await shopifyGraphQL<{
    productVariantsBulkCreate: {
      productVariants: Array<{ id: string; inventoryItem: { id: string } | null }>;
      userErrors: Array<{ message: string }>;
    };
  }>(
    `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants { id inventoryItem { id } }
        userErrors { message }
      }
    }`,
    {
      productId: input.productId,
      variants: [
        {
          price: input.price.toFixed(2),
          optionValues: [{ optionId: input.optionId, name: input.size }],
          inventoryItem: {
            sku: input.sku,
            tracked: true,
            cost: input.costChf.toFixed(2),
          },
        },
      ],
    }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.productVariantsBulkCreate?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
  const v = data?.productVariantsBulkCreate?.productVariants?.[0];
  if (!v) throw new Error("variant create returned empty");
  return { id: v.id, inventoryItemId: v.inventoryItem?.id ?? null };
}

async function createDraftProduct(offer: Offer): Promise<ShopifyProduct> {
  const vendor = offer.vendor ?? offer.brand;
  const sizes = offer.variants.map((v) => normalizeSizeLabel(v.size));
  const price = retailChf(offer.supplier_unit_cost, offer.brand, offer.title);
  const cost = costChfApprox(offer.supplier_unit_cost);

  const { data, errors } = await shopifyGraphQL<{
    productCreate: {
      product: { id: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    `mutation($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { id }
        userErrors { message }
      }
    }`,
    {
      product: {
        title: offer.title,
        vendor,
        status: "DRAFT",
        tags: ["jmoney-kicks"],
        productOptions: [
          {
            name: "Size",
            values: sizes.map((s) => ({ name: s })),
          },
        ],
      },
    }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.productCreate?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
  const productId = data?.productCreate?.product?.id;
  if (!productId) throw new Error("productCreate missing id");

  // Reload to get default variants / options
  let product = await loadProduct(productId);
  if (!product) throw new Error("created product not found");

  const optionId = product.options.find((o) => /size/i.test(o.name))?.id ?? product.options[0]?.id;
  if (!optionId) throw new Error("no size option on new product");

  // Shopify creates one default variant for first option value — update all sizes
  for (const vo of offer.variants) {
    const size = normalizeSizeLabel(vo.size);
    let variant = findVariantForSize(product, size);
    const sku = `MK-${offer.key}-${size}`.toUpperCase().slice(0, 64);
    if (!variant) {
      const created = await createMissingSizeVariant({
        productId,
        optionId,
        size,
        price,
        costChf: cost,
        sku,
      });
      // refresh
      product = (await loadProduct(productId))!;
      variant = product.variants.nodes.find((v) => v.id === created.id) ?? null;
    } else {
      await updateVariantPriceAndCost({
        productId,
        variantId: variant.id,
        price,
        costChf: cost,
        sku,
      });
      product = (await loadProduct(productId))!;
      variant = findVariantForSize(product, size);
    }
    const invId = variant?.inventoryItem?.id;
    if (invId) {
      await setInventoryQuantity({
        inventoryItemId: invId,
        locationId: LOCATION_ID,
        quantity: shopifyQty(vo.supplier_quantity),
      });
    }
  }

  const refreshed = await loadProduct(productId);
  if (!refreshed) throw new Error("product vanished");
  return refreshed;
}

type RowResult = {
  product: string;
  action: "UPDATE" | "CREATE" | "SKIP" | "BLOCK";
  shopifyProductId: string | null;
  handle: string | null;
  status: string | null;
  retailChf: number;
  supplierCostUsd: number;
  variants: Array<{
    size: string;
    supplierQty: number;
    shopifyQty: number;
    variantId: string | null;
    priceSet: boolean;
    stockSet: boolean;
    error?: string;
  }>;
  identity_confidence: number;
  auth_status: string;
  image_source_url: string | null;
  blocking_reasons: string[];
  notes: string[];
};

async function processOffer(offer: Offer): Promise<RowResult> {
  const price = retailChf(offer.supplier_unit_cost, offer.brand, offer.title);
  const cost = costChfApprox(offer.supplier_unit_cost);
  const base: RowResult = {
    product: offer.title,
    action: "SKIP",
    shopifyProductId: null,
    handle: null,
    status: null,
    retailChf: price,
    supplierCostUsd: offer.supplier_unit_cost,
    variants: [],
    identity_confidence: offer.identity_confidence,
    auth_status: "AUTH_PENDING",
    image_source_url: offer.image_source_url ?? offer.official_url ?? null,
    blocking_reasons: [],
    notes: offer.note ? [offer.note] : [],
  };

  if (!WRITE) {
    base.action = offer.matchProductId ? "UPDATE" : "CREATE";
    base.shopifyProductId = offer.matchProductId ?? null;
    base.handle = offer.matchHandle ?? null;
    for (const v of offer.variants) {
      base.variants.push({
        size: v.size,
        supplierQty: v.supplier_quantity,
        shopifyQty: shopifyQty(v.supplier_quantity),
        variantId: null,
        priceSet: false,
        stockSet: false,
      });
    }
    if (offer.needsExactImage) base.notes.push("NEEDS_EXACT_IMAGE (create without image)");
    return base;
  }

  try {
    let product: ShopifyProduct | null = null;
    let action: "UPDATE" | "CREATE" = "UPDATE";

    if (offer.matchProductId) {
      product = await loadProduct(offer.matchProductId);
      if (!product) {
        base.action = "BLOCK";
        base.blocking_reasons.push(`match product missing: ${offer.matchProductId}`);
        return base;
      }
      action = "UPDATE";
    } else {
      product = await createDraftProduct(offer);
      action = "CREATE";
    }

    base.action = action;
    base.shopifyProductId = product.id;
    base.handle = product.handle;
    base.status = product.status;

    const optionId =
      product.options.find((o) => /size/i.test(o.name))?.id ?? product.options[0]?.id ?? null;
    const styleBase =
      product.variants.nodes
        .map((v) => v.sku)
        .find((s) => s && s.includes("-"))
        ?.split("-")
        .slice(0, -1)
        .join("-") ?? `MK-${offer.key}`.toUpperCase();

    for (const vo of offer.variants) {
      const size = normalizeSizeLabel(vo.size);
      const qty = shopifyQty(vo.supplier_quantity);
      const row: RowResult["variants"][number] = {
        size: vo.size,
        supplierQty: vo.supplier_quantity,
        shopifyQty: qty,
        variantId: null,
        priceSet: false,
        stockSet: false,
      };
      try {
        let variant = findVariantForSize(product, size);
        if (!variant && optionId && action === "UPDATE") {
          // Only add sizes that supplier listed; never invent L/XL when omitted
          const created = await createMissingSizeVariant({
            productId: product.id,
            optionId,
            size,
            price,
            costChf: cost,
            sku: `${styleBase}-${size}`,
          });
          product = (await loadProduct(product.id))!;
          variant = product.variants.nodes.find((v) => v.id === created.id) ?? null;
          base.notes.push(`created missing size ${size}`);
        }
        if (!variant) {
          row.error = "variant not found / not created";
          base.variants.push(row);
          continue;
        }
        row.variantId = variant.id;
        await updateVariantPriceAndCost({
          productId: product.id,
          variantId: variant.id,
          price,
          costChf: cost,
        });
        row.priceSet = true;
        const invId = variant.inventoryItem?.id;
        if (!invId) {
          // reload
          product = (await loadProduct(product.id))!;
          variant = findVariantForSize(product, size);
        }
        const inventoryItemId = variant?.inventoryItem?.id;
        if (!inventoryItemId) throw new Error("missing inventoryItemId");
        await setInventoryQuantity({
          inventoryItemId,
          locationId: LOCATION_ID,
          quantity: qty,
        });
        row.stockSet = true;
      } catch (e) {
        row.error = e instanceof Error ? e.message : String(e);
      }
      base.variants.push(row);
    }

    // metafields on product
    const authStatus = "AUTH_PENDING";
    const identityStatus = offer.needsExactImage ? "NEEDS_EXACT_IMAGE" : "MATCHED_EXISTING";
    await setMetafields(product.id, [
      { namespace: "supplier", key: "name", type: "single_line_text_field", value: "Money Kickz" },
      {
        namespace: "supplier",
        key: "product_key",
        type: "single_line_text_field",
        value: offer.key || productKey(offer.title),
      },
      {
        namespace: "supplier",
        key: "source_message_id",
        type: "single_line_text_field",
        value: SOURCE_MESSAGE_ID,
      },
      {
        namespace: "supplier",
        key: "raw_quantity",
        type: "json",
        value: JSON.stringify(
          Object.fromEntries(offer.variants.map((v) => [v.size, v.supplier_quantity]))
        ),
      },
      {
        namespace: "supplier",
        key: "last_seen_at",
        type: "single_line_text_field",
        value: `${SNAPSHOT_DATE}T12:00:00+02:00`,
      },
      {
        namespace: "product_data",
        key: "identity_confidence",
        type: "number_decimal",
        value: String(offer.identity_confidence),
      },
      {
        namespace: "product_data",
        key: "auth_status",
        type: "single_line_text_field",
        value: authStatus,
      },
      {
        namespace: "product_data",
        key: "identity_status",
        type: "single_line_text_field",
        value: identityStatus,
      },
      ...(base.image_source_url
        ? [
            {
              namespace: "product_data",
              key: "image_source_url",
              type: "single_line_text_field",
              value: base.image_source_url,
            },
          ]
        : []),
    ]);

    // Do not change ACTIVE→DRAFT for existing; new products already DRAFT
    if (action === "CREATE") {
      base.notes.push("created as DRAFT");
      if (offer.needsExactImage) base.notes.push("NEEDS_EXACT_IMAGE — no image uploaded");
    } else {
      base.notes.push(`existing status kept: ${product.status}`);
    }
  } catch (e) {
    base.action = "BLOCK";
    base.blocking_reasons.push(e instanceof Error ? e.message : String(e));
  }

  return base;
}

async function main() {
  if (!LOCATION_ID) {
    console.error("BLOCKER: SHOPIFY_LOC_MONEY_KICKZ missing — refuse default location");
    process.exit(2);
  }
  console.log(`mode=${WRITE ? "WRITE" : "DRY-RUN"} location=${LOCATION_ID}`);
  console.log(`buffer=${BUFFER} max_per_variant=${MAX_PER} offers=${OFFERS.length}`);

  const results: RowResult[] = [];
  for (const offer of OFFERS) {
    console.log(`\n→ ${offer.title}`);
    const row = await processOffer(offer);
    results.push(row);
    console.log(
      `  ${row.action} id=${row.shopifyProductId ?? "-"} handle=${row.handle ?? "-"} retail=${row.retailChf} CHF`
    );
    for (const v of row.variants) {
      console.log(
        `    ${v.size}: raw=${v.supplierQty} shop=${v.shopifyQty} price=${v.priceSet} stock=${v.stockSet}${v.error ? " ERR=" + v.error : ""}`
      );
    }
    if (row.blocking_reasons.length) console.log("  BLOCK:", row.blocking_reasons.join("; "));
  }

  const outDir = path.join(process.cwd(), "tmp", "money-kickz");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `bootstrap-${WRITE ? "write" : "dryrun"}-${SNAPSHOT_DATE}.json`
  );
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        write: WRITE,
        locationId: LOCATION_ID,
        buffer: BUFFER,
        maxPerVariant: MAX_PER,
        results,
        summary: {
          total: results.length,
          update: results.filter((r) => r.action === "UPDATE").length,
          create: results.filter((r) => r.action === "CREATE").length,
          skip: results.filter((r) => r.action === "SKIP").length,
          block: results.filter((r) => r.action === "BLOCK").length,
        },
      },
      null,
      2
    )
  );
  console.log(`\nWrote ${outPath}`);
  console.log(
    JSON.stringify(
      {
        total: results.length,
        update: results.filter((r) => r.action === "UPDATE").length,
        create: results.filter((r) => r.action === "CREATE").length,
        block: results.filter((r) => r.action === "BLOCK").length,
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
