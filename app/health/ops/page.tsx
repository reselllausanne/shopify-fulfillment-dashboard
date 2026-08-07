"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type DebugPayload = {
  ok: boolean;
  debug?: {
    accounts: Array<Record<string, unknown>>;
    recentRuns: Array<Record<string, unknown>>;
    counts: Record<string, number>;
    coverage: { minDate: string | null; maxDate: string | null };
  };
  error?: string;
};

export default function HealthDebugPage() {
  const [data, setData] = useState<DebugPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/health/ops");
    setData((await res.json()) as DebugPayload);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connectMock = async () => {
    setBusy("connect");
    setMessage(null);
    try {
      const res = await fetch("/api/health/integrations/mock/connect", { method: "POST" });
      const json = await res.json();
      setMessage(res.ok ? "Mock Garmin connected" : json.error ?? "Connect failed");
      await load();
    } finally {
      setBusy(null);
    }
  };

  const whoopConnected = (data?.debug?.accounts ?? []).some(
    (a) => a.provider === "whoop" && a.status === "connected"
  );

  const runAction = async (
    action: "backfill" | "sync",
    provider = "whoop",
    days?: number
  ) => {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch("/api/health/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          provider,
          // WHOOP day-1: short window. Mock Garmin can still ask for more.
          days:
            days ??
            (provider === "whoop"
              ? action === "backfill"
                ? 7
                : 2
              : action === "backfill"
                ? 90
                : 3),
        }),
      });
      const json = await res.json();
      setMessage(
        res.ok && json.ok
          ? `${provider} ${action} ok`
          : `${provider} ${action} failed (exit ${json.exitCode ?? "?"})`
      );
      await load();
    } finally {
      setBusy(null);
    }
  };

  const d = data?.debug;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Health — Ops</h1>
        <Link className="text-sm underline" href="/health">
          Today
        </Link>
      </div>

      <section className="mb-4 rounded border border-zinc-200 p-4 dark:border-zinc-700">
        <h2 className="mb-2 font-medium">WHOOP (primary)</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Need env: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URI
          (exact match to Developer Dashboard). Then connect → backfill.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/health/integrations/whoop/connect"
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Connect WHOOP
          </a>
          <button
            type="button"
            disabled={!!busy || !whoopConnected}
            onClick={() => void runAction("backfill", "whoop", 7)}
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-600"
          >
            Backfill WHOOP (7d)
          </button>
          <button
            type="button"
            disabled={!!busy || !whoopConnected}
            onClick={() => void runAction("sync", "whoop", 2)}
            className="rounded border px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-600"
          >
            Sync WHOOP
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Status: {whoopConnected ? "connected" : "not connected"}
        </p>
      </section>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void connectMock()}
          className="rounded border px-3 py-1.5 text-sm dark:border-zinc-600"
        >
          Connect mock Garmin
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void runAction("backfill", "mock_garmin")}
          className="rounded border px-3 py-1.5 text-sm dark:border-zinc-600"
        >
          Backfill mock
        </button>
      </div>

      {message ? <p className="mb-3 text-sm text-zinc-700 dark:text-zinc-300">{message}</p> : null}
      {busy ? <p className="mb-3 text-sm text-zinc-500">Running {busy}…</p> : null}

      <section className="mb-6 rounded border border-zinc-200 p-4 dark:border-zinc-700">
        <h2 className="mb-2 font-medium">Import MyFitnessPal CSV</h2>
        <input
          type="file"
          accept=".csv,text/csv"
          className="text-sm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void (async () => {
              setBusy("mfp");
              try {
                const form = new FormData();
                form.append("file", file);
                const res = await fetch("/api/health/nutrition/import", {
                  method: "POST",
                  body: form,
                });
                const json = await res.json();
                setMessage(
                  res.ok
                    ? `MFP import: ${json.upserted} rows`
                    : json.error ?? "MFP import failed"
                );
              } finally {
                setBusy(null);
              }
            })();
          }}
        />
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-medium">Counts</h2>
        <pre className="overflow-auto rounded bg-zinc-100 p-3 text-xs dark:bg-zinc-900">
          {JSON.stringify(d?.counts ?? {}, null, 2)}
        </pre>
        <p className="mt-2 text-sm text-zinc-500">
          Coverage: {d?.coverage?.minDate ?? "—"} → {d?.coverage?.maxDate ?? "—"}
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-medium">Accounts (tokens never shown)</h2>
        <pre className="overflow-auto rounded bg-zinc-100 p-3 text-xs dark:bg-zinc-900">
          {JSON.stringify(d?.accounts ?? [], null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Recent sync runs</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="border-b dark:border-zinc-700">
                <th className="py-1 pr-3">When</th>
                <th className="py-1 pr-3">Provider</th>
                <th className="py-1 pr-3">Command</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Stats</th>
                <th className="py-1">Error</th>
              </tr>
            </thead>
            <tbody>
              {(d?.recentRuns ?? []).map((r) => (
                <tr key={String(r.id)} className="border-b dark:border-zinc-800">
                  <td className="py-1 pr-3 whitespace-nowrap">
                    {r.startedAt ? new Date(String(r.startedAt)).toLocaleString() : "—"}
                  </td>
                  <td className="py-1 pr-3">{String(r.provider)}</td>
                  <td className="py-1 pr-3">{String(r.command)}</td>
                  <td className="py-1 pr-3">{String(r.status)}</td>
                  <td className="py-1 pr-3 font-mono">
                    {JSON.stringify(r.statsJson ?? {})}
                  </td>
                  <td className="py-1 text-red-600">{r.error ? String(r.error) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
