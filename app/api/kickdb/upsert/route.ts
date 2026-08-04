import { NextResponse } from "next/server";
import { checkSharedSecret } from "@/app/api/kickdb/auth";
import { upsertKickdbProductPayload } from "@/galaxus/kickdb/upsertProduct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/kickdb/upsert
 *
 * Thin HTTP wrapper — heavy work runs in worker-kickdb-upsert (:3002) for SSE/cron.
 * This route remains for bootstrap/sweeper callers that still hit web.
 */
export async function POST(req: Request) {
  const authError = checkSharedSecret(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await upsertKickdbProductPayload(body as { data?: unknown; notFound?: boolean });
    if (!result.ok) {
      const status = result.error === "missing_data_or_id" ? 400 : 500;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[kickdb/upsert] error", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "POST /api/kickdb/upsert" });
}
