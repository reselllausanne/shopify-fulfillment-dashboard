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

const chfExact = (n: number) =>
  new Intl.NumberFormat("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(n)
    .replace(/\u202f|\u00a0/g, "'");

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

function Big({ value, digits = 0, className = "" }: { value: number; digits?: 0 | 2; className?: string }) {
  const v = useCountUp(value);
  return <span className={`tabular-nums ${className}`}>{(digits === 2 ? chfExact : chf)(v)}</span>;
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

  const shopifyNote =
    feed && feed.shopify.marginPending > 0
      ? `${feed.shopify.marginPending} sans marge`
      : feed && (feed.shopify.marginEstimatedChf ?? 0) > 0
        ? `dont ~${chfExact(feed.shopify.marginEstimatedChf ?? 0)} estimé`
        : undefined;
  const galaxusNote =
    feed && (feed.galaxus.marginEstimatedChf ?? 0) > 0
      ? `dont ~${chfExact(feed.galaxus.marginEstimatedChf ?? 0)} estimé`
      : undefined;

  return (
    <div className="tv-shell fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#05060a] text-white select-none">
      <div className="tv-glow pointer-events-none absolute inset-0" />

      <header className="tv-header relative flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-[1.2vw]">
          <span className="tv-live-dot relative flex shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-full w-full rounded-full bg-emerald-400" />
          </span>
          <span className="tv-kicker truncate font-semibold uppercase text-white/80">
            Resell Lausanne · Live
          </span>
        </div>
        <div className="shrink-0 text-right leading-none">
          <div className="tv-clock font-bold tabular-nums">{clock}</div>
          <div className="tv-date capitalize text-white/50">{date}</div>
        </div>
      </header>

      <main className="tv-main relative min-h-0 flex-1">
        <section className="tv-numbers flex min-h-0 flex-col">
          <div className="tv-card rounded-[2vh] border border-white/10 bg-white/[0.04]">
            <div className="tv-label font-medium uppercase text-white/50">Ventes du jour</div>
            <div className="flex min-w-0 items-baseline gap-[1.2vw] leading-none">
              <Big
                value={feed?.totals.salesChf ?? 0}
                className="tv-hero-num bg-gradient-to-r from-emerald-300 via-white to-fuchsia-300 bg-clip-text font-black text-transparent"
              />
              <span className="tv-unit font-bold text-white/40">CHF</span>
            </div>
            <div className="tv-sub text-white/60">{feed?.totals.orders ?? 0} commandes</div>
          </div>

          <div className="tv-card rounded-[2vh] border border-emerald-400/30 bg-emerald-400/[0.07]">
            <div className="tv-label font-medium uppercase text-emerald-200/70">
              Marge du jour (après pub)
              {feed && (feed.totals.adsSpendChf ?? 0) > 0 && (
                <span className="tv-label-note normal-case tracking-normal text-emerald-200/50">
                  brut {chfExact(feed.totals.marginChf)} − pub {chfExact(feed.totals.adsSpendChf ?? 0)}
                </span>
              )}
            </div>
            <div className="flex min-w-0 items-baseline gap-[1.2vw] leading-none">
              <Big digits={2} value={netMargin} className="tv-margin-num font-black text-emerald-300" />
              <span className="tv-unit-sm font-bold text-emerald-200/50">CHF</span>
              <span className="tv-pct ml-auto font-bold tabular-nums text-emerald-200">
                {totalMarginPct.toFixed(1)}%
              </span>
            </div>
          </div>

          <div className="tv-channels grid min-h-0 flex-1 grid-cols-2">
            <ChannelCard
              name="Shopify"
              accent="from-lime-400/25 to-lime-400/5 border-lime-300/30"
              text="text-lime-300"
              sales={feed?.shopify.salesChf ?? 0}
              margin={feed?.shopify.marginChf ?? 0}
              orders={feed?.shopify.orders ?? 0}
              note={shopifyNote}
            />
            <ChannelCard
              name="Galaxus"
              accent="from-sky-400/25 to-sky-400/5 border-sky-300/30"
              text="text-sky-300"
              sales={feed?.galaxus.salesChf ?? 0}
              margin={feed?.galaxus.marginChf ?? 0}
              orders={feed?.galaxus.orders ?? 0}
              note={galaxusNote}
            />
          </div>
        </section>

        <section className="tv-feed flex min-h-0 flex-col rounded-[2vh] border border-white/10 bg-white/[0.03]">
          <div className="tv-label mb-[0.6em] font-medium uppercase text-white/50">Dernières ventes</div>
          <ul className="tv-feed-list flex min-h-0 flex-1 flex-col overflow-hidden">
            {(feed?.sales ?? []).slice(0, 8).map((s) => (
              <SaleRow key={s.id} sale={s} fresh={freshIds.has(s.id)} now={now} />
            ))}
            {feed && feed.sales.length === 0 && (
              <li className="tv-empty m-auto text-white/40">Pas encore de vente aujourd&apos;hui</li>
            )}
          </ul>
        </section>
      </main>

      {flash && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/70 animate-[tvfade_0.3s_ease-out]">
          <div
            className={`tv-flash flex max-w-[92vw] flex-col items-center text-center shadow-2xl animate-[tvpop_0.5s_cubic-bezier(.2,1.4,.4,1)] ${
              flash.channel === "shopify"
                ? "border-lime-300/60 bg-lime-400/15 shadow-lime-400/30"
                : "border-sky-300/60 bg-sky-400/15 shadow-sky-400/30"
            }`}
          >
            <div className="tv-flash-kicker font-bold uppercase text-white/80">
              Nouvelle vente · {flash.channel === "shopify" ? "Shopify" : "Galaxus"}
            </div>
            <div className="tv-flash-amount font-black leading-none tabular-nums">
              +{chf(flash.salesChf)} <span className="tv-flash-currency text-white/50">CHF</span>
            </div>
            <div className="tv-flash-title text-white/80">
              {flash.title}
              {flash.extraItems > 0 ? ` +${flash.extraItems}` : ""}
            </div>
            {flash.marginChf != null && (
              <div className="tv-flash-margin font-bold text-emerald-300">
                marge {flash.marginEstimated ? "~" : ""}
                {flash.marginChf < 0 ? "" : "+"}
                {chfExact(flash.marginChf)} CHF
              </div>
            )}
          </div>
        </div>
      )}

      {!soundOn && (
        <button
          type="button"
          onClick={enableSound}
          className="tv-sound absolute bottom-[2vh] left-1/2 z-20 -translate-x-1/2 cursor-pointer rounded-full border border-white/20 bg-black/70 text-white/80"
        >
          Cliquer pour activer le son
        </button>
      )}
      {error && (
        <div className="tv-error absolute bottom-[2vh] right-[2vw] z-20 rounded bg-red-500/80">
          {error}
        </div>
      )}

      <style jsx global>{`
        html:has(.tv-shell),
        body:has(.tv-shell) {
          height: 100%;
          overflow: hidden;
        }
        .tv-shell {
          container-type: size;
          container-name: tv;
        }
        .tv-glow {
          background:
            radial-gradient(42cqw 46cqh at 0 0, rgba(16, 185, 129, 0.2), transparent 62%),
            radial-gradient(42cqw 46cqh at 100% 100%, rgba(192, 38, 211, 0.18), transparent 62%);
        }
        .tv-header {
          gap: 1.2vw;
          padding: 2vh 2.2vw 0;
        }
        .tv-live-dot {
          height: 1.6vh;
          width: 1.6vh;
        }
        .tv-kicker {
          font-size: 2.4vh;
          letter-spacing: 0.22em;
        }
        .tv-clock {
          font-size: 5.6vh;
        }
        .tv-date {
          margin-top: 0.4vh;
          font-size: 2vh;
        }
        .tv-main {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
          gap: 1.6vh;
          padding: 1.6vh 2.2vw 2vh;
        }
        .tv-numbers,
        .tv-channels {
          gap: 1.4vh;
        }
        .tv-card,
        .tv-channel,
        .tv-feed {
          padding: 1.6vh 1.4vw;
        }
        .tv-label {
          font-size: 2vh;
          letter-spacing: 0.18em;
        }
        .tv-label-note {
          margin-left: 0.6em;
          font-size: 0.85em;
        }
        .tv-hero-num {
          font-size: 14vh;
          line-height: 0.86;
        }
        .tv-margin-num {
          font-size: 8vh;
          line-height: 0.9;
        }
        .tv-channel-num {
          font-size: 7.2vh;
          line-height: 0.9;
        }
        .tv-unit {
          font-size: 3.4vh;
        }
        .tv-unit-sm,
        .tv-pct {
          font-size: 3vh;
        }
        .tv-sub,
        .tv-channel-meta,
        .tv-empty {
          font-size: 2.2vh;
        }
        .tv-feed-list {
          gap: 0.8vh;
        }
        .tv-sale {
          flex: 0 0 auto;
          gap: 1vw;
          padding: 0.7vh 0.7vw;
        }
        .tv-sale-img {
          height: 6.2vh;
          width: 6.2vh;
        }
        .tv-sale-title {
          font-size: 2.3vh;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .tv-sale-meta,
        .tv-sale-margin {
          font-size: 1.7vh;
        }
        .tv-sale-price {
          font-size: 2.7vh;
        }
        .tv-flash {
          gap: 1.6vh;
          border-width: 2px;
          border-radius: 3vh;
          padding: 4vh 4vw;
        }
        .tv-flash-kicker {
          font-size: 2.6vh;
          letter-spacing: 0.2em;
        }
        .tv-flash-amount {
          font-size: 12vh;
        }
        .tv-flash-currency {
          font-size: 0.38em;
        }
        .tv-flash-title {
          max-width: 78vw;
          font-size: 3.2vh;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .tv-flash-margin {
          font-size: 3.6vh;
        }
        .tv-sound,
        .tv-error {
          padding: 0.8vh 1.2vw;
          font-size: 1.8vh;
        }
        @container tv (max-width: 640px) {
          .tv-main {
            grid-template-columns: 1fr;
            grid-template-rows: auto minmax(0, 1fr);
          }
          .tv-channels {
            grid-template-columns: 1fr 1fr;
          }
        }
        @container tv (min-width: 1100px) and (min-height: 700px) {
          .tv-shell {
            cursor: none;
          }
        }
        @container tv (max-height: 700px) {
          .tv-sale-title {
            -webkit-line-clamp: 1;
          }
        }
        @container tv (max-height: 560px) {
          .tv-kicker,
          .tv-date,
          .tv-sale-img {
            display: none;
          }
          .tv-hero-num {
            font-size: 16vh;
          }
          .tv-margin-num {
            font-size: 10vh;
          }
          .tv-channel-num {
            font-size: 8vh;
          }
        }
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
    <div className={`tv-channel flex min-h-0 min-w-0 flex-col justify-center gap-[1.2vh] overflow-hidden rounded-[2vh] border bg-gradient-to-br ${props.accent}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`tv-channel-meta font-bold uppercase tracking-[0.14em] ${props.text}`}>{props.name}</span>
        <span className="tv-channel-meta text-white/50">{props.orders} cmd</span>
      </div>
      <div className="flex min-w-0 items-baseline gap-[0.6vw] leading-none">
        <Big value={props.sales} className="tv-channel-num font-black" />
        <span className="tv-unit-sm font-bold text-white/40">CHF</span>
      </div>
      <div className="tv-channel-meta text-white/70">
        marge <span className={`font-bold ${props.text}`}>{chfExact(props.margin)} CHF</span>
        {props.note && <span className="ml-[0.6em] text-white/40">({props.note})</span>}
      </div>
    </div>
  );
}

function SaleRow({ sale, fresh, now }: { sale: Sale; fresh: boolean; now: number }) {
  const shop = sale.channel === "shopify";
  return (
    <li
      className={`tv-sale flex items-center overflow-hidden rounded-[1.6vh] border animate-[tvslide_0.6s_ease-out] ${
        fresh ? "border-white/60 bg-white/15" : "border-white/10 bg-white/[0.04]"
      }`}
    >
      <div className="tv-sale-img flex shrink-0 items-center justify-center overflow-hidden rounded-[1.2vh] bg-white/10">
        {sale.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sale.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span>{shop ? "🛍️" : "📦"}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="tv-sale-title font-semibold leading-tight">
          {sale.title}
          {sale.extraItems > 0 && <span className="text-white/50"> +{sale.extraItems}</span>}
        </div>
        <div className="tv-sale-meta flex items-center gap-[0.8vw] text-white/50">
          <span
            className={`rounded px-[0.45em] font-bold uppercase ${
              shop ? "bg-lime-400/20 text-lime-300" : "bg-sky-400/20 text-sky-300"
            }`}
          >
            {shop ? "Shopify" : "Galaxus"}
          </span>
          <span>{timeAgo(sale.at, now)}</span>
        </div>
      </div>
      <div className="shrink-0 text-right leading-tight">
        <div className="tv-sale-price font-black tabular-nums">{chf(sale.salesChf)}</div>
        {sale.marginChf != null && (
          <div className="tv-sale-margin font-semibold tabular-nums text-emerald-300">
            {sale.marginEstimated ? "~" : ""}
            {sale.marginChf < 0 ? "" : "+"}
            {chfExact(sale.marginChf)}
          </div>
        )}
      </div>
    </li>
  );
}
