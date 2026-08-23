import { prisma } from "@/app/lib/prisma";
import { normalizeSize, normalizeSku, validateGtin } from "@/app/lib/normalize";
import { assertMappingIntegrity, buildProviderKey } from "@/galaxus/supplier/providerKey";
import { isGalaxusCatalogReady } from "@/galaxus/exports/feedEligibility";
import { resolvePhysicalCatalogIdentity } from "@/galaxus/jobs/physicalCatalogHydrate";
import { hydrateSupplierVariantsMissingCatalog } from "@/galaxus/jobs/hydrateCatalogIdentity";
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
  /** Redundant `ner:` rows removed because a catalog-ready row already covers the GTIN. */
  duplicateNerRowsRemoved: number;
  /** Existing `ner:` rows that gained brand + images from KickDB. */
  catalogRowsHydrated: number;
  /** GTINs where neither local KickDB nor the API could supply brand + images. */
  catalogUnhydrated: string[];
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

/**
 * Repair `ner:` rows that already exist but never got catalog identity.
 *
 * Rows created before hydration existed carry only Shopify fields, so they fail
 * `isGalaxusCatalogReady` forever — the GTIN has a mapping and looks healthy, but the
 * pair is silently absent from every feed. Local KickDB covers almost all of them.
 */
async function hydrateIncompletePhysicalRows(
  normalizedGtins: string[],
  unhydrated: string[]
): Promise<number> {
  if (normalizedGtins.length === 0) return 0;

  const rows = await prisma.$queryRaw<
    Array<{
      normalized_gtin: string;
      supplierVariantId: string;
      providerKey: string | null;
      images: unknown;
      sourceImageUrl: string | null;
      hostedImageUrl: string | null;
      supplierProductName: string | null;
      supplierBrand: string | null;
      supplierSku: string | null;
    }>
  >`
    SELECT
      regexp_replace(sv."gtin", '^0+', '') AS normalized_gtin,
      sv."supplierVariantId",
      sv."providerKey",
      sv."images",
      sv."sourceImageUrl",
      sv."hostedImageUrl",
      sv."supplierProductName",
      sv."supplierBrand",
      sv."supplierSku"
    FROM "public"."SupplierVariant" sv
    WHERE regexp_replace(sv."gtin", '^0+', '') = ANY(${normalizedGtins}::text[])
      AND sv."providerKey" LIKE 'NER_%'
  `;

  let hydrated = 0;
  for (const row of rows) {
    if (isGalaxusCatalogReady(row)) continue;

    const identity = await resolvePhysicalCatalogIdentity(row.normalized_gtin);
    if (!identity.brand || identity.images.length === 0) {
      unhydrated.push(row.normalized_gtin);
      continue;
    }

    await prisma.supplierVariant.update({
      where: { supplierVariantId: row.supplierVariantId },
      data: {
        supplierBrand: identity.brand,
        images: identity.images,
        sourceImageUrl: identity.images[0],
        ...(identity.name ? { supplierProductName: identity.name } : {}),
        updatedAt: new Date(),
      },
    });
    hydrated += 1;
  }

  if (hydrated > 0) {
    console.info("[galaxus][physical-recovery] hydrated catalog identity", { hydrated });
  }
  return hydrated;
}

/**
 * A `ner:` row is only ever a stand-in for a GTIN the catalog did not have yet.
 * When the real catalog row shows up later (StockX SSE upsert, partner import), the
 * stand-in becomes a second ProviderKey for one physical pair — Galaxus then sees two
 * competing offers. Retire the stand-in and let the catalog row carry the stock.
 */
async function removeRedundantPhysicalRows(normalizedGtins: string[]): Promise<number> {
  if (normalizedGtins.length === 0) return 0;

  const rows = await prisma.$queryRaw<
    Array<{
      normalized_gtin: string;
      supplierVariantId: string;
      providerKey: string | null;
      images: unknown;
      sourceImageUrl: string | null;
      hostedImageUrl: string | null;
      supplierProductName: string | null;
      supplierBrand: string | null;
      supplierSku: string | null;
    }>
  >`
    SELECT
      regexp_replace(sv."gtin", '^0+', '') AS normalized_gtin,
      sv."supplierVariantId",
      sv."providerKey",
      sv."images",
      sv."sourceImageUrl",
      sv."hostedImageUrl",
      sv."supplierProductName",
      sv."supplierBrand",
      sv."supplierSku"
    FROM "public"."SupplierVariant" sv
    WHERE regexp_replace(sv."gtin", '^0+', '') = ANY(${normalizedGtins}::text[])
  `;

  const byGtin = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byGtin.get(row.normalized_gtin) ?? [];
    list.push(row);
    byGtin.set(row.normalized_gtin, list);
  }

  const redundant: string[] = [];
  for (const list of byGtin.values()) {
    if (list.length < 2) continue;
    const keeper = list.find(
      (row) => !String(row.providerKey ?? "").startsWith("NER_") && isGalaxusCatalogReady(row)
    );
    if (!keeper) continue;
    for (const row of list) {
      if (row.supplierVariantId === keeper.supplierVariantId) continue;
      if (!String(row.providerKey ?? "").startsWith("NER_")) continue;
      redundant.push(row.supplierVariantId);
    }
  }

  if (redundant.length === 0) return 0;

  await prisma.variantMapping.deleteMany({
    where: { supplierVariantId: { in: redundant } },
  });
  const deleted = await prisma.supplierVariant.deleteMany({
    where: { supplierVariantId: { in: redundant } },
  });

  console.info("[galaxus][physical-recovery] removed redundant ner rows", {
    count: deleted.count,
  });
  return deleted.count;
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
  let duplicateNerRowsRemoved = 0;
  let catalogRowsHydrated = 0;
  const catalogUnhydrated: string[] = [];

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

        // Physical rows must carry the same catalog identity as the dropship catalog,
        // otherwise `isGalaxusCatalogReady` rejects them and they never reach the feed.
        const identity = await resolvePhysicalCatalogIdentity(orphan.normalized);
        const productTitle =
          identity.name ?? (String(info?.productTitle ?? "").trim() || null);
        const catalogFields = {
          supplierBrand: identity.brand,
          ...(identity.images.length > 0
            ? { images: identity.images, sourceImageUrl: identity.images[0] }
            : {}),
        };
        if (!identity.brand || identity.images.length === 0) {
          catalogUnhydrated.push(orphan.normalized);
        }

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
              ...catalogFields,
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
              ...catalogFields,
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

  if (!dryRun) {
    // Dedupe first so we never spend a KickDB lookup on a row we are about to delete.
    duplicateNerRowsRemoved = await removeRedundantPhysicalRows(normalizedGtins);
    catalogRowsHydrated = await hydrateIncompletePhysicalRows(normalizedGtins, catalogUnhydrated);
    const stxHydrated = await hydrateSupplierVariantsMissingCatalog({
      supplierVariantIdPrefix: "stx_",
      limit: 200,
    });
    catalogRowsHydrated += stxHydrated.hydrated;
  }

  const changedRows =
    mappingInsertedOrUpdated +
    mappingRealigned +
    supplierVariantsCreated +
    supplierVariantsUpdated +
    duplicateNerRowsRemoved +
    catalogRowsHydrated;
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
    duplicateNerRowsRemoved,
    catalogRowsHydrated,
    catalogUnhydrated,
    feedTriggerId,
    feedTriggerCreated,
  };
}
