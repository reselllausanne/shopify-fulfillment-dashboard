import { NextResponse } from "next/server";
import { checkSharedSecret } from "@/app/api/kickdb/auth";
import { queryKickdbStaleProducts } from "@/galaxus/kickdb/bufferApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authError = checkSharedSecret(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const maxAgeDays = Number(searchParams.get("maxAgeDays") ?? 7);
  const limit = Number(searchParams.get("limit") ?? 3000);

  try {
    const result = await queryKickdbStaleProducts({ maxAgeDays, limit });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[kickdb/stale] error", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
