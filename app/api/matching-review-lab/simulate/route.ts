import { NextResponse } from "next/server";
import {
  simulateBatch,
  type LabClientUnit,
  type LabStockxBuy,
} from "@/matching-review-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dry-run matcher simulation — never writes OrderMatch / GalaxusStockxMatch. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const units = (body?.units ?? []) as LabClientUnit[];
    const buys = (body?.buys ?? []) as LabStockxBuy[];
    const consumedBuyNumbers = new Set<string>(
      Array.isArray(body?.consumedBuyNumbers) ? body.consumedBuyNumbers : []
    );
    const consumedBuyOrderIds = new Set<string>(
      Array.isArray(body?.consumedBuyOrderIds) ? body.consumedBuyOrderIds : []
    );
    const enforceAccountSeparation = body?.enforceAccountSeparation !== false;

    if (!Array.isArray(units) || !Array.isArray(buys)) {
      return NextResponse.json(
        { ok: false, error: "units and buys arrays required" },
        { status: 400 }
      );
    }

    const result = simulateBatch(units, buys, {
      consumedBuyNumbers,
      consumedBuyOrderIds,
      enforceAccountSeparation,
      fetchedAt: body?.fetchedAt ?? null,
      fromCache: Boolean(body?.fromCache),
    });

    return NextResponse.json({
      ok: true,
      wroteLiveMatch: false,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
