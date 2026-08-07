import { randomUUID } from "node:crypto";

import { prisma } from "@/app/lib/prisma";

export type BaselineMetricKey =
  | "sleep_min"
  | "hrv_ms"
  | "resting_hr"
  | "recovery_score"
  | "weight_kg"
  | "calories_consumed"
  | "carbs_g"
  | "training_load"
  | "rpe_avg";

const WINDOWS = [7, 28, 42] as const;

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const v = values.reduce((acc, x) => acc + (x - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

/** Simple least-squares slope vs day index. */
function trendSlope(values: number[]): number | null {
  if (values.length < 3) return null;
  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i]!;
    sumXY += i * values[i]!;
    sumXX += i * i;
  }
  const den = n * sumXX - sumX * sumX;
  if (den === 0) return null;
  return (n * sumXY - sumX * sumY) / den;
}

const METRIC_FIELD: Record<BaselineMetricKey, string> = {
  sleep_min: "sleepMin",
  hrv_ms: "hrvMs",
  resting_hr: "restingHr",
  recovery_score: "recoveryScore",
  weight_kg: "weightKg",
  calories_consumed: "caloriesConsumed",
  carbs_g: "carbsG",
  training_load: "trainingLoad",
  rpe_avg: "rpeAvg",
};

function pick(metric: BaselineMetricKey, row: Record<string, unknown>): number | null {
  const v = row[METRIC_FIELD[metric]];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function computeBaselines(asOf: Date = new Date()): Promise<number> {
  const asOfDate = new Date(`${asOf.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const lookbackStart = new Date(asOfDate.getTime() - 42 * 86400_000);

  const rows = await prisma.healthDailyMetrics.findMany({
    where: { localDate: { gte: lookbackStart, lte: asOfDate } },
    orderBy: { localDate: "asc" },
  });

  const metrics: BaselineMetricKey[] = [
    "sleep_min",
    "hrv_ms",
    "resting_hr",
    "recovery_score",
    "weight_kg",
    "calories_consumed",
    "carbs_g",
    "training_load",
    "rpe_avg",
  ];

  let written = 0;
  for (const metricKey of metrics) {
    const series = rows
      .map((r) => pick(metricKey, r as unknown as Record<string, unknown>))
      .filter((v): v is number => v != null);

    for (const windowDays of WINDOWS) {
      const windowSeries = series.slice(-windowDays);
      if (windowSeries.length < Math.min(3, windowDays)) continue;

      await prisma.healthPersonalBaseline.upsert({
        where: {
          metricKey_windowDays_asOfDate: {
            metricKey,
            windowDays,
            asOfDate,
          },
        },
        create: {
          id: randomUUID(),
          metricKey,
          windowDays,
          asOfDate,
          sampleCount: windowSeries.length,
          mean: mean(windowSeries),
          median: median(windowSeries),
          stddev: stddev(windowSeries),
          trendSlope: trendSlope(windowSeries),
        },
        update: {
          sampleCount: windowSeries.length,
          mean: mean(windowSeries),
          median: median(windowSeries),
          stddev: stddev(windowSeries),
          trendSlope: trendSlope(windowSeries),
          computedAt: new Date(),
        },
      });
      written += 1;
    }
  }

  return written;
}

export async function getBaseline(
  metricKey: BaselineMetricKey,
  windowDays: number,
  asOf: Date = new Date()
) {
  const asOfDate = new Date(`${asOf.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return prisma.healthPersonalBaseline.findUnique({
    where: {
      metricKey_windowDays_asOfDate: { metricKey, windowDays, asOfDate },
    },
  });
}
