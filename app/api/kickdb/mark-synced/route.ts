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
  const syncStatus = isError ? "error" : "synced";
  const shopifyProductId = typeof body?.shopifyProductId === "string" ? body.shopifyProductId : null;
  const shopifyHandle = typeof body?.shopifyHandle === "string" ? body.shopifyHandle : null;
  const lastError = isError ? String(body.error).slice(0, 2000) : null;
  const now = new Date();

  try {
    // shopifySyncedAt records the last push ATTEMPT (success or error) so a
    // failing product leaves the fresh queue until a new SSE event bumps
    // rawFetchedAt — prevents an infinite retry loop on permanent skips.
    await prisma.$executeRaw`
      INSERT INTO "public"."ShopifySyncState" (
        "id", "kickdbProductId", "shopifyProductId", "shopifyHandle",
        "syncStatus", "shopifySyncedAt", "lastError", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(), ${kickdbProductId}, ${shopifyProductId}, ${shopifyHandle},
        ${syncStatus}, ${now}, ${lastError}, ${now}, ${now}
      )
      ON CONFLICT ("kickdbProductId") DO UPDATE SET
        "shopifyProductId" = COALESCE(EXCLUDED."shopifyProductId", "ShopifySyncState"."shopifyProductId"),
        "shopifyHandle"    = COALESCE(EXCLUDED."shopifyHandle", "ShopifySyncState"."shopifyHandle"),
        "syncStatus"       = EXCLUDED."syncStatus",
        "shopifySyncedAt"  = EXCLUDED."shopifySyncedAt",
        "lastError"        = EXCLUDED."lastError",
        "updatedAt"        = EXCLUDED."updatedAt"
    `;

    return NextResponse.json({ ok: true, kickdbProductId, syncStatus });
  } catch (e: any) {
    console.error("[kickdb/mark-synced] error", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "mark_failed" }, { status: 500 });
  }
}
