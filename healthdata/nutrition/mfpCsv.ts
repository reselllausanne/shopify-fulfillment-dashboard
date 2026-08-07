import { randomUUID } from "node:crypto";

import { prisma } from "@/app/lib/prisma";

/**
 * MyFitnessPal Premium export (reports/export) produces 3 CSVs:
 * - Nutrition-Summary-*.csv  → ingest (meals → daily totals + meal events)
 * - Measurement-Summary-*.csv → ingest (weight)
 * - Exercise-Summary-*.csv   → skip (WHOOP/Garmin already cover workouts)
 */

export type MfpDailyRow = {
  localDate: string;
  caloriesKcal: number | null;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
};

export type MfpMealRow = MfpDailyRow & {
  mealLabel: string | null;
};

export type MfpWeightRow = {
  localDate: string;
  weightKg: number;
};

function parseNumber(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** RFC-ish CSV split: handles quoted commas. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function headerIndex(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const c of candidates) {
    const i = lower.indexOf(c.toLowerCase());
    if (i >= 0) return i;
  }
  // prefix match (e.g. "Fiber" vs "Fiber (g)")
  for (const c of candidates) {
    const i = lower.findIndex((h) => h === c.toLowerCase() || h.startsWith(`${c.toLowerCase()} `));
    if (i >= 0) return i;
  }
  return -1;
}

function normalizeDate(dateRaw: string): string | null {
  let localDate = dateRaw.trim();
  const mdy = localDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    localDate = `${mdy[3]}-${mdy[1]!.padStart(2, "0")}-${mdy[2]!.padStart(2, "0")}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(localDate) ? localDate : null;
}

function detectMfpKind(headers: string[]): "nutrition" | "measurement" | "exercise" | "unknown" {
  const lower = headers.map((h) => h.trim().toLowerCase());
  if (lower.includes("meal") && lower.some((h) => h.includes("calorie"))) return "nutrition";
  if (lower.includes("weight") && lower.includes("date") && lower.length <= 4) return "measurement";
  if (lower.includes("exercise") || lower.some((h) => h.includes("exercise calories"))) {
    return "exercise";
  }
  if (lower.some((h) => h.includes("calorie")) && lower.includes("date")) return "nutrition";
  return "unknown";
}

export function parseMfpNutritionCsv(csvText: string): {
  meals: MfpMealRow[];
  daily: MfpDailyRow[];
} {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { meals: [], daily: [] };

  const headers = splitCsvLine(lines[0]!);
  const kind = detectMfpKind(headers);
  if (kind === "exercise") {
    throw new Error(
      "This is Exercise-Summary.csv — skip it. WHOOP already covers workouts. Use Nutrition-Summary + Measurement-Summary."
    );
  }
  if (kind === "measurement") {
    throw new Error(
      "This is Measurement-Summary.csv — upload it in the weight slot, or upload both files together."
    );
  }

  const iDate = headerIndex(headers, ["date", "diary date"]);
  const iMeal = headerIndex(headers, ["meal"]);
  const iCal = headerIndex(headers, ["calories", "energy (kcal)", "kcal"]);
  const iCarb = headerIndex(headers, ["carbohydrates (g)", "carbs", "carbohydrates"]);
  const iProt = headerIndex(headers, ["protein (g)", "protein"]);
  const iFat = headerIndex(headers, ["fat (g)", "fat"]);
  const iFiber = headerIndex(headers, ["fiber (g)", "fibre (g)", "fiber", "fibre"]);
  const iSodium = headerIndex(headers, ["sodium (mg)", "sodium"]);

  if (iDate < 0) throw new Error("Nutrition CSV missing Date column");

  const meals: MfpMealRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const localDate = normalizeDate(cols[iDate] ?? "");
    if (!localDate) continue;
    meals.push({
      localDate,
      mealLabel: iMeal >= 0 ? cols[iMeal] || null : null,
      caloriesKcal: iCal >= 0 ? parseNumber(cols[iCal]) : null,
      carbsG: iCarb >= 0 ? parseNumber(cols[iCarb]) : null,
      proteinG: iProt >= 0 ? parseNumber(cols[iProt]) : null,
      fatG: iFat >= 0 ? parseNumber(cols[iFat]) : null,
      fiberG: iFiber >= 0 ? parseNumber(cols[iFiber]) : null,
      sodiumMg: iSodium >= 0 ? parseNumber(cols[iSodium]) : null,
    });
  }

  const byDate = new Map<string, MfpDailyRow>();
  for (const meal of meals) {
    const cur = byDate.get(meal.localDate) ?? {
      localDate: meal.localDate,
      caloriesKcal: 0,
      carbsG: 0,
      proteinG: 0,
      fatG: 0,
      fiberG: 0,
      sodiumMg: 0,
    };
    const add = (a: number | null, b: number | null) => (a ?? 0) + (b ?? 0);
    cur.caloriesKcal = add(cur.caloriesKcal, meal.caloriesKcal);
    cur.carbsG = add(cur.carbsG, meal.carbsG);
    cur.proteinG = add(cur.proteinG, meal.proteinG);
    cur.fatG = add(cur.fatG, meal.fatG);
    cur.fiberG = add(cur.fiberG, meal.fiberG);
    cur.sodiumMg = add(cur.sodiumMg, meal.sodiumMg);
    byDate.set(meal.localDate, cur);
  }

  return {
    meals,
    daily: [...byDate.values()].sort((a, b) => a.localDate.localeCompare(b.localDate)),
  };
}

export function parseMfpMeasurementCsv(csvText: string): MfpWeightRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]!);
  const kind = detectMfpKind(headers);
  if (kind === "nutrition") {
    throw new Error("This looks like Nutrition-Summary.csv — use the nutrition upload slot.");
  }
  if (kind === "exercise") {
    throw new Error("Exercise-Summary.csv is not imported. Skip it.");
  }

  const iDate = headerIndex(headers, ["date"]);
  const iWeight = headerIndex(headers, ["weight", "weight (kg)", "weight kg"]);
  if (iDate < 0 || iWeight < 0) {
    throw new Error("Measurement CSV needs Date + Weight columns");
  }

  const out: MfpWeightRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const localDate = normalizeDate(cols[iDate] ?? "");
    const weightKg = parseNumber(cols[iWeight]);
    if (!localDate || weightKg == null) continue;
    out.push({ localDate, weightKg });
  }
  return out;
}

export async function importMfpDailyRows(rows: MfpDailyRow[]): Promise<{
  importBatchId: string;
  upserted: number;
}> {
  const importBatchId = randomUUID();
  let upserted = 0;
  for (const row of rows) {
    const localDate = new Date(`${row.localDate}T00:00:00.000Z`);
    await prisma.healthNutritionDaily.upsert({
      where: {
        localDate_source: { localDate, source: "mfp_csv" },
      },
      create: {
        id: randomUUID(),
        localDate,
        source: "mfp_csv",
        caloriesKcal: row.caloriesKcal,
        carbsG: row.carbsG,
        proteinG: row.proteinG,
        fatG: row.fatG,
        fiberG: row.fiberG,
        sodiumMg: row.sodiumMg,
        importBatchId,
      },
      update: {
        caloriesKcal: row.caloriesKcal,
        carbsG: row.carbsG,
        proteinG: row.proteinG,
        fatG: row.fatG,
        fiberG: row.fiberG,
        sodiumMg: row.sodiumMg,
        importBatchId,
      },
    });
    upserted += 1;
  }
  return { importBatchId, upserted };
}

export async function importMfpMealEvents(
  meals: MfpMealRow[],
  importBatchId: string
): Promise<number> {
  let written = 0;
  // Replace prior mfp_csv events in overlapping dates for idempotent re-import.
  const dates = [...new Set(meals.map((m) => m.localDate))].sort();
  if (dates.length > 0) {
    await prisma.healthNutritionEvent.deleteMany({
      where: {
        source: "mfp_csv",
        localDate: {
          gte: new Date(`${dates[0]}T00:00:00.000Z`),
          lte: new Date(`${dates[dates.length - 1]}T00:00:00.000Z`),
        },
      },
    });
  }

  for (const meal of meals) {
    await prisma.healthNutritionEvent.create({
      data: {
        id: randomUUID(),
        localDate: new Date(`${meal.localDate}T00:00:00.000Z`),
        mealLabel: meal.mealLabel,
        source: "mfp_csv",
        caloriesKcal: meal.caloriesKcal,
        carbsG: meal.carbsG,
        proteinG: meal.proteinG,
        fatG: meal.fatG,
        fiberG: meal.fiberG,
        sodiumMg: meal.sodiumMg,
        importBatchId,
        timingTag: meal.mealLabel?.toLowerCase() ?? null,
      },
    });
    written += 1;
  }
  return written;
}

export async function importMfpWeights(rows: MfpWeightRow[]): Promise<number> {
  let upserted = 0;
  for (const row of rows) {
    const localDate = new Date(`${row.localDate}T00:00:00.000Z`);
    await prisma.healthBodyMeasurement.upsert({
      where: {
        provider_providerUserId_providerRecordId: {
          provider: "mfp_csv",
          providerUserId: "self",
          providerRecordId: `weight-${row.localDate}`,
        },
      },
      create: {
        id: randomUUID(),
        provider: "mfp_csv",
        providerUserId: "self",
        providerRecordId: `weight-${row.localDate}`,
        measuredAt: new Date(`${row.localDate}T07:00:00.000Z`),
        localDate,
        weightKg: row.weightKg,
        transformVersion: "1",
      },
      update: {
        measuredAt: new Date(`${row.localDate}T07:00:00.000Z`),
        weightKg: row.weightKg,
        syncedAt: new Date(),
      },
    });
    upserted += 1;
  }
  return upserted;
}
