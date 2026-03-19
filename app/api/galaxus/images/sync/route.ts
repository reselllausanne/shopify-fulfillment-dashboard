import { NextResponse } from "next/server";
import { runImageSync } from "@/galaxus/jobs/imageSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const supplierVariantId = body?.supplierVariantId ? String(body.supplierVariantId) : undefined;
    const limit = body?.limit ? Math.max(1, Number(body.limit)) : 1;
    const result = await runImageSync({
      supplierVariantId,
      limit,
      force: true,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Image sync failed" }, { status: 500 });
  }
}
