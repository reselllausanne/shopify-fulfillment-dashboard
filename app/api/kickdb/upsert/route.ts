import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { digestProductFields, pickPersistedKickdbSizes, pickString } from "@/galaxus/kickdb/extract";
import { extractVariantGtin } from "@/galaxus/kickdb/client";
import { validateGtin } from "@/app/lib/normalize";
import { checkSharedSecret } from "@/app/api/kickdb/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/kickdb/upsert
 *
 * Ingests a RAW KicksDB product payload (byte-exact `data` object from
 * GET /v3/stockx/products/{id} with all display params) and stores it as the
 * single source of truth:
 *
 *   - `KickDBProduct.rawJson` + `rawFetchedAt` — the full payload, unparsed.
 *   - Digested columns (name, brand, sizes, gtin, ...) via the SAME extractors
 *     the marketplace enrichment uses (galaxus/kickdb/extract.ts).
 *
 * Merge semantics: COALESCE — a null extraction NEVER overwrites an existing
 * non-null column. VariantMapping is never touched here.
 *
 * Callers: SSE listener, sweeper, bootstrap job.
 *
 * Body: { data: <raw KicksDB product record> }
 */
export async function POST(req: Request) {
  const startedAt = Date.now();

  const authError = checkSharedSecret(req);
  if (authError) return authError;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const data = body?.data;
  const kickdbProductId = pickString(data?.id);
  if (!data || !kickdbProductId) {
    return NextResponse.json({ ok: false, error: "missing_data_or_id" }, { status: 400 });
  }

  const now = new Date();
  const digest = digestProductFields(data);

  try {
    // COALESCE merge on digested columns; rawJson always replaced (newest fetch wins).
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
        ${JSON.stringify(data)}::jsonb, ${now}, ${now}, ${now}
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
        "rawFetchedAt"         = EXCLUDED."rawFetchedAt",
        "updatedAt"            = EXCLUDED."updatedAt"
      RETURNING "id"
    `;
    const productRowId = product[0]?.id;
    if (!productRowId) throw new Error("product_upsert_returned_no_id");

    // Variant digests: only rows keyed by the KicksDB variant UUID.
    // COALESCE merge — enrichment-written gtin/sizes/providerKey are never nulled.
    const variants: any[] = Array.isArray(data.variants) ? data.variants : [];
    let variantsUpserted = 0;
    for (const v of variants) {
      const kickdbVariantId = pickString(v?.id);
      if (!kickdbVariantId) continue;

      const { sizeEu, sizeUs } = pickPersistedKickdbSizes(v);
      const gtinRaw = extractVariantGtin(v);
      const gtin = gtinRaw && validateGtin(gtinRaw) ? gtinRaw : null;
      const ean = pickString(v?.ean);

      await prisma.$executeRaw`
        INSERT INTO "public"."KickDBVariant" (
          "id", "kickdbVariantId", "productId", "sizeUs", "sizeEu", "gtin", "ean",
          "lastFetchedAt", "notFound", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid(), ${kickdbVariantId}, ${productRowId}, ${sizeUs}, ${sizeEu},
          ${gtin}, ${ean}, ${now}, false, ${now}, ${now}
        )
        ON CONFLICT ("kickdbVariantId") DO UPDATE SET
          "productId"     = EXCLUDED."productId",
          "sizeUs"        = COALESCE(EXCLUDED."sizeUs", "KickDBVariant"."sizeUs"),
          "sizeEu"        = COALESCE(EXCLUDED."sizeEu", "KickDBVariant"."sizeEu"),
          "gtin"          = COALESCE(EXCLUDED."gtin", "KickDBVariant"."gtin"),
          "ean"           = COALESCE(EXCLUDED."ean", "KickDBVariant"."ean"),
          "lastFetchedAt" = EXCLUDED."lastFetchedAt",
          "notFound"      = false,
          "updatedAt"     = EXCLUDED."updatedAt"
      `;
      variantsUpserted += 1;
    }

    return NextResponse.json({
      ok: true,
      productId: productRowId,
      kickdbProductId,
      urlKey: digest.urlKey,
      variantsUpserted,
      ms: Date.now() - startedAt,
    });
  } catch (e: any) {
    console.error("[kickdb/upsert] error", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "upsert_failed", ms: Date.now() - startedAt },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "POST /api/kickdb/upsert" });
}
