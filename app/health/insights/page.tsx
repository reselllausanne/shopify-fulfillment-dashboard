"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Insight = {
  id: string;
  title: string;
  periodFrom: string;
  periodTo: string;
  factualObservation: string;
  hypothesis: string;
  confidence: string;
  limitations: string;
  cautiousAction: string;
  medicalDisclaimer: string;
  feedback: string | null;
  dataUsedJson: unknown;
};

export default function HealthInsightsPage() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [disclaimer, setDisclaimer] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/health/insights");
    const json = await res.json();
    setInsights((json.insights ?? []) as Insight[]);
    setDisclaimer(json.disclaimer ?? "");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setBusy(true);
    try {
      await fetch("/api/health/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const feedback = async (id: string, value: "useful" | "false" | "irrelevant") => {
    await fetch("/api/health/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "feedback", id, feedback: value }),
    });
    await load();
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Health — Insights</h1>
        <div className="flex gap-3 text-sm">
          <button
            type="button"
            disabled={busy}
            onClick={() => void generate()}
            className="rounded bg-zinc-900 px-3 py-1.5 text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Generate
          </button>
          <Link className="underline" href="/health">
            Today
          </Link>
        </div>
      </div>

      <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40">
        {disclaimer ||
          "These observations are explainable heuristics, not medical diagnoses."}
      </p>

      <div className="space-y-4">
        {insights.map((ins) => (
          <article
            key={ins.id}
            className="rounded border border-zinc-200 p-4 dark:border-zinc-700"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-medium">{ins.title}</h2>
              <span className="text-xs uppercase text-zinc-500">{ins.confidence}</span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {String(ins.periodFrom).slice(0, 10)} → {String(ins.periodTo).slice(0, 10)}
            </p>
            <p className="mt-2 text-sm">{ins.factualObservation}</p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              <span className="font-medium">Hypothesis:</span> {ins.hypothesis}
            </p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              <span className="font-medium">Action:</span> {ins.cautiousAction}
            </p>
            <p className="mt-1 text-xs text-zinc-500">Limits: {ins.limitations}</p>
            <p className="mt-2 text-xs italic text-zinc-500">{ins.medicalDisclaimer}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {(["useful", "false", "irrelevant"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => void feedback(ins.id, f)}
                  className={`rounded border px-2 py-1 dark:border-zinc-600 ${
                    ins.feedback === f ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : ""
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </article>
        ))}
        {insights.length === 0 ? (
          <p className="text-sm text-zinc-500">No insights yet. Backfill data, then Generate.</p>
        ) : null}
      </div>
    </div>
  );
}
