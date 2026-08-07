"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type TodayResponse = {
  ok: boolean;
  localDate: string;
  metrics: Record<string, unknown> | null;
  sleep: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
  nutrition: Array<Record<string, unknown>>;
  checkin: Record<string, unknown> | null;
  accounts: Array<{
    provider: string;
    status: string;
    lastSyncAt: string | null;
  }>;
  plannedTrainingNote: string;
  disclaimer: string;
};

function SweatTestForm() {
  const [form, setForm] = useState({
    sport: "running",
    durationHours: "1.5",
    weightBeforeKg: "",
    weightAfterKg: "",
    fluidConsumedL: "0.5",
    urineProducedL: "0",
    sweatSodiumMgPerL: "",
  });
  const [result, setResult] = useState<string | null>(null);

  const submit = async () => {
    const res = await fetch("/api/health/hydration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sport: form.sport,
        durationHours: Number(form.durationHours),
        weightBeforeKg: Number(form.weightBeforeKg),
        weightAfterKg: Number(form.weightAfterKg),
        fluidConsumedL: Number(form.fluidConsumedL),
        urineProducedL: Number(form.urineProducedL),
        sweatSodiumMgPerL: form.sweatSodiumMgPerL
          ? Number(form.sweatSodiumMgPerL)
          : null,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setResult(json.error ?? "failed");
      return;
    }
    setResult(
      `Loss ${json.test.sweatLossL.toFixed(2)} L · ${json.test.sweatRateLPerHour.toFixed(2)} L/h (${json.test.formulaVersion})`
    );
  };

  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-zinc-500">
        Sodium concentration is never inferred from sweat volume — enter only if measured.
      </p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["sport", "Sport"],
            ["durationHours", "Hours"],
            ["weightBeforeKg", "Wt before kg"],
            ["weightAfterKg", "Wt after kg"],
            ["fluidConsumedL", "Fluid L"],
            ["urineProducedL", "Urine L"],
            ["sweatSodiumMgPerL", "Na mg/L (opt)"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="text-xs">
            {label}
            <input
              className="ml-1 w-24 rounded border px-1 py-1 dark:border-zinc-600 dark:bg-zinc-900"
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
          </label>
        ))}
        <button
          type="button"
          onClick={() => void submit()}
          className="rounded border px-2 py-1 dark:border-zinc-600"
        >
          Compute & save
        </button>
      </div>
      {result ? <p className="text-xs text-zinc-600 dark:text-zinc-300">{result}</p> : null}
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: unknown; unit?: string }) {
  const display =
    value == null || value === ""
      ? "—"
      : typeof value === "number"
        ? Number.isInteger(value)
          ? String(value)
          : value.toFixed(1)
        : String(value);
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        {display}
        {unit && value != null ? (
          <span className="ml-1 text-sm font-normal text-zinc-500">{unit}</span>
        ) : null}
      </div>
    </div>
  );
}

export default function HealthTodayPage() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weightKg, setWeightKg] = useState("");
  const [fatigue, setFatigue] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/health/metrics/today");
    const json = (await res.json()) as TodayResponse & { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Failed to load");
      return;
    }
    setData(json);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveCheckin = async () => {
    setSaving(true);
    try {
      await fetch("/api/health/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weightKg: weightKg ? Number(weightKg) : undefined,
          fatigue: fatigue ? Number(fatigue) : undefined,
        }),
      });
      setWeightKg("");
      setFatigue("");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const m = data?.metrics;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Health — Today</h1>
          <p className="text-sm text-zinc-500">{data?.localDate ?? "…"}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link className="underline" href="/health/trends">
            Trends
          </Link>
          <Link className="underline" href="/health/sessions">
            Sessions
          </Link>
          <Link className="underline" href="/health/insights">
            Insights
          </Link>
          <Link className="underline" href="/health/ops">
            Ops
          </Link>
        </div>
      </div>

      <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        {data?.disclaimer ??
          "Observations are not medical diagnoses. Consult a professional for health concerns."}
      </p>

      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Sleep" value={m?.sleepMin} unit="min" />
        <Metric label="HRV" value={m?.hrvMs} unit="ms" />
        <Metric label="Resting HR" value={m?.restingHr} unit="bpm" />
        <Metric label="Recovery" value={m?.recoveryScore} />
        <Metric label="Weight" value={m?.weightKg} unit="kg" />
        <Metric label="Calories in" value={m?.caloriesConsumed} unit="kcal" />
        <Metric label="Carbs" value={m?.carbsG} unit="g" />
        <Metric label="Training load" value={m?.trainingLoad} />
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium">Connection</h2>
        <div className="space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
          {(data?.accounts ?? []).length === 0 ? (
            <p>
              No provider connected.{" "}
              <Link className="underline" href="/health/ops">
                Connect WHOOP
              </Link>
            </p>
          ) : (
            data?.accounts.map((a) => (
              <div key={a.provider}>
                {a.provider}: {a.status}
                {a.lastSyncAt ? ` · last sync ${new Date(a.lastSyncAt).toLocaleString()}` : ""}
              </div>
            ))
          )}
          <p className="pt-1 text-xs text-zinc-500">
            WHOOP-first: Ops → Connect WHOOP → Backfill.
          </p>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium">Activities realized</h2>
        {(data?.activities ?? []).length === 0 ? (
          <p className="text-sm text-zinc-500">No activities today.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data!.activities.map((a) => (
              <li
                key={String(a.id)}
                className="rounded border border-zinc-200 px-3 py-2 dark:border-zinc-700"
              >
                <span className="font-medium">{String(a.sport)}</span>
                {a.distanceM != null ? ` · ${(Number(a.distanceM) / 1000).toFixed(1)} km` : ""}
                {a.hrAvg != null ? ` · HR ${Number(a.hrAvg).toFixed(0)}` : ""}
                {a.powerAvg != null ? ` · ${Number(a.powerAvg).toFixed(0)} W` : ""}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-zinc-500">{data?.plannedTrainingNote}</p>
      </section>

      <section className="mb-6 rounded border border-zinc-200 p-4 dark:border-zinc-700">
        <h2 className="mb-3 text-lg font-medium">Sweat test</h2>
        <SweatTestForm />
      </section>

      <section className="mb-6 rounded border border-zinc-200 p-4 dark:border-zinc-700">
        <h2 className="mb-3 text-lg font-medium">Quick check-in</h2>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            Weight (kg)
            <input
              className="ml-2 rounded border px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
              value={weightKg}
              onChange={(e) => setWeightKg(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="text-sm">
            Fatigue 1–10
            <input
              className="ml-2 w-16 rounded border px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
              value={fatigue}
              onChange={(e) => setFatigue(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveCheckin()}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Save
          </button>
        </div>
      </section>
    </div>
  );
}
