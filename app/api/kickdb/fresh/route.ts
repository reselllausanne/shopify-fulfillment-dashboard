import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { checkSharedSecret } from "@/app/api/kickdb/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/kickdb/fresh?limit=50&status=pending
 *
 * Returns products whose raw KicksDB payload is newer than their last Shopify
 * push, ordered by ShopifySyncState.priorityScore (desc) then freshness.
 * The consumer (main_from_db.py) feeds `rawJson` directly into main.py's
 * existing parsing via the `prefetched` parameter — no transformation here.
 *
 * status:
 *   pending           (default) known Shopify products needing an update push
 *   create_candidate  products explicitly flagged for Shopify creation
 *   untracked         KickDBProducts with NO ShopifySyncState row yet (no flag
 *                     step required — consumer creates every product it sees,
 *                     newest KickDB refresh first). mark_synced creates the
 *                     ShopifySyncState row on success, so re-runs won't loop.
 *
 * Response products carry: kickdbProductId, urlKey, shopify state, rawJson.
 */
export async function GET(req: Request) {
  const startedAt = Date.now();

  const authError = checkSharedSecret(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 50), 1), 500);
  const status = (searchParams.get("status") ?? "pending").trim();

  try {
    type Row = {
      kickdbProductId: string;
      urlKey: string | null;
      styleId: string | null;
      name: string | null;
      rawJson: unknown;
      rawFetchedAt: Date | null;
      syncStatus: string;
      shopifyProductId: string | null;
      shopifyHandle: string | null;
      shopifySyncedAt: Date | null;
      priorityScore: number;
    };

    let rows: Row[];

    if (status === "untracked") {
      // Bypass the sync-state / flag step entirely. Includes:
      //   - KickDBProducts with NO ShopifySyncState row (never attempted)
      //   - Previously errored rows (retry after upstream fixes; on success
      //     mark-synced flips syncStatus to 'synced', on failure the same
      //     error row is updated in place — no runaway loops).
      // Freshest SSE refresh first so live-priced products land first.
      rows = await prisma.$queryRaw<Row[]>`
        SELECT
          p."kickdbProductId", p."urlKey", p."styleId", p."name",
          p."rawJson", p."rawFetchedAt",
          COALESCE(s."syncStatus", 'untracked')::text AS "syncStatus",
          s."shopifyProductId",
          s."shopifyHandle",
          s."shopifySyncedAt",
          COALESCE(s."priorityScore", 0)::int AS "priorityScore"
        FROM "public"."KickDBProduct" p
        LEFT JOIN "public"."ShopifySyncState" s
          ON s."kickdbProductId" = p."kickdbProductId"
        WHERE p."rawJson" IS NOT NULL
          AND (s."kickdbProductId" IS NULL OR s."syncStatus" = 'error')
        ORDER BY p."updatedAt" DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await prisma.$queryRaw<Row[]>`
        SELECT
          p."kickdbProductId", p."urlKey", p."styleId", p."name",
          p."rawJson", p."rawFetchedAt",
          s."syncStatus", s."shopifyProductId", s."shopifyHandle",
          s."shopifySyncedAt", s."priorityScore"
        FROM "public"."ShopifySyncState" s
        INNER JOIN "public"."KickDBProduct" p
          ON p."kickdbProductId" = s."kickdbProductId"
        WHERE p."rawJson" IS NOT NULL
          AND (
            CASE
              WHEN ${status} = 'create_candidate' THEN s."syncStatus" = 'create_candidate'
              ELSE s."syncStatus" IN ('pending', 'synced', 'error')
                AND (s."shopifySyncedAt" IS NULL OR p."rawFetchedAt" > s."shopifySyncedAt")
            END
          )
        ORDER BY s."priorityScore" DESC, p."rawFetchedAt" DESC
        LIMIT ${limit}
      `;
    }

    return NextResponse.json({
      ok: true,
      count: rows.length,
      products: rows,
      ms: Date.now() - startedAt,
    });
  } catch (e: any) {
    console.error("[kickdb/fresh] error", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "query_failed", ms: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
