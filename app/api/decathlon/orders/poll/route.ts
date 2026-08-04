import { NextResponse } from "next/server";
import { checkSharedSecret } from "@/app/api/kickdb/auth";
import { runDecathlonOrdersPoll } from "@/decathlon/orders/pollOrders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authError = checkSharedSecret(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const state = String(searchParams.get("state") ?? "").trim();
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "50"), 1), 200);
  const pageParam = searchParams.get("pages") ?? searchParams.get("maxPages") ?? "1000";
  const maxPages = Math.min(Math.max(Number(pageParam), 1), 2000);

  const result = await runDecathlonOrdersPoll({ state, limit, maxPages });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Poll failed" },
      { status: 500 }
    );
  }
  return NextResponse.json(result);
}
