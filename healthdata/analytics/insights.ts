import { randomUUID } from "node:crypto";

import { prisma } from "@/app/lib/prisma";
import { computeBaselines, getBaseline } from "@/healthdata/analytics/baselines";

const MEDICAL =
  "This observation is not a medical diagnosis. Consult a qualified professional for health concerns.";

export type InsightDraft = {
  insightKey: string;
  title: string;
  periodFrom: Date;
  periodTo: Date;
  factualObservation: string;
  hypothesis: string;
  confidence: "low" | "medium" | "high";
  dataUsedJson: object;
  limitations: string;
  cautiousAction: string;
  medicalDisclaimer: string;
};

function dateOnly(d: Date): Date {
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function daysAgo(n: number): Date {
  return dateOnly(new Date(Date.now() - n * 86400_000));
}

export async function generateInsights(): Promise<InsightDraft[]> {
  await computeBaselines();
  const to = dateOnly(new Date());
  const from7 = daysAgo(6);
  const drafts: InsightDraft[] = [];

  const last7 = await prisma.healthDailyMetrics.findMany({
    where: { localDate: { gte: from7, lte: to } },
    orderBy: { localDate: "asc" },
  });

  const sleepVals = last7.map((r) => r.sleepMin).filter((v): v is number => v != null);
  const sleepBase = await getBaseline("sleep_min", 42);
  if (sleepVals.length >= 5 && sleepBase?.mean != null) {
    const avg = sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length;
    const deltaMin = avg - sleepBase.mean;
    if (deltaMin <= -40) {
      drafts.push({
        insightKey: "sleep_below_baseline_7d",
        title: "Sleep below personal baseline",
        periodFrom: from7,
        periodTo: to,
        factualObservation: `Over the last 7 days, average sleep is ${Math.round(avg)} min vs your 42-day baseline of ${Math.round(sleepBase.mean)} min (${Math.round(Math.abs(deltaMin))} min lower).`,
        hypothesis:
          "Accumulated sleep debt may reduce recovery quality if the pattern continues.",
        confidence: sleepVals.length >= 7 && (sleepBase.sampleCount ?? 0) >= 28 ? "medium" : "low",
        dataUsedJson: {
          sleepAvg7d: avg,
          baseline42d: sleepBase.mean,
          sampleDays7: sleepVals.length,
          baselineSamples: sleepBase.sampleCount,
        },
        limitations:
          "Single-week averages can reflect travel, illness, or late sessions. Device sleep detection can misclassify.",
        cautiousAction:
          "Consider protecting an earlier bedtime for a few nights and reassess after more data.",
        medicalDisclaimer: MEDICAL,
      });
    }
  }

  const loads = await prisma.healthDailyTrainingLoad.findMany({
    where: { localDate: { gte: from7, lte: to } },
    orderBy: { localDate: "asc" },
  });
  const latestLoad = loads[loads.length - 1];
  const recoveryVals = last7
    .map((r) => r.recoveryScore ?? r.hrvMs)
    .filter((v): v is number => v != null);
  const sleepDown =
    sleepVals.length >= 5 && sleepBase?.mean != null
      ? sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length < sleepBase.mean - 30
      : false;

  if (latestLoad?.ratio != null && latestLoad.ratio > 1.3 && sleepDown) {
    drafts.push({
      insightKey: "load_up_sleep_down",
      title: "Training load rising while sleep dips",
      periodFrom: from7,
      periodTo: to,
      factualObservation: `Acute:chronic load ratio is ${latestLoad.ratio.toFixed(2)} while 7-day sleep sits below the 42-day baseline.`,
      hypothesis:
        "Combined high recent load and reduced sleep may increase fatigue risk; correlation only.",
      confidence: "low",
      dataUsedJson: {
        acuteChronicRatio: latestLoad.ratio,
        acute7d: latestLoad.acute7d,
        chronic28d: latestLoad.chronic28d,
        recoveryPoints: recoveryVals.length,
      },
      limitations:
        "Ratio heuristics are cautious and sport-agnostic. Not a diagnosis of overtraining.",
      cautiousAction:
        "Consider an easier day or prioritizing sleep before stacking another hard session.",
      medicalDisclaimer: MEDICAL,
    });
  }

  const weights = last7.map((r) => r.weightKg).filter((v): v is number => v != null);
  const weightBase = await getBaseline("weight_kg", 7);
  if (weights.length >= 3 && weightBase?.mean != null) {
    const today = weights[weights.length - 1]!;
    const delta = today - weightBase.mean;
    if (Math.abs(delta) >= 0.8 && Math.abs(weightBase.trendSlope ?? 0) < 0.05) {
      drafts.push({
        insightKey: "weight_day_vs_ma7",
        title: "Daily weight moved; 7-day average stable",
        periodFrom: from7,
        periodTo: to,
        factualObservation: `Latest weight ${today.toFixed(1)} kg is ${delta > 0 ? "+" : ""}${delta.toFixed(1)} kg vs 7-day mean ${weightBase.mean.toFixed(1)} kg, while the short trend slope stays near flat.`,
        hypothesis:
          "Short-term swings often reflect glycogen/water rather than tissue change.",
        confidence: "medium",
        dataUsedJson: {
          latest: today,
          ma7: weightBase.mean,
          trendSlope: weightBase.trendSlope,
        },
        limitations: "Scale conditions (clothing, hydration, timing) dominate day-to-day noise.",
        cautiousAction: "Track the 7-day average before changing nutrition aggressively.",
        medicalDisclaimer: MEDICAL,
      });
    }
  }

  // Persist (replace same key for same period_to)
  for (const draft of drafts) {
    const existing = await prisma.healthGeneratedInsight.findFirst({
      where: { insightKey: draft.insightKey, periodTo: draft.periodTo },
    });
    if (existing) {
      await prisma.healthGeneratedInsight.update({
        where: { id: existing.id },
        data: {
          title: draft.title,
          periodFrom: draft.periodFrom,
          factualObservation: draft.factualObservation,
          hypothesis: draft.hypothesis,
          confidence: draft.confidence,
          dataUsedJson: draft.dataUsedJson,
          limitations: draft.limitations,
          cautiousAction: draft.cautiousAction,
          medicalDisclaimer: draft.medicalDisclaimer,
          generatedAt: new Date(),
        },
      });
    } else {
      await prisma.healthGeneratedInsight.create({
        data: {
          id: randomUUID(),
          ...draft,
        },
      });
    }
  }

  return drafts;
}

export async function setInsightFeedback(
  id: string,
  feedback: "useful" | "false" | "irrelevant"
) {
  return prisma.healthGeneratedInsight.update({
    where: { id },
    data: { feedback },
  });
}
