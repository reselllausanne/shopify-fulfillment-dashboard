import { NextResponse } from "next/server";
import { generateDecathlonExport } from "@/decathlon/exports/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = searchParams.get("limit");
    const limitParsed = limitRaw ? Number.parseInt(limitRaw, 10) : null;
    const limit = Number.isFinite(limitParsed) ? limitParsed : null;
    const result = await generateDecathlonExport({ limit });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[DECATHLON][EXPORT] Generation failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Decathlon export failed" },
      { status: 500 }
    );
  }
}
