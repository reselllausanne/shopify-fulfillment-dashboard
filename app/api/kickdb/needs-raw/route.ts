import { NextResponse } from "next/server";
import { checkSharedSecret } from "@/app/api/kickdb/auth";
import { queryKickdbNeedsRaw } from "@/galaxus/kickdb/bufferApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authError = checkSharedSecret(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") ?? 500);

  try {
    const result = await queryKickdbNeedsRaw({ limit });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[kickdb/needs-raw] error", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
