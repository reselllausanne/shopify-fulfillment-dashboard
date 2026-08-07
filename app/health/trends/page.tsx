"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TrendsResponse = {
  ok: boolean;
  daily: Array<Record<string, unknown>>;
  loads: Array<Record<string, unknown>>;
};

export default function HealthTrendsPage() {
  const [data, setData] = useState<TrendsResponse | null>(null);

  useEffect(() => {
    void fetch("/api/health/metrics/trends?days=28")
      .then((r) => r.json())
      .then((j) => setData(j as TrendsResponse));
  }, []);

  const chart = (data?.daily ?? []).map((d) => ({
    date: String(d.localDate).slice(0, 10),
    sleepMin: d.sleepMin ?? null,
    hrvMs: d.hrvMs ?? null,
    restingHr: d.restingHr ?? null,
    weightKg: d.weightKg ?? null,
    caloriesConsumed: d.caloriesConsumed ?? null,
    carbsG: d.carbsG ?? null,
    trainingLoad: d.trainingLoad ?? null,
    rpeAvg: d.rpeAvg ?? null,
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Health — Trends (28d)</h1>
        <Link className="text-sm underline" href="/health">
          Today
        </Link>
      </div>

      {[
        { key: "sleepMin", label: "Sleep (min)", color: "#2563eb" },
        { key: "hrvMs", label: "HRV (ms)", color: "#16a34a" },
        { key: "restingHr", label: "Resting HR", color: "#dc2626" },
        { key: "trainingLoad", label: "Training load", color: "#9333ea" },
        { key: "weightKg", label: "Weight (kg)", color: "#ca8a04" },
        { key: "caloriesConsumed", label: "Calories", color: "#0891b2" },
        { key: "carbsG", label: "Carbs (g)", color: "#ea580c" },
        { key: "rpeAvg", label: "RPE", color: "#4b5563" },
      ].map((series) => (
        <section key={series.key} className="mb-8">
          <h2 className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-300">
            {series.label}
          </h2>
          <div className="h-56 w-full">
            <ResponsiveContainer>
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={40} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey={series.key}
                  name={series.label}
                  stroke={series.color}
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      ))}
    </div>
  );
}
