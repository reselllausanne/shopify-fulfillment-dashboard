/**
 * Update Crocs Lightning McQueen + YZY slides:
 * - retail CHF, price lock, MK location stock
 * - tag jmoney-kicks
 * Usage: npx tsx scripts/money-kickz-update-footwear-batch.ts --write
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { setInventoryQuantity } from "@/shopify/catalog/graphql";

const WRITE = process.argv.includes("--write");
const LOCATION_ID = (process.env.SHOPIFY_LOC_MONEY_KICKZ ?? "").trim();
const BUFFER = Number(process.env.SUPPLIER_STOCK_BUFFER ?? "2");
const MAX_PER = Number(process.env.SUPPLIER_STOCK_MAX_PER_VARIANT ?? "5");

type Offer = {
  key: string;
  search: string[];
  preferHandle?: string;
  titleHint: string;
  brand: string;
  retailChf: string;
  costUsd: number;
  productType: string;
  /** Shopify size option values (EU on this store) */
  sizes: Array<{ size: string; supplierQty: number }>;
};

/** Supplier US men's → store Crocs EU range labels */
const CROCS_US_TO_EU: Record<string, string> = {
  "7": "39-40",
  "8": "41-42",
  "9": "42-43",
  "10": "43-44",
  "11": "45-46",
};

/** Supplier US → Adidas thirds EU used on YZY YS-01 products */
const YZY_US_TO_EU: Record<string, string> = {
  "4": "36",
  "5": "37 1/3",
  "6": "38 2/3",
  "7": "40",
  "8": "41 1/3",
  "9": "42 2/3",
  "10": "44",
  "11": "45 1/3",
  "12": "46 2/3",
  "13": "48",
  "14": "49 1/3",
};

function mapSizes(
  usSizes: Array<{ size: string; supplierQty: number }>,
  map: Record<string, string>
): Array<{ size: string; supplierQty: number }> {
  return usSizes.map((s) => {
    const eu = map[s.size];
    if (!eu) throw new Error(`No EU map for US ${s.size}`);
    return { size: eu, supplierQty: s.supplierQty };
  });
}

const OFFERS: Offer[] = [
  {
    key: "crocs-lightning-mcqueen",
    search: ["handle:crocs-classic-clog-lightning-mcqueen", "title:Lightning McQueen AND title:Crocs"],
    preferHandle: "crocs-classic-clog-lightning-mcqueen",
    titleHint: "Crocs Classic Clog Lightning McQueen",
    brand: "Crocs",
    retailChf: "99.00",
    costUsd: 60,
    productType: "Sneakers",
    sizes: mapSizes(
      [
        { size: "7", supplierQty: 10 },
        { size: "8", supplierQty: 10 },
        { size: "9", supplierQty: 10 },
        { size: "10", supplierQty: 10 },
        { size: "11", supplierQty: 10 },
      ],
      CROCS_US_TO_EU
    ),
  },
  {
    key: "yzy-ys-01-black",
    search: ["handle:yzy-ys-01-black", "title:YZY YS-01 Black"],
    preferHandle: "yzy-ys-01-black",
    titleHint: "YZY YS-01 Black",
    brand: "Yeezy",
    retailChf: "79.00",
    costUsd: 30,
    productType: "Sneakers",
    sizes: mapSizes(
      [
        { size: "4", supplierQty: 10 },
        { size: "5", supplierQty: 10 },
        { size: "6", supplierQty: 10 },
        { size: "7", supplierQty: 10 },
        { size: "8", supplierQty: 10 },
        { size: "9", supplierQty: 10 },
        { size: "10", supplierQty: 10 },
        { size: "11", supplierQty: 10 },
        { size: "12", supplierQty: 10 },
        { size: "13", supplierQty: 10 },
        { size: "14", supplierQty: 10 },
      ],
      YZY_US_TO_EU
    ),
  },
  {
    key: "yzy-ys-01-fudge",
    search: ["handle:yzy-ys-01-fudge", "title:YZY YS-01 Fudge"],
    preferHandle: "yzy-ys-01-fudge",
    titleHint: "YZY YS-01 Fudge",
    brand: "Yeezy",
    retailChf: "79.00",
    costUsd: 30,
    productType: "Sneakers",
    sizes: mapSizes(
      [
        { size: "5", supplierQty: 10 },
        { size: "6", supplierQty: 10 },
        { size: "7", supplierQty: 10 },
        { size: "8", supplierQty: 10 },
        { size: "9", supplierQty: 10 },
        { size: "10", supplierQty: 10 },
        { size: "11", supplierQty: 10 },
        { size: "12", supplierQty: 10 },
        { size: "13", supplierQty: 10 },
      ],
      YZY_US_TO_EU
    ),
  },
  {
    key: "yzy-ys-01-cream",
    search: [
      "handle:yzy-ys-01-cream",
      "title:YZY YS-01 Cream",
      "title:YS-01 AND title:Cream",
      "title:YZY AND title:Cream",
    ],
    preferHandle: "yzy-ys-01-cream",
    titleHint: "YZY YS-01 Cream",
    brand: "Yeezy",
    retailChf: "79.00",
    costUsd: 30,
    productType: "Sneakers",
    sizes: mapSizes(
      [
        { size: "5", supplierQty: 10 },
        { size: "6", supplierQty: 10 },
        { size: "7", supplierQty: 10 },
        { size: "8", supplierQty: 10 },
        { size: "9", supplierQty: 10 },
        { size: "10", supplierQty: 10 },
        { size: "11", supplierQty: 10 },
        { size: "12", supplierQty: 10 },
        { size: "13", supplierQty: 10 },
      ],
      YZY_US_TO_EU
    ),
  },
];

function shopifyQty(supplierQty: number): number {
  return Math.min(Math.max(supplierQty - BUFFER, 0), MAX_PER);
}

function normSize(s: string): string {
  return s.trim().toLowerCase().replace(/,/g, ".").replace(/\s+/g, "");
}

function sizeMatch(a: string, b: string): boolean {
  const na = normSize(a);
  const nb = normSize(b);
  if (na === nb) return true;
  // US size forms: "US 7", "7", "M7", "7.0"
  const strip = (x: string) => x.replace(/^(us|eu|uk|m|w)/, "").replace(/\.0$/, "");
  return strip(na) === strip(nb);
}

type ProductHit = {
  id: string;
  handle: string;
  title: string;
  tags: string[];
  productType: string;
  variants: Array<{
    id: string;
    title: string;
    price: string;
    compareAtPrice: string | null;
    selectedOptions: Array<{ name: string; value: string }>;
    inventoryItem: { id: string };
  }>;
};

async function searchProduct(queries: string[]): Promise<ProductHit[]> {
  const found = new Map<string, ProductHit>();
  for (const q of queries) {
    const { data, errors } = await shopifyGraphQL<{
      products: {
        nodes: Array<{
          id: string;
          handle: string;
          title: string;
          tags: string[];
          productType: string;
          variants: { nodes: ProductHit["variants"] };
        }>;
      };
    }>(
      `query($q: String!) {
        products(first: 15, query: $q) {
          nodes {
            id handle title tags productType status
            variants(first: 100) {
              nodes {
                id title price compareAtPrice
                selectedOptions { name value }
                inventoryItem { id }
              }
            }
          }
        }
      }`,
      { q }
    );
    if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
    for (const p of data?.products?.nodes ?? []) {
      found.set(p.id, {
        id: p.id,
        handle: p.handle,
        title: p.title,
        tags: p.tags,
        productType: p.productType,
        variants: p.variants?.nodes ?? [],
      });
    }
  }
  return [...found.values()];
}

async function setInventory(inventoryItemId: string, qty: number) {
  await setInventoryQuantity({
    inventoryItemId,
    locationId: LOCATION_ID,
    quantity: qty,
  });
}

async function lockPriceAndClearExpress(variantId: string) {
  const { data, errors } = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(
    `mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { message } }
    }`,
    {
      metafields: [
        {
          ownerId: variantId,
          namespace: "custom",
          key: "price_locked",
          type: "boolean",
          value: "true",
        },
      ],
    }
  );
  const ue = data?.metafieldsSet?.userErrors ?? [];
  if (errors?.length || ue.length) {
    throw new Error(
      (errors ?? []).map((e) => e.message).join("; ") || ue.map((e) => e.message).join("; ")
    );
  }

  // Clear express price if present
  await shopifyGraphQL(
    `mutation($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        deletedMetafields { key }
        userErrors { message }
      }
    }`,
    {
      metafields: [
        { ownerId: variantId, namespace: "custom", key: "express_price" },
      ],
    }
  );
}

async function updateVariantPrice(variantId: string, price: string, productId: string) {
  // Prefer productVariantsBulkUpdate
  const { data, errors } = await shopifyGraphQL<{
    productVariantsBulkUpdate: {
      productVariants: Array<{ id: string; price: string }> | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price }
        userErrors { field message }
      }
    }`,
    {
      productId,
      variants: [
        {
          id: variantId,
          price,
          compareAtPrice: null,
        },
      ],
    }
  );
  const ue = data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (errors?.length || ue.length) {
    throw new Error(
      (errors ?? []).map((e) => e.message).join("; ") || ue.map((e) => e.message).join("; ")
    );
  }
}

async function updateProductMeta(
  productId: string,
  tags: string[],
  productType: string
) {
  const { data, errors } = await shopifyGraphQL<{
    productUpdate: { userErrors: Array<{ message: string }> };
  }>(
    `mutation($input: ProductInput!) {
      productUpdate(input: $input) { userErrors { message } }
    }`,
    {
      input: {
        id: productId,
        tags,
        productType,
      },
    }
  );
  const ue = data?.productUpdate?.userErrors ?? [];
  if (errors?.length || ue.length) {
    throw new Error(
      (errors ?? []).map((e) => e.message).join("; ") || ue.map((e) => e.message).join("; ")
    );
  }
}

function pickBest(offer: Offer, candidates: ProductHit[]) {
  if (!candidates.length) return null;
  if (offer.preferHandle) {
    const exact = candidates.find((p) => p.handle === offer.preferHandle);
    if (exact) return exact;
  }

  // Hard colorway filters — never update the wrong YS-01 color
  const filtered = candidates.filter((p) => {
    const t = `${p.title} ${p.handle}`.toLowerCase();
    if (offer.key === "yzy-ys-01-cream") return /\bcream\b/.test(t) && /ys-01|yzy/.test(t);
    if (offer.key === "yzy-ys-01-fudge") return /\bfudge\b/.test(t);
    if (offer.key === "yzy-ys-01-black") return /\bblack\b/.test(t) && /ys-01|yzy/.test(t);
    if (offer.key === "crocs-lightning-mcqueen") return /crocs/.test(t) && /mcqueen|lightning/.test(t);
    return true;
  });
  if (!filtered.length) return null;

  const scored = filtered.map((p) => {
    const t = p.title.toLowerCase();
    let score = 1;
    if (/ys-01|ys01/.test(t)) score += 5;
    if (/450/.test(t)) score -= 20;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.score > 0 ? scored[0]!.p : null;
}

async function createYzyCream(offer: Offer): Promise<ProductHit> {
  const sizes = offer.sizes.map((s) => s.size);
  const { data, errors } = await shopifyGraphQL<{
    productCreate: {
      product: { id: string; handle: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    `mutation($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { id handle }
        userErrors { message }
      }
    }`,
    {
      product: {
        title: "YZY YS-01 Cream",
        vendor: "Yeezy",
        productType: offer.productType,
        status: "ACTIVE",
        tags: ["jmoney-kicks", "New"],
        descriptionHtml: [
          `<p>Découvrez YZY YS-01 Cream. Disponible chez Resell Lausanne — chaque article est authentifié et vérifié manuellement avant expédition. Livraison en Suisse et en Europe.</p>`,
          `<p><strong>Coloris :</strong> Cream<br><strong>Marque :</strong> Yeezy<br><strong>Catégorie :</strong> Sneakers</p>`,
          `<p>Produit 100% authentique. Resell Lausanne sélectionne uniquement des articles en parfait état.</p>`,
        ].join("\n"),
        productOptions: [{ name: "Taille", values: sizes.map((s) => ({ name: s })) }],
      },
    }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.productCreate?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
  const productId = data?.productCreate?.product?.id;
  if (!productId) throw new Error("cream create failed");

  // Load variants created by Shopify
  const loaded = await shopifyGraphQL<{
    product: {
      id: string;
      handle: string;
      title: string;
      tags: string[];
      productType: string;
      options: Array<{ id: string; name: string }>;
      variants: { nodes: ProductHit["variants"] };
    } | null;
  }>(
    `query($id: ID!) {
      product(id: $id) {
        id handle title tags productType
        options { id name }
        variants(first: 100) {
          nodes {
            id title price compareAtPrice
            selectedOptions { name value }
            inventoryItem { id }
          }
        }
      }
    }`,
    { id: productId }
  );
  const product = loaded.data?.product;
  if (!product) throw new Error("cream product missing after create");

  const optionId = product.options.find((o) => /taille|size/i.test(o.name))?.id;
  // Update/create each size variant with price
  for (const sz of offer.sizes) {
    let variant = product.variants.nodes.find((v) =>
      sizeMatch(
        v.selectedOptions.find((o) => /taille|size/i.test(o.name))?.value ?? v.title,
        sz.size
      )
    );
    if (!variant && optionId) {
      const created = await shopifyGraphQL<{
        productVariantsBulkCreate: {
          productVariants: Array<{
            id: string;
            inventoryItem: { id: string } | null;
          }> | null;
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
          productId,
          variants: [
            {
              price: offer.retailChf,
              optionValues: [{ optionId, name: sz.size }],
              inventoryItem: { tracked: true, sku: `MK-YZY-CREAM-${sz.size}`.slice(0, 64) },
            },
          ],
        }
      );
      const cue = created.data?.productVariantsBulkCreate?.userErrors ?? [];
      if (created.errors?.length || cue.length) {
        throw new Error(
          (created.errors ?? []).map((e) => e.message).join("; ") ||
            cue.map((e) => e.message).join("; ")
        );
      }
    } else if (variant) {
      await updateVariantPrice(variant.id, offer.retailChf, productId);
    }
  }

  // Upload image if present
  const imgPath = path.join(process.cwd(), "tmp/money-kickz/yzy-ys-01-cream.png");
  try {
    const { readFileSync } = await import("node:fs");
    const buf = readFileSync(imgPath);
    const filename = "yzy-ys-01-cream.png";
    const staged = await shopifyGraphQL<{
      stagedUploadsCreate: {
        stagedTargets: Array<{
          url: string;
          resourceUrl: string;
          parameters: Array<{ name: string; value: string }>;
        }>;
        userErrors: Array<{ message: string }>;
      };
    }>(
      `mutation($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets { url resourceUrl parameters { name value } }
          userErrors { message }
        }
      }`,
      {
        input: [
          {
            resource: "IMAGE",
            filename,
            mimeType: "image/png",
            httpMethod: "POST",
            fileSize: String(buf.length),
          },
        ],
      }
    );
    const target = staged.data!.stagedUploadsCreate.stagedTargets[0]!;
    const form = new FormData();
    for (const p of target.parameters) form.append(p.name, p.value);
    form.append("file", new Blob([buf], { type: "image/png" }), filename);
    const up = await fetch(target.url, { method: "POST", body: form });
    if (up.ok) {
      await shopifyGraphQL(
        `mutation($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media { id }
            mediaUserErrors { message }
          }
        }`,
        {
          productId,
          media: [
            {
              originalSource: target.resourceUrl,
              mediaContentType: "IMAGE",
              alt: "YZY YS-01 Cream",
            },
          ],
        }
      );
    }
  } catch (e) {
    console.error("cream image upload skipped", e);
  }

  // Publish to Online Store
  const pubs = await shopifyGraphQL<{
    publications: { nodes: Array<{ id: string; name: string }> };
  }>(`query { publications(first: 20) { nodes { id name } } }`);
  for (const pub of pubs.data?.publications?.nodes ?? []) {
    if (!/online store|facebook|instagram|tiktok|shop|pos/i.test(pub.name)) continue;
    await shopifyGraphQL(
      `mutation($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { message }
        }
      }`,
      { id: productId, input: [{ publicationId: pub.id }] }
    );
  }

  const refreshed = await shopifyGraphQL<{ product: ProductHit & { variants: { nodes: ProductHit["variants"] } } | null }>(
    `query($id: ID!) {
      product(id: $id) {
        id handle title tags productType
        variants(first: 100) {
          nodes {
            id title price compareAtPrice
            selectedOptions { name value }
            inventoryItem { id }
          }
        }
      }
    }`,
    { id: productId }
  );
  const p = refreshed.data?.product;
  if (!p) throw new Error("cream refresh failed");
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    tags: p.tags,
    productType: p.productType,
    variants: (p as any).variants?.nodes ?? p.variants,
  };
}

async function main() {
  if (!LOCATION_ID) {
    console.error("BLOCKER: SHOPIFY_LOC_MONEY_KICKZ missing");
    process.exit(1);
  }

  const report: Array<Record<string, unknown>> = [];

  for (const offer of OFFERS) {
    const candidates = await searchProduct(offer.search);
    let product = pickBest(offer, candidates);
    if (!product && offer.key === "yzy-ys-01-cream") {
      if (!WRITE) {
        report.push({ key: offer.key, status: "WOULD_CREATE", titleHint: offer.titleHint });
        console.log(`WOULD_CREATE ${offer.key}`);
        continue;
      }
      console.log(`CREATE ${offer.key}`);
      product = await createYzyCream(offer);
    }
    if (!product) {
      report.push({
        key: offer.key,
        status: "NOT_FOUND",
        searched: offer.search,
        candidates: candidates.map((c) => ({ handle: c.handle, title: c.title })),
      });
      console.log(`NOT_FOUND ${offer.key}`);
      continue;
    }

    const tags = (product.tags || []).filter(
      (t) =>
        !["auth-pending", "money-kickz", "supplier-money-kickz"].includes(t.toLowerCase())
    );
    if (!tags.some((t) => t.toLowerCase() === "jmoney-kicks")) tags.push("jmoney-kicks");

    const variantActions: Array<Record<string, unknown>> = [];
    const unmatchedSizes: string[] = [];

    for (const sz of offer.sizes) {
      const variant = product.variants.find((v) => {
        const opt =
          v.selectedOptions.find((o) => /size|taille|eu|us/i.test(o.name))?.value ??
          v.title;
        return sizeMatch(opt, sz.size);
      });
      if (!variant) {
        unmatchedSizes.push(sz.size);
        continue;
      }
      const qty = shopifyQty(sz.supplierQty);
      const action: Record<string, unknown> = {
        size: sz.size,
        variantId: variant.id,
        priceBefore: variant.price,
        priceAfter: offer.retailChf,
        compareAtCleared: true,
        mkQty: qty,
        supplierQty: sz.supplierQty,
      };
      if (WRITE) {
        await updateVariantPrice(variant.id, offer.retailChf, product.id);
        await lockPriceAndClearExpress(variant.id);
        await setInventory(variant.inventoryItem.id, qty);
      }
      variantActions.push(action);
    }

    if (WRITE) {
      await updateProductMeta(product.id, tags, offer.productType);
      // supplier metafields
      await shopifyGraphQL(
        `mutation($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) { userErrors { message } }
        }`,
        {
          metafields: [
            {
              ownerId: product.id,
              namespace: "supplier",
              key: "name",
              type: "single_line_text_field",
              value: "Money Kickz",
            },
            {
              ownerId: product.id,
              namespace: "supplier",
              key: "product_key",
              type: "single_line_text_field",
              value: offer.key,
            },
            {
              ownerId: product.id,
              namespace: "supplier",
              key: "last_seen_at",
              type: "single_line_text_field",
              value: new Date().toISOString(),
            },
          ],
        }
      );
    }

    report.push({
      key: offer.key,
      status: WRITE ? "UPDATED" : "WOULD_UPDATE",
      handle: product.handle,
      title: product.title,
      productId: product.id,
      retailChf: offer.retailChf,
      productType: offer.productType,
      tags,
      variants: variantActions,
      unmatchedSizes,
    });
    console.log(
      `${WRITE ? "OK" : "WOULD"} ${offer.key} -> ${product.handle} variants=${variantActions.length} missing=${unmatchedSizes.join(",") || "-"}`
    );
  }

  const outDir = path.join(process.cwd(), "tmp/money-kickz");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "footwear-batch.json");
  writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), write: WRITE, report }, null, 2));
  console.log(JSON.stringify({ write: WRITE, outPath, count: report.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
