import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { checkSharedSecret } from "@/app/api/kickdb/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/kickdb/flag-candidates?minSales=3&limit=100
 *
 * Sorter for the Shopify create queue. Scans buffered products that are NOT
 * yet tracked in ShopifySyncState (i.e. not on Shopify), sums the per-variant
 * `sales_count_15_days` already present in rawJson (no KicksDB calls), and
 * flags the best sellers as syncStatus='create_candidate' with
 * priorityScore = total recent sales.
 *
 * The consumer (main_from_db.py --status create_candidate) then creates the
 * top-ranked products on Shopify within the daily variant-creation budget.
 */
export async function POST(req: Request) {
  const startedAt = Date.now();

  const authError = checkSharedSecret(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const minSales = Math.min(Math.max(Number(searchParams.get("minSales") ?? 3), 1), 1000);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 100), 1), 2000);

  try {
    const flagged = await prisma.$queryRaw<
      Array<{ kickdbProductId: string; priorityScore: number }>
    >`
      INSERT INTO "public"."ShopifySyncState"
        ("id", "kickdbProductId", "syncStatus", "priorityScore", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), ranked."kickdbProductId", 'create_candidate', ranked.total, NOW(), NOW()
      FROM (
        SELECT p."kickdbProductId", sales.total
        FROM "public"."KickDBProduct" p
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(NULLIF(v->>'sales_count_15_days', '')::int), 0)::int AS total
          FROM jsonb_array_elements(COALESCE(p."rawJson"->'variants', '[]'::jsonb)) v
        ) sales
        WHERE p."rawJson" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "public"."ShopifySyncState" s
            WHERE s."kickdbProductId" = p."kickdbProductId"
          )
          AND sales.total >= ${minSales}
        ORDER BY sales.total DESC
        LIMIT ${limit}
      ) ranked
      ON CONFLICT ("kickdbProductId") DO NOTHING
      RETURNING "kickdbProductId", "priorityScore"
    `;

    return NextResponse.json({
      ok: true,
      flagged: flagged.length,
      top: flagged.slice(0, 10),
      minSales,
      ms: Date.now() - startedAt,
    });
  } catch (e: any) {
    console.error("[kickdb/flag-candidates] error", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "flag_failed", ms: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
