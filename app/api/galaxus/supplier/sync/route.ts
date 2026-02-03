import { NextResponse } from "next/server";
import { runJob } from "@/galaxus/jobs/jobRunner";
import { runCatalogSync } from "@/galaxus/jobs/catalogSync";
import { runStockSync } from "@/galaxus/jobs/stockSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 500);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);

    const catalog = await runJob("catalog-sync", () => runCatalogSync({ limit, offset }));
    const stock = await runJob("stock-sync", () => runStockSync({ limit, offset }));
    return NextResponse.json({ ok: true, limit, offset, catalog, stock });
  } catch (error: any) {
    console.error("[GALAXUS][SUPPLIER][SYNC] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
