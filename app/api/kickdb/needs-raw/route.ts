import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { checkSharedSecret } from "@/app/api/kickdb/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/kickdb/needs-raw?limit=500
 *
 * Marketplace-only products that never got a full raw payload:
 *   - `rawJson IS NULL` (never buffered), and
 *   - no ShopifySyncState row (not part of the Shopify catalog bootstrap).
 *
 * These are products added by the Galaxus enrichment path (often express-only
 * sales) that were never listed on Shopify. The marketplace backfill job walks
 * this list, fetches the full KicksDB payload by UUID, and POSTs it to
 * /api/kickdb/upsert so the buffer becomes the single source of truth for every
 * channel and the create-queue sorter can rank them by recent sales.
 *
 * Oldest-touched first so repeated runs keep making progress under a small limit.
 */
export async function GET(req: Request) {
  const startedAt = Date.now();

  const authError = checkSharedSecret(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 500), 1), 5000);

  try {
    const rows = await prisma.$queryRaw<
      Array<{ kickdbProductId: string; urlKey: string | null; styleId: string | null }>
    >`
      SELECT p."kickdbProductId", p."urlKey", p."styleId"
      FROM "public"."KickDBProduct" p
      LEFT JOIN "public"."ShopifySyncState" s
        ON s."kickdbProductId" = p."kickdbProductId"
      WHERE p."rawJson" IS NULL
        AND s."kickdbProductId" IS NULL
        AND p."notFound" = false
      ORDER BY p."lastFetchedAt" ASC NULLS FIRST
      LIMIT ${limit}
    `;

    return NextResponse.json({
      ok: true,
      count: rows.length,
      products: rows,
      ms: Date.now() - startedAt,
    });
  } catch (e: any) {
    console.error("[kickdb/needs-raw] error", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "query_failed", ms: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
