import { NextResponse } from "next/server";
import { runJob } from "@/galaxus/jobs/jobRunner";
import { runTrmSync } from "@/galaxus/jobs/trmSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const disabled = process.env.GALAXUS_SUPPLIER_SYNC_DISABLED === "1";
    if (disabled) {
      return NextResponse.json(
        { ok: false, error: "Supplier sync disabled", disabled: true },
        { status: 503 }
      );
    }
    const { searchParams } = new URL(request.url);
    const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
    const maxParam = searchParams.get("max");
    const max = maxParam ? Math.max(Number(maxParam) || 0, 0) : null;

    const limit = all
      ? undefined
      : max !== null
        ? Math.min(Math.max(max, 1), 10000)
        : Math.min(Number(searchParams.get("limit") ?? "100"), 2000);
    const offset = all || max !== null ? 0 : Math.max(Number(searchParams.get("offset") ?? "0"), 0);
    const enrichMissingGtin = searchParams.get("enrich") !== "0";

    const trm = await runJob("trm-sync", () =>
      runTrmSync({
        limit,
        offset,
        enrichMissingGtin,
      })
    );

    return NextResponse.json({
      ok: true,
      mode: all ? "all" : "max",
      limit: limit ?? null,
      offset,
      trm,
    });
  } catch (error: any) {
    console.error("[GALAXUS][SUPPLIER][TRM][SYNC] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

