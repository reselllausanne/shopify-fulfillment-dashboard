import { NextResponse } from "next/server";
import { importStxProductByInput } from "@/galaxus/stx/importProduct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = typeof body?.input === "string" ? body.input : "";
    const mode = typeof body?.mode === "string" ? body.mode : "test";

    if (mode !== "test") {
      return NextResponse.json(
        {
          ok: false,
          productSummary: null,
          importedVariantsCount: 0,
          eligibleVariantsCount: 0,
          warnings: [],
          errors: ["Unsupported mode. Use mode=\"test\"."],
        },
        { status: 400 }
      );
    }

    const result = await importStxProductByInput(input);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error: any) {
    console.error("[GALAXUS][STX][IMPORT] Failed:", error);
    return NextResponse.json(
      {
        ok: false,
        productSummary: null,
        importedVariantsCount: 0,
        eligibleVariantsCount: 0,
        warnings: [],
        errors: [error?.message ?? "STX import failed"],
      },
      { status: 500 }
    );
  }
}
