"use client";

import { useEffect, useMemo, useState } from "react";

type Size = { gtin: string; sizeEu: string | null; level: string; nikeModifiedAt: string | null };
type Card = {
  styleColor: string;
  name: string | null;
  imageUrl: string | null;
  lastCheckedAt: string;
  sizes: Size[];
};
type Scan = {
  id: string;
  startedAt: string | null;
  finishedAt: string | null;
  cursor: number;
  total: number;
  found: number;
  errors: number;
};

const LEVEL_CLASS: Record<string, string> = {
  HIGH: "bg-emerald-600 text-white",
  MEDIUM: "bg-sky-600 text-white",
  LOW: "bg-amber-500 text-black",
  OOS: "bg-zinc-700 text-zinc-300",
};

export default function AubonnePage() {
  const [q, setQ] = useState("");
  const [styles, setStyles] = useState<Card[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [inStock, setInStock] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/aubonne/stock?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (stop) return;
        setStyles(data.styles || []);
        setScans(data.scans || []);
        setInStock(data.inStock || 0);
        setError("");
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : "load failed");
      }
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [q]);

  const fresh = useMemo(() => {
    const times = styles.map((s) => s.lastCheckedAt).sort();
    return times.at(-1) || null;
  }, [styles]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <a href="/dashboard" className="text-sm text-zinc-400 hover:text-white">
              Dashboard
            </a>
            <h1 className="text-2xl font-semibold mt-1">Aubonne</h1>
            <p className="text-sm text-zinc-400">
              {inStock} modèles avec au moins une pointure. Niveau Nike, pas un nombre de paires.
              {fresh ? ` Dernier check ${new Date(fresh).toLocaleString("fr-CH")}.` : ""}
            </p>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="style ou nom"
            className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm w-64"
          />
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-zinc-400 mb-4">
          {scans.map((s) => (
            <span key={s.id}>
              {s.id}: {s.finishedAt ? "fait" : "en cours"} {s.cursor}/{s.total} · vus {s.found} · err {s.errors}
            </span>
          ))}
        </div>
        {error ? <p className="text-red-400 mb-4">{error}</p> : null}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {styles.map((card) => (
            <article key={card.styleColor} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex gap-3">
              {card.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.imageUrl} alt="" className="w-20 h-20 object-contain bg-white rounded" />
              ) : (
                <div className="w-20 h-20 bg-zinc-800 rounded" />
              )}
              <div className="min-w-0">
                <div className="font-medium truncate">{card.name || card.styleColor}</div>
                <div className="text-xs text-zinc-400 mb-2">{card.styleColor}</div>
                <div className="flex flex-wrap gap-1">
                  {card.sizes.map((size) => (
                    <span
                      key={size.gtin}
                      className={`text-[11px] px-1.5 py-0.5 rounded ${LEVEL_CLASS[size.level] || "bg-zinc-700"}`}
                      title={size.nikeModifiedAt || ""}
                    >
                      {size.sizeEu || size.gtin.slice(-4)} {size.level}
                    </span>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
