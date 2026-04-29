import { NextResponse } from "next/server";
import { runInventoryReconciliation } from "@/inventory/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? "3000");
    const result = await runInventoryReconciliation({ limit });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[INVENTORY][RECONCILE] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Inventory reconciliation failed" },
      { status: 500 }
    );
  }
}
