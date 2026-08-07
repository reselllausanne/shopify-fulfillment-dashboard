import { randomUUID } from "node:crypto";

import { prisma } from "@/app/lib/prisma";

/**
 * Minimal MyFitnessPal Premium nutrition CSV importer.
 * Expects a header row; flexible column names.
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

function parseNumber(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function headerIndex(headers: string[], candidates: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const c of candidates) {
    const i = lower.indexOf(c.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

export function parseMfpNutritionCsv(csvText: string): MfpDailyRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0]!.split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  const iDate = headerIndex(headers, ["date", "diary date"]);
  const iCal = headerIndex(headers, ["calories", "energy (kcal)", "kcal"]);
  const iCarb = headerIndex(headers, ["carbohydrates (g)", "carbs", "carbohydrates"]);
  const iProt = headerIndex(headers, ["protein (g)", "protein"]);
  const iFat = headerIndex(headers, ["fat (g)", "fat"]);
  const iFiber = headerIndex(headers, ["fiber (g)", "fibre (g)", "fiber"]);
  const iSodium = headerIndex(headers, ["sodium (mg)", "sodium"]);

  if (iDate < 0) {
    throw new Error("MFP CSV missing Date column");
  }

  const out: MfpDailyRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    const dateRaw = cols[iDate] ?? "";
    // MFP often YYYY-MM-DD or MM/DD/YYYY
    let localDate = dateRaw;
    const mdy = dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) {
      localDate = `${mdy[3]}-${mdy[1]!.padStart(2, "0")}-${mdy[2]!.padStart(2, "0")}`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) continue;

    out.push({
      localDate,
      caloriesKcal: iCal >= 0 ? parseNumber(cols[iCal]) : null,
      carbsG: iCarb >= 0 ? parseNumber(cols[iCarb]) : null,
      proteinG: iProt >= 0 ? parseNumber(cols[iProt]) : null,
      fatG: iFat >= 0 ? parseNumber(cols[iFat]) : null,
      fiberG: iFiber >= 0 ? parseNumber(cols[iFiber]) : null,
      sodiumMg: iSodium >= 0 ? parseNumber(cols[iSodium]) : null,
    });
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
