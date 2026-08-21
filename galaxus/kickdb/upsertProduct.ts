import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { digestProductFields, pickPersistedKickdbSizes, pickString } from "@/galaxus/kickdb/extract";
import { pickPersistedKickdbBarcodes } from "@/galaxus/kickdb/client";
import { mergeKickdbRawJson } from "@/galaxus/kickdb/rawJsonMerge";
import { ingestStxFromRawPayload, zeroStxStockForKickdbProduct } from "@/galaxus/jobs/stxSync";

export type KickdbUpsertBody = {
  data?: unknown;
  notFound?: boolean;
  /** Skinny SSE price tick: merge into existing rawJson, keep gallery. */
  priceOnly?: boolean;
  skipShopifyPriceSync?: boolean;
};

export type KickdbUpsertResult =
  | {
      ok: true;
      delisted: true;
      kickdbProductId: string;
      stockZeroed: number;
      ms: number;
    }
  | {
      ok: true;
      productId: string;
      kickdbProductId: string;
      urlKey: string | null;
      variantsUpserted: number;
      supplierVariantSync: {
        offeredVariants: number;
        created: number;
        updated: number;
        stockZeroed: number;
        mappingsInserted: number;
        mappingsUpdated: number;
      };
      ms: number;
    }
  | { ok: false; error: string; ms: number };

export async function upsertKickdbProductPayload(body: KickdbUpsertBody): Promise<KickdbUpsertResult> {
  const startedAt = Date.now();
  const data = body?.data as Record<string, unknown> | undefined;
  const kickdbProductId = pickString(data?.id);
  if (!data || !kickdbProductId) {
    return { ok: false, error: "missing_data_or_id", ms: Date.now() - startedAt };
  }

  const now = new Date();

  if (body?.notFound === true) {
    await prisma.$executeRaw`
      UPDATE "public"."KickDBProduct"
      SET "notFound" = true, "lastFetchedAt" = ${now}, "updatedAt" = ${now}
      WHERE "kickdbProductId" = ${kickdbProductId}
    `;
    const stockZeroed = await zeroStxStockForKickdbProduct(kickdbProductId);
    return {
      ok: true,
      delisted: true,
      kickdbProductId,
      stockZeroed,
      ms: Date.now() - startedAt,
    };
  }

  const digest = digestProductFields(data);
  const priceOnly = body?.priceOnly === true;

  let existingRaw: unknown = null;
  if (priceOnly) {
    const existing = await prisma.$queryRaw<Array<{ rawJson: unknown }>>`
      SELECT "rawJson"
      FROM "public"."KickDBProduct"
      WHERE "kickdbProductId" = ${kickdbProductId}
      LIMIT 1
    `;
    existingRaw = existing[0]?.rawJson ?? null;
  }
  const persistRaw = mergeKickdbRawJson(existingRaw, data, priceOnly);

  const product = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "public"."KickDBProduct" (
      "id", "kickdbProductId", "urlKey", "styleId", "name", "brand", "imageUrl",
      "traitsJson", "description", "gender", "colorway", "countryOfManufacture",
      "releaseDate", "retailPrice", "lastFetchedAt", "notFound",
      "rawJson", "rawFetchedAt", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid(), ${kickdbProductId}, ${digest.urlKey}, ${digest.styleId},
      ${digest.name}, ${digest.brand}, ${digest.imageUrl},
      ${digest.traitsJson === null ? null : JSON.stringify(digest.traitsJson)}::jsonb,
      ${digest.description}, ${digest.gender}, ${digest.colorway}, ${digest.countryOfManufacture},
      ${digest.releaseDate}, ${digest.retailPrice}, ${now}, false,
      ${JSON.stringify(persistRaw)}::jsonb, ${now}, ${now}, ${now}
    )
    ON CONFLICT ("kickdbProductId") DO UPDATE SET
      "urlKey"               = COALESCE(EXCLUDED."urlKey", "KickDBProduct"."urlKey"),
      "styleId"              = COALESCE(EXCLUDED."styleId", "KickDBProduct"."styleId"),
      "name"                 = COALESCE(EXCLUDED."name", "KickDBProduct"."name"),
      "brand"                = COALESCE(EXCLUDED."brand", "KickDBProduct"."brand"),
      "imageUrl"             = COALESCE(EXCLUDED."imageUrl", "KickDBProduct"."imageUrl"),
      "traitsJson"           = COALESCE(EXCLUDED."traitsJson", "KickDBProduct"."traitsJson"),
      "description"          = COALESCE(EXCLUDED."description", "KickDBProduct"."description"),
      "gender"               = COALESCE(EXCLUDED."gender", "KickDBProduct"."gender"),
      "colorway"             = COALESCE(EXCLUDED."colorway", "KickDBProduct"."colorway"),
      "countryOfManufacture" = COALESCE(EXCLUDED."countryOfManufacture", "KickDBProduct"."countryOfManufacture"),
      "releaseDate"          = COALESCE(EXCLUDED."releaseDate", "KickDBProduct"."releaseDate"),
      "retailPrice"          = COALESCE(EXCLUDED."retailPrice", "KickDBProduct"."retailPrice"),
      "lastFetchedAt"        = EXCLUDED."lastFetchedAt",
      "notFound"             = false,
      "rawJson"              = EXCLUDED."rawJson",
      "rawFetchedAt"         = CASE
        WHEN ${priceOnly} THEN "KickDBProduct"."rawFetchedAt"
        ELSE EXCLUDED."rawFetchedAt"
      END,
      "updatedAt"            = EXCLUDED."updatedAt"
    RETURNING "id"
  `;
  const productRowId = product[0]?.id;
  if (!productRowId) throw new Error("product_upsert_returned_no_id");

  const variants: any[] = Array.isArray(data.variants) ? data.variants : [];
  const kickdbVariantRows = variants
    .map((v) => {
      const kickdbVariantId = pickString(v?.id);
      if (!kickdbVariantId) return null;
      const { sizeEu, sizeUs } = pickPersistedKickdbSizes(v);
      const { gtin, ean } = pickPersistedKickdbBarcodes(v);
      return { kickdbVariantId, sizeEu, sizeUs, gtin, ean };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const variantsUpserted = kickdbVariantRows.length;

  if (kickdbVariantRows.length > 0) {
    const values = kickdbVariantRows.map((row) =>
      Prisma.sql`(
        gen_random_uuid(),
        ${row.kickdbVariantId},
        ${productRowId},
        ${row.sizeUs},
        ${row.sizeEu},
        ${row.gtin},
        ${row.ean},
        ${now},
        false,
        ${now},
        ${now}
      )`
    );
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "public"."KickDBVariant" (
          "id", "kickdbVariantId", "productId", "sizeUs", "sizeEu", "gtin", "ean",
          "lastFetchedAt", "notFound", "createdAt", "updatedAt"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("kickdbVariantId") DO UPDATE SET
          "productId"     = EXCLUDED."productId",
          "sizeUs"        = COALESCE(EXCLUDED."sizeUs", "KickDBVariant"."sizeUs"),
          "sizeEu"        = COALESCE(EXCLUDED."sizeEu", "KickDBVariant"."sizeEu"),
          "gtin"          = COALESCE(EXCLUDED."gtin", "KickDBVariant"."gtin"),
          "ean"           = COALESCE(EXCLUDED."ean", "KickDBVariant"."ean"),
          "lastFetchedAt" = EXCLUDED."lastFetchedAt",
          "notFound"      = false,
          "updatedAt"     = EXCLUDED."updatedAt"
      `
    );
  }

  const ingest = await ingestStxFromRawPayload(data, kickdbProductId, {
    skipShopifyPriceSync: body?.skipShopifyPriceSync === true,
  });

  return {
    ok: true,
    productId: productRowId,
    kickdbProductId,
    urlKey: digest.urlKey,
    variantsUpserted,
    supplierVariantSync: {
      offeredVariants: ingest.offeredVariants,
      created: ingest.created,
      updated: ingest.updated,
      stockZeroed: ingest.stockZeroed,
      mappingsInserted: ingest.mappingsInserted,
      mappingsUpdated: ingest.mappingsUpdated,
    },
    ms: Date.now() - startedAt,
  };
}
