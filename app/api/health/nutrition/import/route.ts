import { NextRequest, NextResponse } from "next/server";

import { requireHealthAdmin } from "@/app/lib/healthAdminAuth";
import {
  importMfpDailyRows,
  importMfpMealEvents,
  importMfpWeights,
  parseMfpMeasurementCsv,
  parseMfpNutritionCsv,
} from "@/healthdata/nutrition/mfpCsv";
import { recomputeDailyWindow } from "@/healthdata/repository";

/**
 * Accepts one or more MFP Premium export CSVs:
 * - Nutrition-Summary-*.csv (required for macros)
 * - Measurement-Summary-*.csv (weight)
 * - Exercise-Summary-*.csv → rejected with clear message (skip; use WHOOP)
 */
export async function POST(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  const contentType = req.headers.get("content-type") ?? "";
  const files: Array<{ name: string; text: string }> = [];

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const all = form.getAll("file");
    for (const entry of all) {
      if (entry instanceof File) {
        files.push({ name: entry.name, text: await entry.text() });
      }
    }
    // Also accept nutrition / measurement named fields
    for (const key of ["nutrition", "measurement", "file"]) {
      const f = form.get(key);
      if (f instanceof File && !files.some((x) => x.name === f.name)) {
        files.push({ name: f.name, text: await f.text() });
      }
    }
  } else {
    const body = (await req.json().catch(() => ({}))) as {
      csv?: string;
      nutritionCsv?: string;
      measurementCsv?: string;
    };
    if (body.nutritionCsv) files.push({ name: "nutrition.csv", text: body.nutritionCsv });
    if (body.measurementCsv) files.push({ name: "measurement.csv", text: body.measurementCsv });
    if (body.csv) files.push({ name: "upload.csv", text: body.csv });
  }

  if (files.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "No file. Upload Nutrition-Summary.csv and optionally Measurement-Summary.csv.",
      },
      { status: 400 }
    );
  }

  try {
    let nutritionDays = 0;
    let mealEvents = 0;
    let weights = 0;
    let importBatchId: string | null = null;
    const minDates: string[] = [];
    const maxDates: string[] = [];
    const skipped: string[] = [];
    const ingested: string[] = [];

    for (const file of files) {
      const lower = file.name.toLowerCase();
      const head = file.text.slice(0, 200).toLowerCase();

      if (lower.includes("exercise") || head.includes("exercise calories")) {
        skipped.push(`${file.name} (Exercise-Summary — skip, use WHOOP)`);
        continue;
      }

      if (lower.includes("measurement") || (head.includes("weight") && !head.includes("meal"))) {
        const rows = parseMfpMeasurementCsv(file.text);
        weights += await importMfpWeights(rows);
        if (rows.length) {
          minDates.push(rows[0]!.localDate);
          maxDates.push(rows[rows.length - 1]!.localDate);
        }
        ingested.push(`${file.name} → ${rows.length} weights`);
        continue;
      }

      // Default: nutrition (meal-level → aggregated daily)
      const { meals, daily } = parseMfpNutritionCsv(file.text);
      const result = await importMfpDailyRows(daily);
      importBatchId = result.importBatchId;
      nutritionDays += result.upserted;
      mealEvents += await importMfpMealEvents(meals, result.importBatchId);
      if (daily.length) {
        minDates.push(daily[0]!.localDate);
        maxDates.push(daily[daily.length - 1]!.localDate);
      }
      ingested.push(
        `${file.name} → ${result.upserted} days (${meals.length} meal rows)`
      );
    }

    if (minDates.length && maxDates.length) {
      const from = [...minDates].sort()[0]!;
      const to = [...maxDates].sort().at(-1)!;
      await recomputeDailyWindow(from, to);
    }

    if (nutritionDays === 0 && weights === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Nothing imported. Need Nutrition-Summary-*.csv (and optionally Measurement-Summary-*.csv). Skip Exercise-Summary.",
          skipped,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      importBatchId,
      nutritionDays,
      mealEvents,
      weights,
      ingested,
      skipped,
      hint: "Use Nutrition-Summary + Measurement-Summary. Skip Exercise-Summary.",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "import failed" },
      { status: 400 }
    );
  }
}
