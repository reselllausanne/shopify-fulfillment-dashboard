/**
 * Money Kickz proper enrichment:
 * - exact size price/stock repair (no XL⊃L)
 * - custom.price_locked=true on every variant
 * - images (download validate + Shopify productCreateMedia) for stubs
 * - descriptionHtml for stubs
 * - ACTIVE when images+desc present (user wants on website)
 *
 * Usage: npx tsx scripts/money-kickz-enrich.ts --write
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { setInventoryQuantity } from "@/shopify/catalog/graphql";

const WRITE = process.argv.includes("--write");
const LOCATION_ID = (process.env.SHOPIFY_LOC_MONEY_KICKZ ?? "").trim();
const BUFFER = Number(process.env.SUPPLIER_STOCK_BUFFER ?? "2");
const MAX_PER = Number(process.env.SUPPLIER_STOCK_MAX_PER_VARIANT ?? "5");
const USD_CHF = Number(process.env.USD_CHF_RATE ?? "0.88");

function shopifyQty(raw: number): number {
  return Math.min(Math.max(raw - BUFFER, 0), MAX_PER);
}
function costChf(usd: number): number {
  return Math.round(usd * USD_CHF * 100) / 100;
}
function normalizeSize(size: string): string {
  const s = size.trim().toLowerCase();
  if (/^6-12/.test(s) || s === "one size" || s === "os" || s === "o/s") return "one size";
  return s.replace(/\s+/g, " ");
}
function exactSizeMatch(a: string, b: string): boolean {
  return normalizeSize(a) === normalizeSize(b);
}

type Offer = {
  key: string;
  title: string;
  brand: string;
  vendor: string;
  costUsd: number;
  retailChf: number;
  productId: string;
  variants: Array<{ size: string; qty: number }>;
  /** Candidate image page URLs (official / reputable) to scrape CDN assets from */
  imagePages?: string[];
  /** Direct image CDN candidates (if known) */
  imageUrls?: string[];
  needsExactImage?: boolean;
  colorway?: string;
  category?: string;
};

function retail(costUsd: number, brand: string, title: string): number {
  const b = brand.toLowerCase();
  const t = title.toLowerCase();
  if (b.includes("bape") && /tee|t-shirt/.test(t) && costUsd === 40) return 89;
  if (costUsd === 50) return 99;
  return Math.round(costUsd * 2 * 100) / 100;
}

const REPORT = JSON.parse(
  readFileSync("tmp/money-kickz/bootstrap-write-2026-08-08.json", "utf8")
) as {
  results: Array<{
    product: string;
    shopifyProductId: string | null;
    handle: string | null;
    supplierCostUsd: number;
    retailChf: number;
    action: string;
    variants: Array<{ size: string; supplierQty: number }>;
  }>;
};

function buildOffers(): Offer[] {
  const meta: Record<
    string,
    Partial<Offer> & { brand: string; vendor: string; costUsd: number }
  > = {
    "supreme-digital-camera-keychain-white": {
      brand: "Supreme",
      vendor: "Supreme",
      costUsd: 100,
      colorway: "White",
      category: "Accessories",
    },
    "supreme-hanes-boxer-briefs-black": {
      brand: "Supreme",
      vendor: "Supreme",
      costUsd: 22.5,
      colorway: "Black",
      category: "Underwear",
    },
    "supreme-hanes-boxer-briefs-white": {
      brand: "Supreme",
      vendor: "Supreme",
      costUsd: 22.5,
      colorway: "White",
      category: "Underwear",
    },
    "alo-unisex-half-crew-throwback-sock-black-white": {
      brand: "ALO",
      vendor: "Alo Yoga",
      costUsd: 8.5,
      colorway: "Black/White",
      category: "Socks",
      imagePages: [
        "https://www.aloyoga.com/products/a0480u-unisex-half-crew-throwback-sock-black-white",
      ],
      needsExactImage: true,
    },
    "alo-unisex-half-crew-throwback-sock-white-black": {
      brand: "ALO",
      vendor: "Alo Yoga",
      costUsd: 8.5,
      colorway: "White/Black",
      category: "Socks",
      imagePages: [
        "https://www.aloyoga.com/products/a0480u-unisex-half-crew-throwback-sock-white-black",
      ],
      needsExactImage: true,
    },
    "supreme-hanes-crew-socks-4-pack-heather-grey": {
      brand: "Supreme",
      vendor: "Supreme",
      costUsd: 20,
      colorway: "Heather Grey",
      category: "Socks",
    },
    "supreme-hanes-socks-4-pack-black": {
      brand: "Supreme",
      vendor: "Supreme",
      costUsd: 20,
      colorway: "Black",
      category: "Socks",
    },
    "supreme-hanes-crew-socks-4-pack-white": {
      brand: "Supreme",
      vendor: "Supreme",
      costUsd: 20,
      colorway: "White",
      category: "Socks",
    },
    "godspeed-gs-forever-trucker-hat-og": {
      brand: "Godspeed",
      vendor: "Godspeed",
      costUsd: 80,
      colorway: "OG Black",
      category: "Hats",
      imagePages: [
        "https://takoutny.com/products/gs-forever-trucker-hat-og-black",
        "https://www.stadiumgoods.com/products/gs-forever-trucker-hat-black-157893",
      ],
      needsExactImage: true,
    },
    "alo-yoga-accolade-cotton-blend-fleece-sweatshirt-athletic-heather-grey": {
      brand: "ALO",
      vendor: "Alo Yoga",
      costUsd: 50,
      colorway: "Athletic Heather Grey",
      category: "Hoodies",
    },
    "alo-yoga-accolade-cotton-blend-hoodie-black": {
      brand: "ALO",
      vendor: "Alo Yoga",
      costUsd: 50,
      colorway: "Black",
      category: "Hoodies",
    },
    "alo-accolade-1-4-zip-pullover-black": {
      brand: "ALO",
      vendor: "Alo Yoga",
      costUsd: 50,
      colorway: "Black",
      category: "Sweatshirts",
      imagePages: [
        "https://www.aloyoga.com/products/u3040rg-accolade-1-4-zip-pullover-black",
      ],
      needsExactImage: true,
    },
    "bape-color-camo-big-ape-head-t-shirt-ss20-white-red": {
      brand: "BAPE",
      vendor: "BAPE",
      costUsd: 40,
    },
    "bape-college-tee-white": { brand: "BAPE", vendor: "BAPE", costUsd: 40 },
    "bape-color-camo-big-ape-head-tee-ss23-white-purple": {
      brand: "BAPE",
      vendor: "BAPE",
      costUsd: 40,
    },
    "bape-color-camo-by-bathing-ape-tee-ss22-white-navy": {
      brand: "BAPE",
      vendor: "BAPE",
      costUsd: 40,
    },
    "bape-a-bathing-ape-check-by-bathing-tee-white-beige": {
      brand: "BAPE",
      vendor: "BAPE",
      costUsd: 40,
    },
    "bape-sakura-tree-tee-black": { brand: "BAPE", vendor: "BAPE", costUsd: 40 },
    "bape-color-camo-big-ape-head-tee-black-navy": {
      brand: "BAPE",
      vendor: "BAPE",
      costUsd: 40,
      colorway: "Black/Navy",
      category: "T-Shirts",
      imagePages: [
        "https://eu.bape.com/products/0zxtem017101p",
        "https://www.baitme.com/a-bathing-ape-men-color-camo-big-ape-head-tee-black-navy-ap1i80110015bk3-s",
        "https://theluxny.com/products/bape-color-camo-big-ape-head-tee-black-navy",
      ],
      needsExactImage: true,
    },
    "bape-color-camo-big-ape-head-t-shirt-ss20-black-red": {
      brand: "BAPE",
      vendor: "BAPE",
      costUsd: 40,
    },
    "bape-college-tee-black": { brand: "BAPE", vendor: "BAPE", costUsd: 40 },
    "bape-color-camo-big-ape-head-tee-ss23-black-purple": {
      brand: "BAPE",
      vendor: "BAPE",
      costUsd: 40,
    },
    "bape-abc-camo-by-bathing-ape-tee-black-pink": {
      brand: "BAPE",
      vendor: "BAPE",
      costUsd: 40,
    },
    "stussy-x-our-legacy-work-shop-8-ball-yin-yang-pigment-dyed-tee-black": {
      brand: "Stussy",
      vendor: "Stussy",
      costUsd: 30,
    },
    "stussy-fuzzy-dice-tee-white": { brand: "Stussy", vendor: "Stussy", costUsd: 30 },
    "stussy-basic-t-shirt-white": { brand: "Stussy", vendor: "Stussy", costUsd: 30 },
    "stussy-basic-t-shirt-black": { brand: "Stussy", vendor: "Stussy", costUsd: 32.5 },
    "stussy-fuzzy-dice-tee-black": { brand: "Stussy", vendor: "Stussy", costUsd: 30 },
    "fear-of-god-essentials-nba-tee-light-heather": {
      brand: "Fear of God Essentials",
      vendor: "Fear of God",
      costUsd: 25,
    },
    "fear-of-god-essentials-nba-tee-black": {
      brand: "Fear of God Essentials",
      vendor: "Fear of God",
      costUsd: 25,
    },
  };

  const out: Offer[] = [];
  for (const r of REPORT.results) {
    if (!r.shopifyProductId || !r.handle) continue;
    const m = meta[r.handle];
    if (!m) {
      console.warn("No meta for handle", r.handle);
      continue;
    }
    out.push({
      key: r.handle,
      title: r.product,
      brand: m.brand,
      vendor: m.vendor,
      costUsd: m.costUsd,
      retailChf: retail(m.costUsd, m.brand, r.product),
      productId: r.shopifyProductId,
      variants: r.variants.map((v) => ({ size: v.size, qty: v.supplierQty })),
      imagePages: m.imagePages,
      imageUrls: m.imageUrls,
      needsExactImage: m.needsExactImage,
      colorway: m.colorway,
      category: m.category,
    });
  }
  return out;
}

async function loadProduct(id: string) {
  const { data, errors } = await shopifyGraphQL<{
    product: {
      id: string;
      title: string;
      handle: string;
      status: string;
      descriptionHtml: string | null;
      media: { nodes: Array<{ id?: string; image?: { url: string; width: number; height: number } | null }> };
      variants: {
        nodes: Array<{
          id: string;
          title: string | null;
          sku: string | null;
          price: string | null;
          selectedOptions: Array<{ name: string; value: string }>;
          inventoryItem: { id: string } | null;
          priceLocked: { value: string | null } | null;
        }>;
      };
    } | null;
  }>(
    `query($id: ID!) {
      product(id: $id) {
        id title handle status descriptionHtml
        media(first: 20) {
          nodes { ... on MediaImage { id image { url width height } } }
        }
        variants(first: 100) {
          nodes {
            id title sku price
            selectedOptions { name value }
            inventoryItem { id }
            priceLocked: metafield(namespace: "custom", key: "price_locked") { value }
          }
        }
      }
    }`,
    { id }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  return data?.product ?? null;
}

function findExactVariant(
  nodes: Array<{
    id: string;
    title: string | null;
    selectedOptions: Array<{ name: string; value: string }>;
    inventoryItem: { id: string } | null;
    price: string | null;
  }>,
  size: string
) {
  const wanted = normalizeSize(size);
  for (const v of nodes) {
    const opt =
      v.selectedOptions.find((o) => /size|taille/i.test(o.name))?.value ?? v.title ?? "";
    if (exactSizeMatch(opt, wanted)) return v;
    if (wanted === "one size" && nodes.length === 1) return v;
  }
  return null;
}

async function setPriceLocked(variantId: string) {
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
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.metafieldsSet?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}

async function updateVariantPrice(productId: string, variantId: string, price: number, cost: number) {
  const { data, errors } = await shopifyGraphQL<{
    productVariantsBulkUpdate: { userErrors: Array<{ message: string }> };
  }>(
    `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { message }
      }
    }`,
    {
      productId,
      variants: [
        {
          id: variantId,
          price: price.toFixed(2),
          inventoryItem: { tracked: true, cost: cost.toFixed(2) },
        },
      ],
    }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}

async function setDescription(productId: string, html: string) {
  const { data, errors } = await shopifyGraphQL<{
    productUpdate: { userErrors: Array<{ message: string }> };
  }>(
    `mutation($input: ProductInput!) {
      productUpdate(input: $input) { userErrors { message } }
    }`,
    { input: { id: productId, descriptionHtml: html } }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.productUpdate?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}

async function setStatus(productId: string, status: "ACTIVE" | "DRAFT") {
  const { data, errors } = await shopifyGraphQL<{
    productUpdate: { userErrors: Array<{ message: string }> };
  }>(
    `mutation($product: ProductUpdateInput!) {
      productUpdate(product: $product) { userErrors { message } }
    }`,
    { product: { id: productId, status } }
  );
  // fallback older ProductInput shape
  if (errors?.length || (data?.productUpdate?.userErrors?.length ?? 0) > 0) {
    const r2 = await shopifyGraphQL<{
      productUpdate: { userErrors: Array<{ message: string }> };
    }>(
      `mutation($input: ProductInput!) {
        productUpdate(input: $input) { userErrors { message } }
      }`,
      { input: { id: productId, status } }
    );
    if (r2.errors?.length) throw new Error(r2.errors.map((e) => e.message).join("; "));
    const ue = r2.data?.productUpdate?.userErrors ?? [];
    if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
    return;
  }
}

async function createMissingVariant(input: {
  productId: string;
  optionId: string;
  size: string;
  price: number;
  cost: number;
  sku: string;
}): Promise<{ id: string; inventoryItemId: string | null } | null> {
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
            cost: input.cost.toFixed(2),
          },
        },
      ],
    }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.productVariantsBulkCreate?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
  const v = data?.productVariantsBulkCreate?.productVariants?.[0];
  if (!v) return null;
  return { id: v.id, inventoryItemId: v.inventoryItem?.id ?? null };
}

async function loadProductOptions(productId: string) {
  const { data } = await shopifyGraphQL<{
    product: { options: Array<{ id: string; name: string }> } | null;
  }>(
    `query($id: ID!) { product(id: $id) { options(first: 5) { id name } } }`,
    { id: productId }
  );
  return data?.product?.options ?? [];
}

async function setProductMetafields(ownerId: string, offer: Offer, imageSource: string | null) {
  const fields = [
    { namespace: "supplier", key: "name", type: "single_line_text_field", value: "Money Kickz" },
    { namespace: "supplier", key: "product_key", type: "single_line_text_field", value: offer.key },
    {
      namespace: "supplier",
      key: "source_message_id",
      type: "single_line_text_field",
      value: "money-kickz-whatsapp-2026-08-08",
    },
    {
      namespace: "supplier",
      key: "raw_quantity",
      type: "json",
      value: JSON.stringify(Object.fromEntries(offer.variants.map((v) => [v.size, v.qty]))),
    },
    {
      namespace: "supplier",
      key: "last_seen_at",
      type: "single_line_text_field",
      value: "2026-08-08T12:00:00+02:00",
    },
    {
      namespace: "product_data",
      key: "auth_status",
      type: "single_line_text_field",
      value: "AUTH_PENDING",
    },
    {
      namespace: "product_data",
      key: "identity_confidence",
      type: "number_decimal",
      value: offer.needsExactImage ? "0.85" : "0.95",
    },
  ];
  if (imageSource) {
    fields.push({
      namespace: "product_data",
      key: "image_source_url",
      type: "single_line_text_field",
      value: imageSource.slice(0, 255),
    });
  }
  const { data, errors } = await shopifyGraphQL<{
    metafieldsSet: { userErrors: Array<{ message: string }> };
  }>(
    `mutation($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { message } }
    }`,
    { metafields: fields.map((f) => ({ ownerId, ...f })) }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.metafieldsSet?.userErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
}

function buildDescription(offer: Offer): string {
  const color = offer.colorway ? ` — ${offer.colorway}` : "";
  const cat = offer.category ? ` (${offer.category})` : "";
  return [
    `<p>Découvrez ${offer.title}${color}${cat} de ${offer.vendor}. Disponible chez Resell Lausanne — chaque article est authentifié et vérifié manuellement avant expédition. Livraison en Suisse et en Europe.</p>`,
    `<p><strong>Coloris :</strong> ${offer.colorway ?? "—"}<br><strong>Marque :</strong> ${offer.brand}<br><strong>Catégorie :</strong> ${offer.category ?? "Apparel"}</p>`,
    `<p>Produit 100% authentique. Resell Lausanne sélectionne uniquement des articles en parfait état.</p>`,
  ].join("\n");
}

async function scrapeImageCandidates(pageUrl: string): Promise<string[]> {
  const res = await fetch(pageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) return [];
  const html = await res.text();
  const found = new Set<string>();
  for (const re of [
    /property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/gi,
    /content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/gi,
    /"(https:\/\/cdn\.shopify\.com\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi,
    /"(https:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/gi,
  ]) {
    for (const m of html.matchAll(re)) {
      const u = m[1]?.replace(/&amp;/g, "&").split("&width=")[0];
      if (!u?.startsWith("http")) continue;
      // skip tiny icons / logos / sprites
      if (/icon|logo|sprite|favicon|1x1|pixel|badge|payment/i.test(u)) continue;
      let cleaned = u.replace(/^http:\/\//i, "https://");
      // Prefer larger Shopify CDN derivatives
      cleaned = cleaned
        .replace(/_\d+x\d+\./, ".")
        .replace(/(\d+)x\d+\./, "$1x.")
        .replace(/width=\d+/g, "width=2048")
        .replace(/height=\d+/g, "height=2048");
      if (/crop=center&height=480/i.test(cleaned)) {
        cleaned = cleaned.replace(/height=480/i, "height=1200");
      }
      found.add(cleaned);
    }
  }
  return [...found];
}

async function validateImage(
  url: string
): Promise<{ ok: boolean; url: string; mime?: string; w?: number; h?: number; bytes?: number; reason?: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "image/*" },
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, url, reason: `http_${res.status}` };
    const mime = (res.headers.get("content-type") || "").split(";")[0]!.trim().toLowerCase();
    if (!/^image\/(jpeg|jpg|png|webp|gif)$/.test(mime)) {
      return { ok: false, url, reason: `bad_mime_${mime}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 20_000) return { ok: false, url, reason: `too_small_${buf.length}` };
    // crude dimension sniff
    let w = 0;
    let h = 0;
    if (mime.includes("png") && buf.length > 24) {
      w = buf.readUInt32BE(16);
      h = buf.readUInt32BE(20);
    } else if ((mime.includes("jpeg") || mime.includes("jpg")) && buf[0] === 0xff && buf[1] === 0xd8) {
      // scan SOF
      let i = 2;
      while (i < buf.length - 8) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1]!;
        if (marker === 0xc0 || marker === 0xc2) {
          h = buf.readUInt16BE(i + 5);
          w = buf.readUInt16BE(i + 7);
          break;
        }
        const len = buf.readUInt16BE(i + 2);
        i += 2 + len;
      }
    } else if (mime.includes("webp") && buf.toString("ascii", 0, 4) === "RIFF") {
      // VP8X
      if (buf.toString("ascii", 12, 16) === "VP8X" && buf.length >= 30) {
        w = 1 + buf.readUIntLE(24, 3);
        h = 1 + buf.readUIntLE(27, 3);
      }
    }
    if (w > 0 && h > 0 && (w < 400 || h < 400)) {
      return { ok: false, url, mime, w, h, bytes: buf.length, reason: `dims_${w}x${h}` };
    }
    return { ok: true, url, mime, w, h, bytes: buf.length };
  } catch (e) {
    return { ok: false, url, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function addImages(productId: string, urls: string[]) {
  const media = urls.map((url) => ({
    originalSource: url,
    mediaContentType: "IMAGE",
  }));
  const { data, errors } = await shopifyGraphQL<{
    productCreateMedia: {
      media: Array<{ id: string | null; status: string } | null>;
      mediaUserErrors: Array<{ message: string }>;
    };
  }>(
    `mutation($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id status }
        mediaUserErrors { message }
      }
    }`,
    { productId, media }
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  const ue = data?.productCreateMedia?.mediaUserErrors ?? [];
  if (ue.length) throw new Error(ue.map((e) => e.message).join("; "));
  return (data?.productCreateMedia?.media ?? []).filter((m) => m?.id).length;
}

async function resolveImages(offer: Offer): Promise<{ urls: string[]; source: string | null; blocked?: string }> {
  const candidates: string[] = [...(offer.imageUrls ?? [])];
  for (const page of offer.imagePages ?? []) {
    const scraped = await scrapeImageCandidates(page);
    // prefer brand CDN / shopify CDN from that domain
    const ranked = scraped.sort((a, b) => {
      const score = (u: string) => {
        let s = 0;
        if (/aloyoga|bape\.com|cdn\.shopify\.com|stadiumgoods|takoutny|baitme|theluxny/i.test(u)) s += 10;
        if (/product|files\//i.test(u)) s += 3;
        if (/thumb|small|100x|200x/i.test(u)) s -= 5;
        return s;
      };
      return score(b) - score(a);
    });
    candidates.push(...ranked);
  }
  const unique = [...new Set(candidates)];
  const validated: string[] = [];
  let source: string | null = null;
  for (const u of unique.slice(0, 40)) {
    const v = await validateImage(u);
    if (!v.ok) continue;
    validated.push(u);
    if (!source) source = u;
    if (validated.length >= 4) break;
  }
  if (!validated.length) {
    return {
      urls: [],
      source: null,
      blocked: "NEEDS_EXACT_IMAGE: no validated official/reputable image found",
    };
  }
  return { urls: validated, source };
}

type RowOut = Record<string, unknown>;

async function processOffer(offer: Offer): Promise<RowOut> {
  const out: RowOut = {
    title: offer.title,
    handle: offer.key,
    productId: offer.productId,
    retailChf: offer.retailChf,
    actions: [] as string[],
    errors: [] as string[],
    imageUrls: [] as string[],
    blocked: null as string | null,
  };
  const product = await loadProduct(offer.productId);
  if (!product) {
    out.blocked = "product_missing";
    return out;
  }
  out.statusBefore = product.status;
  const mediaCount = product.media.nodes.filter((n) => n?.image?.url).length;
  const descLen = (product.descriptionHtml || "").replace(/<[^>]+>/g, "").trim().length;
  out.mediaBefore = mediaCount;
  out.descBefore = descLen;

  // Images for stubs / missing
  let imageSource: string | null = null;
  if (mediaCount === 0) {
    const resolved = await resolveImages(offer);
    if (resolved.blocked || !resolved.urls.length) {
      out.blocked = resolved.blocked ?? "NEEDS_EXACT_IMAGE";
      (out.actions as string[]).push("BLOCK_IMAGE");
    } else if (WRITE) {
      const added = await addImages(offer.productId, resolved.urls);
      imageSource = resolved.source;
      out.imageUrls = resolved.urls;
      (out.actions as string[]).push(`IMAGES_ADDED_${added}`);
    } else {
      out.imageUrls = resolved.urls;
      imageSource = resolved.source;
      (out.actions as string[]).push(`WOULD_ADD_IMAGES_${resolved.urls.length}`);
    }
  } else {
    imageSource = product.media.nodes.find((n) => n?.image?.url)?.image?.url ?? null;
    (out.actions as string[]).push("IMAGES_OK");
  }

  // Description
  if (descLen < 80 && !out.blocked) {
    const html = buildDescription(offer);
    if (WRITE) {
      await setDescription(offer.productId, html);
      (out.actions as string[]).push("DESC_SET");
    } else {
      (out.actions as string[]).push("WOULD_SET_DESC");
    }
  } else if (descLen >= 80) {
    (out.actions as string[]).push("DESC_OK");
  }

  // Price / stock / lock — exact sizes only; create missing sizes when listed by supplier
  const cost = costChf(offer.costUsd);
  let nodes = product.variants.nodes;
  const options = WRITE ? await loadProductOptions(offer.productId) : [];
  const optionId =
    options.find((o) => /size|taille/i.test(o.name))?.id ?? options[0]?.id ?? null;
  const styleBase =
    nodes
      .map((v) => v.sku)
      .find((s) => s && String(s).includes("-"))
      ?.split("-")
      .slice(0, -1)
      .join("-") ?? `MK-${offer.key}`.toUpperCase();

  for (const vo of offer.variants) {
    let variant = findExactVariant(nodes, vo.size);
    const sizeLabel = normalizeSize(vo.size) === "one size" ? "One Size" : vo.size.trim();
    if (!variant && WRITE && optionId) {
      try {
        const created = await createMissingVariant({
          productId: offer.productId,
          optionId,
          size: sizeLabel,
          price: offer.retailChf,
          cost,
          sku: `${styleBase}-${sizeLabel}`.slice(0, 64),
        });
        if (created) {
          const refreshed = await loadProduct(offer.productId);
          nodes = refreshed?.variants.nodes ?? nodes;
          variant = findExactVariant(nodes, vo.size) ?? findExactVariant(nodes, sizeLabel);
          (out.actions as string[]).push(`CREATED_SIZE_${sizeLabel}`);
        }
      } catch (e) {
        (out.errors as string[]).push(
          `create_variant_${vo.size}:${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
    if (!variant) {
      (out.errors as string[]).push(`missing_variant:${vo.size}`);
      continue;
    }
    const qty = shopifyQty(vo.qty);
    if (WRITE) {
      await updateVariantPrice(offer.productId, variant.id, offer.retailChf, cost);
      // reload inventory item id if newly created
      let invId = variant.inventoryItem?.id;
      if (!invId) {
        const refreshed = await loadProduct(offer.productId);
        invId = findExactVariant(refreshed?.variants.nodes ?? [], vo.size)?.inventoryItem?.id ?? null;
      }
      if (invId) {
        await setInventoryQuantity({
          inventoryItemId: invId,
          locationId: LOCATION_ID,
          quantity: qty,
        });
      }
      await setPriceLocked(variant.id);
    }
    (out.actions as string[]).push(`VAR_${vo.size}_p${offer.retailChf}_q${qty}_LOCK`);
  }

  if (WRITE) {
    await setProductMetafields(offer.productId, offer, imageSource);
    (out.actions as string[]).push("META_SET");
  }

  // Activate if complete (has/will have images + desc) and not blocked
  const willHaveImages = mediaCount > 0 || (out.imageUrls as string[]).length > 0;
  if (!out.blocked && willHaveImages) {
    if (WRITE && product.status !== "ACTIVE") {
      await setStatus(offer.productId, "ACTIVE");
      (out.actions as string[]).push("ACTIVATED");
    } else if (product.status !== "ACTIVE") {
      (out.actions as string[]).push("WOULD_ACTIVATE");
    }
  } else if (out.blocked) {
    (out.actions as string[]).push("KEEP_DRAFT_BLOCKED");
  }

  return out;
}

async function main() {
  if (!LOCATION_ID) {
    console.error("BLOCKER: SHOPIFY_LOC_MONEY_KICKZ missing");
    process.exit(2);
  }
  console.log(`mode=${WRITE ? "WRITE" : "DRY"} loc=${LOCATION_ID}`);
  const offers = buildOffers();
  console.log("offers", offers.length);
  const results: RowOut[] = [];
  for (const offer of offers) {
    console.log(`\n→ ${offer.title}`);
    try {
      const row = await processOffer(offer);
      results.push(row);
      console.log(
        " ",
        row.blocked ? `BLOCK ${row.blocked}` : "OK",
        (row.actions as string[]).slice(0, 8).join(", "),
        row.imageUrls && (row.imageUrls as string[]).length
          ? `imgs=${(row.imageUrls as string[]).length}`
          : ""
      );
      if ((row.errors as string[]).length) console.log("  errs", row.errors);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("  FAIL", msg);
      results.push({ title: offer.title, productId: offer.productId, blocked: msg, actions: ["FAIL"] });
    }
  }
  const outDir = path.join(process.cwd(), "tmp/money-kickz");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `enrich-${WRITE ? "write" : "dry"}-2026-08-08.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        write: WRITE,
        locationId: LOCATION_ID,
        results,
        summary: {
          total: results.length,
          blocked: results.filter((r) => r.blocked).length,
          activated: results.filter((r) => (r.actions as string[])?.includes("ACTIVATED")).length,
        },
      },
      null,
      2
    )
  );
  console.log("\nWrote", outPath);
  console.log(
    "summary",
    JSON.stringify({
      total: results.length,
      blocked: results.filter((r) => r.blocked).length,
      withImagesAdded: results.filter((r) =>
        (r.actions as string[])?.some((a) => a.startsWith("IMAGES_ADDED") || a.startsWith("WOULD_ADD"))
      ).length,
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
