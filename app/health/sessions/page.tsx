"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type ActivityRow = {
  id: string;
  sport: string;
  startAt: string;
  distanceM: number | null;
  hrAvg: number | null;
  powerAvg: number | null;
  rpe: number | null;
  trainingLoad: number | null;
  carbsBeforeG: number;
  similarSessions: Array<Record<string, unknown>>;
};

export default function HealthSessionsPage() {
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [rpeDraft, setRpeDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/health/metrics/sessions?days=28");
    const json = await res.json();
    setActivities((json.activities ?? []) as ActivityRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveRpe = async (id: string) => {
    const rpe = Number(rpeDraft[id]);
    if (!Number.isFinite(rpe)) return;
    await fetch("/api/health/metrics/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, rpe }),
    });
    await load();
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Health — Sessions</h1>
        <Link className="text-sm underline" href="/health">
          Today
        </Link>
      </div>

      <div className="space-y-4">
        {activities.map((a) => (
          <article
            key={a.id}
            className="rounded border border-zinc-200 p-4 dark:border-zinc-700"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium capitalize">{a.sport.replace(/_/g, " ")}</h2>
              <span className="text-xs text-zinc-500">
                {new Date(a.startAt).toLocaleString()}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              {a.distanceM != null ? `${(a.distanceM / 1000).toFixed(1)} km · ` : ""}
              {a.powerAvg != null ? `${a.powerAvg.toFixed(0)} W · ` : ""}
              {a.hrAvg != null ? `HR ${a.hrAvg.toFixed(0)} · ` : ""}
              load {a.trainingLoad ?? "—"} · carbs 1–4h before {a.carbsBeforeG.toFixed(0)} g
            </p>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <label>
                RPE
                <input
                  className="ml-2 w-16 rounded border px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
                  value={rpeDraft[a.id] ?? (a.rpe != null ? String(a.rpe) : "")}
                  onChange={(e) =>
                    setRpeDraft((prev) => ({ ...prev, [a.id]: e.target.value }))
                  }
                />
              </label>
              <button
                type="button"
                className="rounded border px-2 py-1 dark:border-zinc-600"
                onClick={() => void saveRpe(a.id)}
              >
                Save
              </button>
            </div>
            {a.similarSessions.length > 0 ? (
              <div className="mt-2 text-xs text-zinc-500">
                Similar:{" "}
                {a.similarSessions
                  .map(
                    (s) =>
                      `${String(s.startAt).slice(0, 10)} HR ${s.hrAvg ?? "—"} / ${s.powerAvg ?? "—"}W`
                  )
                  .join(" · ")}
              </div>
            ) : null}
          </article>
        ))}
        {activities.length === 0 ? (
          <p className="text-sm text-zinc-500">No sessions. Run mock backfill from Debug.</p>
        ) : null}
      </div>
    </div>
  );
}
