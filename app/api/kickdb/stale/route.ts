import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { checkSharedSecret } from "@/app/api/kickdb/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/kickdb/stale?maxAgeDays=7&limit=3000
 *
 * Catalog products (tracked in ShopifySyncState) whose raw payload is older
 * than maxAgeDays. The sweeper refreshes them from KicksDB by UUID so the
 * long tail can't silently rot (availability decay protection).
 * Oldest first, so repeated runs make progress even with a small limit.
 */
export async function GET(req: Request) {
  const startedAt = Date.now();

  const authError = checkSharedSecret(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const maxAgeDays = Math.min(Math.max(Number(searchParams.get("maxAgeDays") ?? 7), 1), 90);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 3000), 1), 10000);

  try {
    const rows = await prisma.$queryRaw<
      Array<{ kickdbProductId: string; urlKey: string | null; rawFetchedAt: Date | null }>
    >`
      SELECT p."kickdbProductId", p."urlKey", p."rawFetchedAt"
      FROM "public"."ShopifySyncState" s
      INNER JOIN "public"."KickDBProduct" p
        ON p."kickdbProductId" = s."kickdbProductId"
      WHERE p."rawFetchedAt" IS NULL
         OR p."rawFetchedAt" < NOW() - (${maxAgeDays} * INTERVAL '1 day')
      ORDER BY p."rawFetchedAt" ASC NULLS FIRST
      LIMIT ${limit}
    `;

    return NextResponse.json({
      ok: true,
      count: rows.length,
      products: rows,
      ms: Date.now() - startedAt,
    });
  } catch (e: any) {
    console.error("[kickdb/stale] error", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "query_failed", ms: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
