import { prisma } from "@/app/lib/prisma";
import { normalizeSize, normalizeSku, validateGtin } from "@/app/lib/normalize";
import { assertMappingIntegrity, buildProviderKey } from "@/galaxus/supplier/providerKey";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const VAT_DIVISOR = 1.081;
const FALLBACK_PRICE_CHF = 150;
const PHYSICAL_LOCATION_NAMES = [
  "Warehouse Bussigny",
  "Antica Bottegas",
  "THE LAB CONCEPT STORE",
  "COLD BIEN",
] as const;

type RecoverPhysicalStockOptions = {
  dryRun?: boolean;
  limit?: number | null;
  triggerFeedPush?: boolean;
};

type RecoverPhysicalStockResult = {
  totalPhysicalGtins: number;
  validGtins: number;
  invalidGtins: number;
  alreadyOk: number;
  mappingInsertedOrUpdated: number;
  mappingRealigned: number;
  supplierVariantsCreated: number;
  supplierVariantsUpdated: number;
  supplierVariantsSkipped: number;
  feedTriggerId?: string | null;
  feedTriggerCreated?: boolean;
};

type ShopifyVariantInfo = {
  variantId: string;
  sku: string | null;
  barcode: string | null;
  price: number | null;
  sizeTitle: string | null;
  productTitle: string | null;
};

const VARIANT_LOOKUP_QUERY = /* GraphQL */ `
  query VariantByGid($id: ID!) {
    productVariant(id: $id) {
      id
      title
      sku
      barcode
      price
      product {
        title
      }
    }
  }
`;

function sanitizeIdPart(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function normalizePriceExVat(inclVat: number | null): number {
  const chf = inclVat ?? FALLBACK_PRICE_CHF;
  const ex = chf / VAT_DIVISOR;
  return Math.round(ex * 100) / 100;
}

async function fetchShopifyVariant(shopifyVariantId: string): Promise<ShopifyVariantInfo | null> {
  const gid = shopifyVariantId.startsWith("gid://")
    ? shopifyVariantId
    : `gid://shopify/ProductVariant/${shopifyVariantId}`;
  const { data, errors } = await shopifyGraphQL<{
    productVariant: {
      id: string;
      title: string;
      sku: string | null;
      barcode: string | null;
      price: string;
      product: { title: string | null } | null;
    } | null;
  }>(VARIANT_LOOKUP_QUERY, { id: gid }, { estimatedQueryCost: 15 });
  if (errors?.length) {
    throw new Error(`Shopify GQL errors for ${gid}: ${errors.map((e) => e.message).join(" | ")}`);
  }
  const v = data?.productVariant;
  if (!v) return null;
  const priceNum = Number.parseFloat(v.price);
  return {
    variantId: v.id,
    sku: v.sku,
    barcode: v.barcode,
    price: Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null,
    sizeTitle: v.title,
    productTitle: v.product?.title ?? null,
  };
}

export async function recoverPhysicalStockForGalaxus(
  options: RecoverPhysicalStockOptions = {}
): Promise<RecoverPhysicalStockResult> {
  const dryRun = options.dryRun === true;
  const shouldTriggerFeedPush = options.triggerFeedPush !== false;
  const now = new Date();

  const mirrorRows = await prisma.$queryRaw<
    Array<{
      gtin: string;
      qty: bigint;
      sku: string | null;
      shopifyVariantId: string;
      locations: string[];
    }>
  >`
    SELECT
      s."gtin"                                AS gtin,
      SUM(s."available")::bigint              AS qty,
      MAX(s."sku")                            AS sku,
      MAX(s."shopifyVariantId")               AS "shopifyVariantId",
      array_agg(DISTINCT s."locationName")    AS locations
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."sourceType" = 'physical'
      AND s."available" > 0
      AND s."locationName" = ANY(${Array.from(PHYSICAL_LOCATION_NAMES)}::text[])
      AND s."gtin" IS NOT NULL
      AND TRIM(s."gtin") <> ''
    GROUP BY s."gtin"
    ORDER BY s."gtin"
  `;

  type MirrorNorm = {
    normalized: string;
    qty: number;
    sku: string | null;
    shopifyVariantId: string;
    locations: string[];
  };

  const invalidGtins: string[] = [];
  const normalizedRows: MirrorNorm[] = [];
  for (const row of mirrorRows) {
    const raw = String(row.gtin ?? "").trim();
    const normalized = raw.replace(/^0+/, "") || raw;
    if (!validateGtin(normalized)) {
      invalidGtins.push(raw);
      continue;
    }
    normalizedRows.push({
      normalized,
      qty: Number(row.qty ?? 0),
      sku: row.sku,
      shopifyVariantId: row.shopifyVariantId,
      locations: row.locations,
    });
  }

  const normalizedGtins = normalizedRows.map((row) => row.normalized);
  const svRows = normalizedGtins.length
    ? await prisma.$queryRaw<
        Array<{
          normalized_gtin: string;
          supplierVariantId: string | null;
          gtin: string | null;
          providerKey: string | null;
          mappingId: string | null;
          mappingGtin: string | null;
          mappingProviderKey: string | null;
        }>
      >`
        SELECT DISTINCT ON (regexp_replace(sv."gtin", '^0+', ''))
          regexp_replace(sv."gtin", '^0+', '') AS normalized_gtin,
          sv."supplierVariantId",
          sv."gtin",
          sv."providerKey",
          vm."id" AS "mappingId",
          vm."gtin" AS "mappingGtin",
          vm."providerKey" AS "mappingProviderKey"
        FROM "public"."SupplierVariant" sv
        LEFT JOIN "public"."VariantMapping" vm
          ON vm."supplierVariantId" = sv."supplierVariantId"
         AND vm."status" IN ('MATCHED','SUPPLIER_GTIN','PARTNER_GTIN')
        WHERE regexp_replace(sv."gtin", '^0+', '') = ANY(${normalizedGtins}::text[])
        ORDER BY regexp_replace(sv."gtin", '^0+', ''),
                 (vm."id" IS NULL),
                 (sv."providerKey" LIKE 'STX_%') DESC,
                 sv."updatedAt" DESC
      `
    : [];

  const svByNorm = new Map<
    string,
    {
      supplierVariantId: string;
      svGtin: string;
      svProviderKey: string;
      hasMapping: boolean;
      mappingGtin: string | null;
      mappingProviderKey: string | null;
    }
  >();

  for (const row of svRows) {
    if (!row.normalized_gtin || !row.supplierVariantId || !row.gtin || !row.providerKey) continue;
    svByNorm.set(row.normalized_gtin, {
      supplierVariantId: row.supplierVariantId,
      svGtin: row.gtin,
      svProviderKey: row.providerKey,
      hasMapping: row.mappingId != null,
      mappingGtin: row.mappingGtin,
      mappingProviderKey: row.mappingProviderKey,
    });
  }

  const needMapping: Array<{ supplierVariantId: string; gtin: string; providerKey: string }> = [];
  const needSv: Array<{
    normalized: string;
    qty: number;
    sku: string | null;
    shopifyVariantId: string;
  }> = [];
  const mappingRealign: Array<{ supplierVariantId: string; gtin: string; providerKey: string }> = [];
  let alreadyOk = 0;

  for (const row of normalizedRows) {
    const sv = svByNorm.get(row.normalized);
    if (!sv) {
      needSv.push({
        normalized: row.normalized,
        qty: row.qty,
        sku: row.sku,
        shopifyVariantId: row.shopifyVariantId,
      });
      continue;
    }
    if (!sv.hasMapping) {
      needMapping.push({
        supplierVariantId: sv.supplierVariantId,
        gtin: sv.svGtin,
        providerKey: sv.svProviderKey,
      });
      continue;
    }
    const mapNorm = String(sv.mappingGtin ?? "").replace(/^0+/, "") || "";
    const svNorm = String(sv.svGtin ?? "").replace(/^0+/, "") || "";
    if (
      svNorm &&
      mapNorm &&
      svNorm !== mapNorm &&
      sv.svProviderKey.startsWith("STX_")
    ) {
      mappingRealign.push({
        supplierVariantId: sv.supplierVariantId,
        gtin: sv.svGtin,
        providerKey: sv.svProviderKey,
      });
      continue;
    }
    alreadyOk += 1;
  }

  const targets = options.limit && options.limit > 0 ? needSv.slice(0, options.limit) : needSv;

  let mappingInsertedOrUpdated = 0;
  let mappingRealigned = 0;
  let supplierVariantsCreated = 0;
  let supplierVariantsUpdated = 0;
  let supplierVariantsSkipped = 0;

  if (!dryRun) {
    for (const row of needMapping) {
      assertMappingIntegrity({
        supplierVariantId: row.supplierVariantId,
        gtin: row.gtin,
        providerKey: row.providerKey,
        status: "SUPPLIER_GTIN",
      });
      await prisma.variantMapping.upsert({
        where: { supplierVariantId: row.supplierVariantId },
        update: {
          gtin: row.gtin,
          providerKey: row.providerKey,
          status: "SUPPLIER_GTIN",
          updatedAt: now,
        },
        create: {
          supplierVariantId: row.supplierVariantId,
          gtin: row.gtin,
          providerKey: row.providerKey,
          status: "SUPPLIER_GTIN",
        },
      });
      mappingInsertedOrUpdated += 1;
    }

    for (const row of mappingRealign) {
      assertMappingIntegrity({
        supplierVariantId: row.supplierVariantId,
        gtin: row.gtin,
        providerKey: row.providerKey,
        status: "SUPPLIER_GTIN",
      });
      await prisma.variantMapping.updateMany({
        where: { supplierVariantId: row.supplierVariantId },
        data: {
          gtin: row.gtin,
          providerKey: row.providerKey,
          status: "SUPPLIER_GTIN",
          updatedAt: now,
        },
      });
      mappingRealigned += 1;
    }

    for (const orphan of targets) {
      try {
        const info = await fetchShopifyVariant(orphan.shopifyVariantId);
        const sku = normalizeSku(orphan.sku ?? info?.sku ?? "") ?? orphan.sku ?? info?.sku ?? null;
        if (!sku) {
          supplierVariantsSkipped += 1;
          continue;
        }
        const sizeRaw = String(info?.sizeTitle ?? "").trim() || "OS";
        const sizeNormalized = normalizeSize(sizeRaw) ?? sizeRaw;
        const priceExVat = normalizePriceExVat(info?.price ?? null);
        const productTitle = String(info?.productTitle ?? "").trim() || null;

        const supplierVariantId = `ner:${sanitizeIdPart(sku)}-${sanitizeIdPart(sizeNormalized || "OS")}`;
        const providerKey = buildProviderKey(orphan.normalized, supplierVariantId);
        if (!providerKey) {
          supplierVariantsSkipped += 1;
          continue;
        }

        const existing = await prisma.supplierVariant.findUnique({ where: { supplierVariantId } });
        if (existing) {
          await prisma.supplierVariant.update({
            where: { supplierVariantId },
            data: {
              gtin: orphan.normalized,
              providerKey,
              price: priceExVat,
              stock: orphan.qty,
              supplierSku: sku,
              sizeRaw,
              sizeNormalized,
              supplierProductName: productTitle,
              lastSyncAt: now,
              updatedAt: now,
            },
          });
          supplierVariantsUpdated += 1;
        } else {
          await prisma.supplierVariant.create({
            data: {
              supplierVariantId,
              supplierSku: sku,
              providerKey,
              gtin: orphan.normalized,
              price: priceExVat,
              stock: orphan.qty,
              sizeRaw,
              sizeNormalized,
              supplierProductName: productTitle,
              lastSyncAt: now,
            },
          });
          supplierVariantsCreated += 1;
        }

        assertMappingIntegrity({
          supplierVariantId,
          gtin: orphan.normalized,
          providerKey,
          status: "SUPPLIER_GTIN",
        });
        await prisma.variantMapping.upsert({
          where: { supplierVariantId },
          update: {
            gtin: orphan.normalized,
            providerKey,
            status: "SUPPLIER_GTIN",
            updatedAt: now,
          },
          create: {
            supplierVariantId,
            gtin: orphan.normalized,
            providerKey,
            status: "SUPPLIER_GTIN",
          },
        });
        mappingInsertedOrUpdated += 1;
      } catch (error) {
        console.warn("[galaxus][physical-recovery] orphan create failed", {
          gtin: orphan.normalized,
          error: error instanceof Error ? error.message : String(error),
        });
        supplierVariantsSkipped += 1;
      }
    }
  }

  const changedRows =
    mappingInsertedOrUpdated + mappingRealigned + supplierVariantsCreated + supplierVariantsUpdated;
  let feedTriggerId: string | null = null;
  let feedTriggerCreated = false;
  if (!dryRun && shouldTriggerFeedPush && changedRows > 0) {
    const { enqueueFeedPushTrigger } = await import("@/galaxus/ops/feedPipeline");
    const queued = await enqueueFeedPushTrigger({
      scope: "stock-price",
      triggerSource: "inventory-sync",
    });
    feedTriggerId = queued.triggerId;
    feedTriggerCreated = queued.created;
  }

  return {
    totalPhysicalGtins: mirrorRows.length,
    validGtins: normalizedRows.length,
    invalidGtins: invalidGtins.length,
    alreadyOk,
    mappingInsertedOrUpdated,
    mappingRealigned,
    supplierVariantsCreated,
    supplierVariantsUpdated,
    supplierVariantsSkipped,
    feedTriggerId,
    feedTriggerCreated,
  };
}
