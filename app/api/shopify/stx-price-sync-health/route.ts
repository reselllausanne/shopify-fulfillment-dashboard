import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ErrorRow = { lastError: string | null; count: bigint };

/**
 * Ops metric: stuck Shopify STX price sync rows (ChannelListingState.lastError).
 * Mapping failures need catalog fixes; they retry on a timer but never self-heal.
 */
export async function GET() {
  const grouped = await prisma.$queryRaw<ErrorRow[]>`
    SELECT "lastError", COUNT(*)::bigint AS count
    FROM "public"."ChannelListingState"
    WHERE "channel" = 'SHOPIFY'
      AND "lastError" IS NOT NULL
      AND BTRIM("lastError") <> ''
    GROUP BY "lastError"
    ORDER BY count DESC
    LIMIT 50
  `;

  const mappingPattern = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "public"."ChannelListingState"
    WHERE "channel" = 'SHOPIFY'
      AND (
        "lastError" LIKE 'no_shopify_variant%'
        OR "lastError" LIKE 'ambiguous_%'
        OR "lastError" = 'no_kickdb_handle'
        OR "lastError" = 'no_shopify_variant_by_size'
      )
  `;

  const neverPushed = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "public"."SupplierVariant" sv
    INNER JOIN "public"."ShopifySyncState" sss
      ON sss."kickdbProductId" IN (
        SELECT p."kickdbProductId"
        FROM "public"."VariantMapping" m
        INNER JOIN "public"."KickDBVariant" kv ON kv."id" = m."kickdbVariantId"
        INNER JOIN "public"."KickDBProduct" p ON p."id" = kv."productId"
        WHERE m."supplierVariantId" = sv."supplierVariantId"
      )
    WHERE sv."supplierVariantId" LIKE 'stx_%'
      AND sv."stock" > 0
      AND coalesce(sv."manualLock", false) = false
      AND sss."syncStatus" = 'synced'
      AND sss."shopifyProductId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "public"."ChannelListingState" cls
        WHERE cls."channel" = 'SHOPIFY'
          AND cls."supplierVariantId" = sv."supplierVariantId"
          AND cls."lastPushedPrice" IS NOT NULL
      )
  `;

  const errors = grouped.map((r) => ({
    lastError: r.lastError,
    count: Number(r.count),
  }));

  return NextResponse.json({
    ok: true,
    mappingFailures: Number(mappingPattern[0]?.count ?? 0),
    inStockOnShopifyNeverPushed: Number(neverPushed[0]?.count ?? 0),
    errors,
    hint:
      "Primary path: SSE ingest pushes Shopify only when computed sell ≠ lastPushed. Worker is a capped safety net.",
  });
}
