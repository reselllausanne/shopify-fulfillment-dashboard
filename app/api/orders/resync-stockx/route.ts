import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Resync disabled",
      details: "StockX resync is disabled; use enriched data from matching flow.",
    },
    { status: 410 }
  );
}
