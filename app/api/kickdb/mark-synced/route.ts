import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { checkSharedSecret } from "@/app/api/kickdb/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/kickdb/mark-synced
 *
 * Called by the Shopify consumer after each product push attempt.
 *
 * Body:
 * {
 *   kickdbProductId: "<uuid>",           // required
 *   shopifyProductId?: "gid://...",
 *   shopifyHandle?: "slug",
 *   error?: "message"                     // present => syncStatus='error'
 * }
 *
 * Upserts the ShopifySyncState row (bootstrap also uses this to register the
 * existing catalog).
 *
 * Ghost guard: a success mark without shopifyProductId (and no existing id on
 * the row) is stored as syncStatus='error' / missing_shopify_product_id so
 * /fresh?status=untracked can retry. Never park handle-only "synced" ghosts.
 */
export async function POST(req: Request) {
  const authError = checkSharedSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => ({} as any));
  const kickdbProductId = typeof body?.kickdbProductId === "string" ? body.kickdbProductId.trim() : "";
  if (!kickdbProductId) {
    return NextResponse.json({ ok: false, error: "missing_kickdbProductId" }, { status: 400 });
  }

  const isError = Boolean(body?.error);
  // Permanent skip flag: caller has determined the KickDB payload can never
  // produce a valid Shopify product (e.g. zero images). Parked as
  // 'blocked_no_images' so fresh queries exclude it — no more Shopify API
  // spend on it until a new SSE refresh replaces the raw payload (which resets
  // rawFetchedAt; consumer should re-check and clear the block if fixed).
  const permanent = Boolean(body?.permanent);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const isBlockedNoImages = permanent && reason === "no_images";
  const shopifyProductId =
    typeof body?.shopifyProductId === "string" && body.shopifyProductId.trim()
      ? body.shopifyProductId.trim()
      : null;
  const shopifyHandle = typeof body?.shopifyHandle === "string" ? body.shopifyHandle : null;
  const syncStatus = isBlockedNoImages ? "blocked_no_images" : isError ? "error" : "synced";
  const lastError = isBlockedNoImages
    ? `blocked_no_images: ${reason}`
    : isError
      ? String(body.error).slice(0, 2000)
      : null;
  const now = new Date();

  try {
    // shopifySyncedAt records the last push ATTEMPT (success or error) so a
    // failing product leaves the fresh queue until a new SSE event bumps
    // rawFetchedAt — prevents an infinite retry loop on permanent skips.
    //
    // Success without a product id (new or existing) → force error, not ghost synced.
    // Success omitting product id but row already has one → keep synced + keep id.
    await prisma.$executeRaw`
      INSERT INTO "public"."ShopifySyncState" (
        "id", "kickdbProductId", "shopifyProductId", "shopifyHandle",
        "syncStatus", "shopifySyncedAt", "lastError", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        ${kickdbProductId},
        ${shopifyProductId},
        ${shopifyHandle},
        CASE
          WHEN ${syncStatus} = 'synced' AND ${shopifyProductId}::text IS NULL
          THEN 'error'
          ELSE ${syncStatus}
        END,
        ${now},
        CASE
          WHEN ${syncStatus} = 'synced' AND ${shopifyProductId}::text IS NULL
          THEN 'missing_shopify_product_id'
          ELSE ${lastError}
        END,
        ${now},
        ${now}
      )
      ON CONFLICT ("kickdbProductId") DO UPDATE SET
        "shopifyProductId" = COALESCE(EXCLUDED."shopifyProductId", "ShopifySyncState"."shopifyProductId"),
        "shopifyHandle"    = COALESCE(EXCLUDED."shopifyHandle", "ShopifySyncState"."shopifyHandle"),
        "syncStatus"       = CASE
          WHEN ${syncStatus} = 'synced'
            AND COALESCE(EXCLUDED."shopifyProductId", "ShopifySyncState"."shopifyProductId") IS NULL
          THEN 'error'
          WHEN ${syncStatus} = 'synced'
          THEN 'synced'
          ELSE ${syncStatus}
        END,
        "shopifySyncedAt"  = EXCLUDED."shopifySyncedAt",
        "lastError"        = CASE
          WHEN ${syncStatus} = 'synced'
            AND COALESCE(EXCLUDED."shopifyProductId", "ShopifySyncState"."shopifyProductId") IS NULL
          THEN 'missing_shopify_product_id'
          WHEN ${syncStatus} = 'synced'
          THEN NULL
          ELSE ${lastError}
        END,
        "updatedAt"        = EXCLUDED."updatedAt"
    `;

    return NextResponse.json({ ok: true, kickdbProductId, syncStatus });
  } catch (e: any) {
    console.error("[kickdb/mark-synced] error", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "mark_failed" }, { status: 500 });
  }
}
