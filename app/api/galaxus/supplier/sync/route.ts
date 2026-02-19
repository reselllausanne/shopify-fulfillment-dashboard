import { NextResponse } from "next/server";
import { runJob } from "@/galaxus/jobs/jobRunner";
import { runCatalogSync } from "@/galaxus/jobs/catalogSync";
import { runStockSync } from "@/galaxus/jobs/stockSync";
import { runTrmSync } from "@/galaxus/jobs/trmSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
    const includeTrm = searchParams.get("includeTrm") !== "0";
    const maxParam = searchParams.get("max");
    const max = maxParam ? Math.max(Number(maxParam) || 0, 0) : null;

    const limit = all
      ? undefined
      : max !== null
        ? Math.min(Math.max(max, 1), 10000)
        : Math.min(Number(searchParams.get("limit") ?? "50"), 500);
    const offset = all || max !== null ? 0 : Math.max(Number(searchParams.get("offset") ?? "0"), 0);

    const catalog = await runJob("catalog-sync", () => runCatalogSync({ limit, offset }));
    const stock = await runJob("stock-sync", () => runStockSync({ limit, offset }));
    const trm = includeTrm
      ? await runJob("trm-sync", () =>
          runTrmSync({
            limit,
            offset,
            enrichMissingGtin: true,
          })
        )
      : null;
    return NextResponse.json({
      ok: true,
      mode: all ? "all" : "max",
      limit: limit ?? null,
      offset,
      includeTrm,
      catalog,
      stock,
      trm,
    });
  } catch (error: any) {
    console.error("[GALAXUS][SUPPLIER][SYNC] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
