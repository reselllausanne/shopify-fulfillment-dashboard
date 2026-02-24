import { NextResponse } from "next/server";
import { runJob } from "@/galaxus/jobs/jobRunner";
import { runCatalogSync } from "@/galaxus/jobs/catalogSync";
import { runStockPriceSync, runStockSync } from "@/galaxus/jobs/stockSync";
import { runTrmStockSync, runTrmSync } from "@/galaxus/jobs/trmSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
    const includeTrm = searchParams.get("includeTrm") !== "0";
    const mode = (searchParams.get("mode") ?? "full").toLowerCase();
    const maxParam = searchParams.get("max");
    const max = maxParam ? Math.max(Number(maxParam) || 0, 0) : null;

    const limit = all
      ? undefined
      : max !== null
        ? Math.min(Math.max(max, 1), 10000)
        : Math.min(Number(searchParams.get("limit") ?? "50"), 500);
    const offset = all || max !== null ? 0 : Math.max(Number(searchParams.get("offset") ?? "0"), 0);

    const shouldRunCatalog = mode === "full" || mode === "catalog";
    const shouldRunStock = mode === "full" || mode === "stock";

    const [catalog, stock, trm] = await Promise.all([
      shouldRunCatalog ? runJob("catalog-sync", () => runCatalogSync({ limit, offset })) : Promise.resolve(null),
      shouldRunStock
        ? runJob(
            "stock-sync",
            () => (mode === "stock" ? runStockPriceSync({ limit, offset }) : runStockSync({ limit, offset }))
          )
        : Promise.resolve(null),
      includeTrm
        ? runJob("trm-sync", () =>
            mode === "stock"
              ? runTrmStockSync({ limit, offset, enrichMissingGtin: false })
              : runTrmSync({
                  limit,
                  offset,
                  enrichMissingGtin: false,
                })
          )
        : Promise.resolve(null),
    ]);
    return NextResponse.json({
      ok: true,
      mode: all ? "all" : "max",
      syncMode: mode,
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
