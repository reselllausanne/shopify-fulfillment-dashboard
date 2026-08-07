import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseMfpMeasurementCsv, parseMfpNutritionCsv } from "@/healthdata/nutrition/mfpCsv";

const FIXTURE_DIR = path.join(
  process.env.HOME ?? "",
  "Downloads/File-Export-2026-07-08-to-2026-08-07"
);

describe("MFP export parsers", () => {
  it("aggregates Nutrition-Summary meals into daily totals", () => {
    const csv = readFileSync(
      path.join(FIXTURE_DIR, "Nutrition-Summary-2026-07-08-to-2026-08-07.csv"),
      "utf8"
    );
    const { meals, daily } = parseMfpNutritionCsv(csv);
    expect(meals.length).toBeGreaterThan(10);
    const day = daily.find((d) => d.localDate === "2026-07-13");
    expect(day).toBeTruthy();
    // breakfast+dinner+lunch+snacks from fixture
    expect(day!.caloriesKcal).toBeCloseTo(114 + 809 + 626 + 367.5, 1);
    expect(day!.proteinG).toBeCloseTo(0 + 62.5 + 62.4 + 8.3, 1);
  });

  it("parses Measurement-Summary weights", () => {
    const csv = readFileSync(
      path.join(FIXTURE_DIR, "Measurement-Summary-2026-07-08-to-2026-08-07.csv"),
      "utf8"
    );
    const rows = parseMfpMeasurementCsv(csv);
    expect(rows[0]).toEqual({ localDate: "2026-07-13", weightKg: 79.4 });
    expect(rows.at(-1)?.weightKg).toBe(78);
  });

  it("rejects Exercise-Summary", () => {
    const csv = readFileSync(
      path.join(FIXTURE_DIR, "Exercise-Summary-2026-07-08-to-2026-08-07.csv"),
      "utf8"
    );
    expect(() => parseMfpNutritionCsv(csv)).toThrow(/Exercise-Summary/);
  });
});
