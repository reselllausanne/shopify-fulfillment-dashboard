"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Sale = {
  id: string;
  channel: "shopify" | "galaxus";
  ref: string;
  title: string;
  extraItems: number;
  imageUrl: string | null;
  salesChf: number;
  marginChf: number | null;
  marginEstimated?: boolean;
  at: string;
};

type Feed = {
  generatedAt: string;
  day: string;
  totals: { salesChf: number; marginChf: number; adsSpendChf?: number; netMarginChf?: number; orders: number };
  shopify: { salesChf: number; marginChf: number; orders: number; marginPending: number; marginEstimatedChf?: number; live: boolean };
  galaxus: { salesChf: number; marginChf: number; marginEstimatedChf?: number; orders: number };
  allIds?: string[];
  sales: Sale[];
};

const POLL_MS = 15_000;

const chf = (n: number) =>
  new Intl.NumberFormat("fr-CH", { maximumFractionDigits: 0 }).format(Math.round(n)).replace(/\u202f|\u00a0/g, "'");

function useCountUp(target: number, durationMs = 1200) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = begin + (target - begin) * eased;
      setValue(v);
      from.current = v;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

let saleBuffer: AudioBuffer | null = null;
let saleBufferLoading = false;

async function loadSaleSound(ctx: AudioContext) {
  if (saleBuffer || saleBufferLoading) return;
  saleBufferLoading = true;
  try {
    const res = await fetch("/tv/sale.mp3");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    saleBuffer = await ctx.decodeAudioData(await res.arrayBuffer());
  } catch {
    saleBuffer = null;
  } finally {
    saleBufferLoading = false;
  }
}

/** Real Shopify sale chime (public/tv/sale.mp3); synth fallback if missing. */
function playCashSound(ctx: AudioContext) {
  if (saleBuffer) {
    const src = ctx.createBufferSource();
    src.buffer = saleBuffer;
    src.connect(ctx.destination);
    src.start();
    return;
  }
  playSynthSound(ctx);
}

function playSynthSound(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  // mechanical click
  const len = Math.floor(ctx.sampleRate * 0.05);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const nf = ctx.createBiquadFilter();
  nf.type = "highpass";
  nf.frequency.value = 1500;
  noise.connect(nf).connect(master);
  noise.start(t0);

  // bell partials, two strikes
  const strike = (at: number, base: number) => {
    [1, 2.01, 3.99, 5.4].forEach((mult, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = base * mult;
      const peak = 0.35 / (i + 1);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 1.4);
      o.connect(g).connect(master);
      o.start(at);
      o.stop(at + 1.5);
    });
  };
  strike(t0 + 0.06, 1318.5);
  strike(t0 + 0.2, 1760);
}

function timeAgo(iso: string, nowMs: number) {
  const s = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return `il y a ${h} h`;
}

function Big({ value, className = "" }: { value: number; className?: string }) {
  const v = useCountUp(value);
  return <span className={`tabular-nums ${className}`}>{chf(v)}</span>;
}

export default function TvPage() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [flash, setFlash] = useState<Sale | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const knownIds = useRef<Set<string> | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const soundOnRef = useRef(false);
  const queue = useRef<Sale[]>([]);
  const flashing = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const enableSound = useCallback(() => {
    if (!audioRef.current) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioRef.current = new Ctor();
    }
    const ctx = audioRef.current;
    void ctx.resume();
    soundOnRef.current = true;
    setSoundOn(true);
    void loadSaleSound(ctx).then(() => playCashSound(ctx));
  }, []);

  // Any click/key anywhere unlocks audio (TV remote / mouse).
  useEffect(() => {
    const h = () => {
      if (!soundOnRef.current) enableSound();
    };
    window.addEventListener("pointerdown", h, { once: true });
    window.addEventListener("keydown", h, { once: true });
    return () => {
      window.removeEventListener("pointerdown", h);
      window.removeEventListener("keydown", h);
    };
  }, [enableSound]);

  const drain = useCallback(() => {
    if (flashing.current) return;
    const next = queue.current.shift();
    if (!next) return;
    flashing.current = true;
    setFlash(next);
    if (soundOnRef.current && audioRef.current) {
      void audioRef.current.resume();
      playCashSound(audioRef.current);
    }
    setTimeout(() => {
      setFlash(null);
      flashing.current = false;
      setTimeout(drain, 400);
    }, 5500);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tv/feed", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login?callbackUrl=/tv";
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Feed;
      setFeed(data);
      setError(null);
      const allIds = data.allIds ?? data.sales.map((s) => s.id);
      if (knownIds.current == null) {
        knownIds.current = new Set(allIds);
        return;
      }
      // New = never seen AND really recent (a cancelled order, a late import or a day change must not ring).
      const seen = knownIds.current;
      const unseen = data.sales.filter((s) => !seen.has(s.id));
      allIds.forEach((id) => seen.add(id));
      const fresh = unseen.filter((s) => Date.now() - new Date(s.at).getTime() < 30 * 60_000);
      if (fresh.length) {
        fresh.forEach((s) => knownIds.current!.add(s.id));
        setFreshIds((prev) => new Set([...prev, ...fresh.map((s) => s.id)]));
        setTimeout(
          () =>
            setFreshIds((prev) => {
              const n = new Set(prev);
              fresh.forEach((s) => n.delete(s.id));
              return n;
            }),
          20_000
        );
        queue.current.push(...fresh.reverse());
        drain();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "erreur");
    }
  }, [drain]);

  useEffect(() => {
    void load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const clock = new Date(now).toLocaleTimeString("fr-CH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Zurich",
  });
  const date = new Date(now).toLocaleDateString("fr-CH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Zurich",
  });

  const netMargin = feed?.totals.netMarginChf ?? feed?.totals.marginChf ?? 0;
  const totalMarginPct = feed && feed.totals.salesChf > 0 ? (netMargin / feed.totals.salesChf) * 100 : 0;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#05060a] text-white select-none cursor-none">
      {/* ambient glow */}
      <div className="pointer-events-none absolute -left-[10vw] -top-[20vh] h-[70vh] w-[50vw] rounded-full bg-emerald-500/20 blur-[140px]" />
      <div className="pointer-events-none absolute -right-[10vw] -bottom-[20vh] h-[70vh] w-[50vw] rounded-full bg-fuchsia-600/20 blur-[140px]" />

      {/* header */}
      <header className="relative flex items-center justify-between px-[3vw] pt-[2.5vh]">
        <div className="flex items-center gap-[1.2vw]">
          <span className="relative flex h-[2.2vh] w-[2.2vh]">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-full w-full rounded-full bg-emerald-400" />
          </span>
          <span className="text-[3vh] font-semibold uppercase tracking-[0.35em] text-white/80">
            Resell Lausanne · Live
          </span>
        </div>
        <div className="text-right leading-none">
          <div className="text-[6vh] font-bold tabular-nums">{clock}</div>
          <div className="mt-[0.5vh] text-[2.2vh] capitalize text-white/50">{date}</div>
        </div>
      </header>

      {/* body */}
      <main className="relative grid min-h-0 flex-1 grid-cols-[1.35fr_1fr] gap-[2vw] px-[3vw] py-[2.5vh]">
        {/* left: numbers */}
        <section className="flex min-h-0 flex-col gap-[2vh]">
          <div className="rounded-[2vh] border border-white/10 bg-white/[0.04] px-[2.5vw] py-[2.5vh] backdrop-blur">
            <div className="text-[2.6vh] font-medium uppercase tracking-[0.3em] text-white/50">
              Ventes du jour
            </div>
            <div className="flex items-baseline gap-[1.2vw] leading-none">
              <Big
                value={feed?.totals.salesChf ?? 0}
                className="bg-gradient-to-r from-emerald-300 via-white to-fuchsia-300 bg-clip-text text-[19vh] font-black text-transparent"
              />
              <span className="text-[5vh] font-bold text-white/40">CHF</span>
            </div>
            <div className="mt-[1vh] text-[2.6vh] text-white/60">
              {feed?.totals.orders ?? 0} commandes
            </div>
          </div>

          <div className="rounded-[2vh] border border-emerald-400/30 bg-emerald-400/[0.07] px-[2.5vw] py-[2vh]">
            <div className="text-[2.6vh] font-medium uppercase tracking-[0.3em] text-emerald-200/70">
              Marge du jour (après pub)
              {feed && (feed.totals.adsSpendChf ?? 0) > 0 && (
                <span className="ml-[1vw] text-[2.2vh] normal-case tracking-normal text-emerald-200/50">
                  brut {chf(feed.totals.marginChf)} − pub {chf(feed.totals.adsSpendChf ?? 0)}
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-[1.2vw] leading-none">
              <Big value={netMargin} className="text-[11vh] font-black text-emerald-300" />
              <span className="text-[3.5vh] font-bold text-emerald-200/50">CHF</span>
              <span className="ml-auto text-[5vh] font-bold tabular-nums text-emerald-200">
                {totalMarginPct.toFixed(1)}%
              </span>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-2 gap-[2vw]">
            <ChannelCard
              name="Shopify"
              accent="from-lime-400/25 to-lime-400/5 border-lime-300/30"
              text="text-lime-300"
              sales={feed?.shopify.salesChf ?? 0}
              margin={feed?.shopify.marginChf ?? 0}
              orders={feed?.shopify.orders ?? 0}
              note={
                feed && feed.shopify.marginPending > 0
                  ? `${feed.shopify.marginPending} sans marge`
                  : undefined
              }
            />
            <ChannelCard
              name="Galaxus"
              accent="from-sky-400/25 to-sky-400/5 border-sky-300/30"
              text="text-sky-300"
              sales={feed?.galaxus.salesChf ?? 0}
              margin={feed?.galaxus.marginChf ?? 0}
              orders={feed?.galaxus.orders ?? 0}
            />
          </div>
        </section>

        {/* right: feed */}
        <section className="flex min-h-0 flex-col rounded-[2vh] border border-white/10 bg-white/[0.03] px-[1.6vw] py-[2vh]">
          <div className="mb-[1.5vh] text-[2.6vh] font-medium uppercase tracking-[0.3em] text-white/50">
            Dernières ventes
          </div>
          <ul className="flex min-h-0 flex-1 flex-col gap-[1.2vh] overflow-hidden">
            {(feed?.sales ?? []).slice(0, 8).map((s) => (
              <SaleRow key={s.id} sale={s} fresh={freshIds.has(s.id)} now={now} />
            ))}
            {feed && feed.sales.length === 0 && (
              <li className="m-auto text-[3vh] text-white/40">Pas encore de vente aujourd&apos;hui</li>
            )}
          </ul>
        </section>
      </main>

      {/* new sale overlay */}
      {flash && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/55 backdrop-blur-sm animate-[tvfade_0.3s_ease-out]">
          <div
            className={`flex max-w-[80vw] flex-col items-center gap-[2vh] rounded-[4vh] border-2 px-[5vw] py-[5vh] text-center shadow-2xl animate-[tvpop_0.5s_cubic-bezier(.2,1.4,.4,1)] ${
              flash.channel === "shopify"
                ? "border-lime-300/60 bg-lime-400/15 shadow-lime-400/30"
                : "border-sky-300/60 bg-sky-400/15 shadow-sky-400/30"
            }`}
          >
            <div className="text-[4vh] font-bold uppercase tracking-[0.4em] text-white/80">
              Nouvelle vente · {flash.channel === "shopify" ? "Shopify" : "Galaxus"}
            </div>
            <div className="text-[18vh] font-black leading-none tabular-nums">
              +{chf(flash.salesChf)} <span className="text-[6vh] text-white/50">CHF</span>
            </div>
            <div className="max-w-[70vw] truncate text-[4vh] text-white/80">
              {flash.title}
              {flash.extraItems > 0 ? ` +${flash.extraItems}` : ""}
            </div>
            {flash.marginChf != null && (
              <div className="text-[4.5vh] font-bold text-emerald-300">
                marge {flash.marginEstimated ? "~" : ""}{flash.marginChf < 0 ? "" : "+"}{chf(flash.marginChf)} CHF
              </div>
            )}
          </div>
        </div>
      )}

      {!soundOn && (
        <button
          type="button"
          onClick={enableSound}
          className="absolute bottom-[2vh] left-1/2 z-20 -translate-x-1/2 cursor-pointer rounded-full border border-white/20 bg-black/70 px-[2vw] py-[1vh] text-[2vh] text-white/80"
        >
          🔈 Cliquer pour activer le son
        </button>
      )}
      {error && (
        <div className="absolute bottom-[2vh] right-[2vw] z-20 rounded bg-red-500/80 px-3 py-1 text-[1.8vh]">
          {error}
        </div>
      )}

      <style jsx global>{`
        @keyframes tvfade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes tvpop {
          from {
            transform: scale(0.6);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes tvslide {
          from {
            transform: translateX(6vw);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

function ChannelCard(props: {
  name: string;
  accent: string;
  text: string;
  sales: number;
  margin: number;
  orders: number;
  note?: string;
}) {
  return (
    <div className={`flex min-h-0 flex-col justify-between rounded-[2vh] border bg-gradient-to-br px-[1.8vw] py-[2vh] ${props.accent}`}>
      <div className="flex items-center justify-between">
        <span className={`text-[3.4vh] font-bold uppercase tracking-[0.25em] ${props.text}`}>{props.name}</span>
        <span className="text-[2.4vh] text-white/50">{props.orders} cmd</span>
      </div>
      <div className="flex items-baseline gap-[0.6vw] leading-none">
        <Big value={props.sales} className="text-[9vh] font-black" />
        <span className="text-[2.6vh] font-bold text-white/40">CHF</span>
      </div>
      <div className="text-[3vh] text-white/70">
        marge <span className={`font-bold ${props.text}`}>{chf(props.margin)} CHF</span>
        {props.note && <span className="ml-[0.8vw] text-[2vh] text-white/40">({props.note})</span>}
      </div>
    </div>
  );
}

function SaleRow({ sale, fresh, now }: { sale: Sale; fresh: boolean; now: number }) {
  const shop = sale.channel === "shopify";
  return (
    <li
      className={`flex items-center gap-[1.2vw] rounded-[1.6vh] border px-[1vw] py-[1.1vh] animate-[tvslide_0.6s_ease-out] ${
        fresh ? "border-white/60 bg-white/15" : "border-white/10 bg-white/[0.04]"
      }`}
    >
      <div className="flex h-[8vh] w-[8vh] shrink-0 items-center justify-center overflow-hidden rounded-[1.2vh] bg-white/10">
        {sale.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sale.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[3.5vh]">{shop ? "🛍️" : "📦"}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[2.6vh] font-semibold">
          {sale.title}
          {sale.extraItems > 0 && <span className="text-white/50"> +{sale.extraItems}</span>}
        </div>
        <div className="flex items-center gap-[0.8vw] text-[2vh] text-white/50">
          <span
            className={`rounded px-[0.6vw] py-[0.1vh] text-[1.8vh] font-bold uppercase ${
              shop ? "bg-lime-400/20 text-lime-300" : "bg-sky-400/20 text-sky-300"
            }`}
          >
            {shop ? "Shopify" : "Galaxus"}
          </span>
          <span>{timeAgo(sale.at, now)}</span>
        </div>
      </div>
      <div className="text-right leading-tight">
        <div className="text-[3.2vh] font-black tabular-nums">{chf(sale.salesChf)}</div>
        {sale.marginChf != null && (
          <div className="text-[2vh] font-semibold tabular-nums text-emerald-300">
            {sale.marginEstimated ? "~" : ""}{sale.marginChf < 0 ? "" : "+"}{chf(sale.marginChf)}
          </div>
        )}
      </div>
    </li>
  );
}
