import { NextRequest, NextResponse } from "next/server";

import { requireHealthAdmin } from "@/app/lib/healthAdminAuth";
import { importMfpDailyRows, parseMfpNutritionCsv } from "@/healthdata/nutrition/mfpCsv";
import { recomputeDailyWindow } from "@/healthdata/repository";

export async function POST(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  const contentType = req.headers.get("content-type") ?? "";
  let csvText = "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "file required" }, { status: 400 });
    }
    csvText = await file.text();
  } else {
    const body = (await req.json().catch(() => ({}))) as { csv?: string };
    csvText = body.csv ?? "";
  }

  if (!csvText.trim()) {
    return NextResponse.json({ ok: false, error: "empty csv" }, { status: 400 });
  }

  try {
    const rows = parseMfpNutritionCsv(csvText);
    const result = await importMfpDailyRows(rows);
    if (rows.length > 0) {
      const dates = rows.map((r) => r.localDate).sort();
      await recomputeDailyWindow(dates[0]!, dates[dates.length - 1]!);
    }
    return NextResponse.json({ ok: true, ...result, parsedRows: rows.length });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "import failed" },
      { status: 400 }
    );
  }
}
