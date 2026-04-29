import { NextResponse } from "next/server";
import { runMultiChannelStockSync } from "@/inventory/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseBool(value: unknown, fallback = false): boolean {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dryRun = parseBool(searchParams.get("dryRun"), false);
    const runCatalog = parseBool(searchParams.get("runCatalog"), false);
    const limit = Number(searchParams.get("shopifyCatalogLimit") ?? "1000");
    const origin = new URL(request.url).origin;
    const result = await runMultiChannelStockSync({
      origin,
      dryRun,
      runCatalog,
      shopifyCatalogLimit: limit,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[INVENTORY][SYNC] GET failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Inventory sync failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = parseBool(body?.dryRun, false);
    const runCatalog = parseBool(body?.runCatalog, false);
    const limit = Number(body?.shopifyCatalogLimit ?? 1000);
    const origin = new URL(request.url).origin;
    const result = await runMultiChannelStockSync({
      origin,
      dryRun,
      runCatalog,
      shopifyCatalogLimit: limit,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[INVENTORY][SYNC] POST failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Inventory sync failed" },
      { status: 500 }
    );
  }
}
