import { NextResponse } from "next/server";
import { checkSharedSecret } from "@/app/api/kickdb/auth";
import { markKickdbProductSynced } from "@/galaxus/kickdb/bufferApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authError = checkSharedSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  try {
    const result = await markKickdbProductSynced(body);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[kickdb/mark-synced] error", e);
    const status = message === "missing_kickdbProductId" ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
