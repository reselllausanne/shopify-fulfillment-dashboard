"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Overview } from "@/lib/warehouse/overview";
import type { ScanResolution } from "@/lib/warehouse/units";
import { errorMessage, isWhError, whGet } from "../_lib/api";
import { useWarehouse } from "../_lib/context";
import { useLoad, useOnline, useStockChanged } from "../_lib/hooks";
import PrintAgent from "./PrintAgent";
import { cleanScan } from "./scan";
import { Btn, Loading, cx } from "./ui";

type NavEntry = { href: string; label: string; short: string; icon: ReactNode };

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export const WAREHOUSE_NAV: NavEntry[] = [
  { href: "/warehouse", label: "Vue d'ensemble", short: "Vue d'ensemble", icon: icon("M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z") },
  { href: "/warehouse/receiving", label: "Réception et reprise", short: "Réception", icon: icon("M3 8l9-5 9 5v8l-9 5-9-5V8Zm9 5 9-5M12 13v8M12 13 3 8") },
  { href: "/warehouse/putaway", label: "Rangement", short: "Rangement", icon: icon("M4 5h16M4 12h16M4 19h16M8 5v14M16 5v14") },
  { href: "/warehouse/stock", label: "Stock", short: "Stock", icon: icon("M3 17c3 0 5-1 7-4l2 1.5c1.5 1 3 1.5 5 1.5h2a2 2 0 0 1 2 2v1H3v-2Zm7-4-1-3") },
  { href: "/warehouse/locations", label: "Emplacements", short: "Emplacements", icon: icon("M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z") },
  { href: "/warehouse/exceptions", label: "Écarts et contrôles", short: "Écarts", icon: icon("M12 9v4m0 4h.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z") },
  { href: "/warehouse/stations", label: "Postes et imprimantes", short: "Postes", icon: icon("M7 8V4h10v4M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v6H7v-6Z") },
  { href: "/warehouse/partners", label: "Partenaires et tarifs", short: "Partenaires", icon: icon("M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm10 8.5v-1.5a3.5 3.5 0 0 0-2.6-3.4M15 3.6a3.5 3.5 0 0 1 0 6.8") },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/warehouse") return pathname === "/warehouse";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function GlobalScan() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const go = async () => {
    const code = cleanScan(value);
    if (!code || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await whGet<ScanResolution>("scan", { code });
      if (res.kind === "UNIT") {
        setValue("");
        router.push(`/warehouse/stock/${res.unit.id}`);
      } else if (res.kind === "LOCATION") {
        setValue("");
        router.push(`/warehouse/locations?level=${encodeURIComponent(res.location.id)}`);
      } else if (res.kind === "GTIN") {
        setValue("");
        router.push(`/warehouse/stock?search=${encodeURIComponent(res.resolution.gtin)}`);
      } else if (res.kind === "EXTERNAL_REF_AMBIGUOUS") {
        setNote(res.hint);
      } else if (res.kind === "UNKNOWN" || res.kind === "EXTERNAL_REF_UNKNOWN") {
        // Not a code: use it as a free-text search in the stock.
        setValue("");
        router.push(`/warehouse/stock?search=${encodeURIComponent(code)}`);
      } else if (res.kind !== "EMPTY") {
        setNote(res.hint);
      }
    } catch (err) {
      setNote(isWhError(err) && err.fateUnknown ? "Connexion perdue." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
      className="relative w-full max-w-xs"
    >
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" d="M4 7V5h3M4 17v2h3M20 7V5h-3M20 17v2h-3M8 8v8M12 8v8M16 8v8" />
      </svg>
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setNote(null);
        }}
        placeholder={busy ? "Recherche…" : "Scanner ou chercher une paire, un niveau"}
        aria-label="Scanner ou chercher"
        autoComplete="off"
        spellCheck={false}
        className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#02C73A] focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      />
      {note ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {note}
        </div>
      ) : null}
    </form>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/warehouse";
  const wh = useWarehouse();
  const online = useOnline();
  const siteCode = wh.site?.code ?? null;

  const overview = useLoad<Overview>(() => whGet<Overview>("overview", { site: siteCode }, { silent: true }), [siteCode], {
    enabled: wh.status === "ready" && Boolean(siteCode),
    intervalMs: 60_000,
  });
  // A recorded gesture refreshes the side counters (to put away, discrepancies, alerts) without
  // waiting for the minute poll — at most once every ten seconds, so fast scanning stays cheap.
  const refreshTimer = useRef<number | null>(null);
  const lastRefresh = useRef(0);
  useStockChanged(() => {
    if (refreshTimer.current !== null) return;
    const wait = Math.max(1_500, 10_000 - (Date.now() - lastRefresh.current));
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      lastRefresh.current = Date.now();
      void overview.reload();
    }, wait);
  });
  useEffect(
    () => () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    },
    []
  );
  const alertCount = overview.data?.alerts.length ?? 0;
  const critical = overview.data?.alerts.some((a) => a.level === "critical") ?? false;

  if (wh.status === "loading") {
    return (
      <main className="mx-auto max-w-[1600px] px-4 py-10">
        <Loading label="Chargement du module Entrepôt…" />
      </main>
    );
  }
  if (wh.status === "disabled") {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-10 dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Module désactivé</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Le module Entrepôt n'est pas activé sur cet environnement. Aucune donnée n'est modifiée.
          </p>
        </div>
      </main>
    );
  }
  if (wh.status === "error") {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <div className="rounded-lg border border-red-200 bg-white px-6 py-10 dark:border-red-900 dark:bg-slate-900">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Module Entrepôt indisponible</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {isWhError(wh.error) && wh.error.fateUnknown ? "Connexion au serveur impossible." : errorMessage(wh.error)}
          </p>
          <div className="mt-4 flex justify-center">
            <Btn onClick={() => void wh.reloadConfig()}>Réessayer</Btn>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#F5F6F7] dark:bg-slate-950">
      {/* Context bar */}
      <div className="sticky top-14 z-40 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-4 py-2">
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="hidden sm:inline">Site</span>
            <select
              value={wh.siteId ?? ""}
              onChange={(e) => wh.setSiteId(e.target.value)}
              aria-label="Site"
              className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            >
              {wh.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                  {s.isTest ? " (test)" : ""}
                </option>
              ))}
            </select>
          </label>
          {wh.site?.isTest ? (
            <span className="rounded-md border border-[#FBEBC8] bg-[#FEF9E9] px-2 py-1 text-xs font-medium text-[#8A5A00] dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              Site de test
            </span>
          ) : null}

          <div className="order-last w-full sm:order-none sm:w-auto sm:flex-1">
            <GlobalScan />
          </div>

          <Link
            href="/warehouse"
            className={cx(
              "inline-flex min-h-[36px] items-center gap-2 rounded-lg border px-3 text-xs font-medium",
              alertCount === 0
                ? "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                : critical
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
                  : "border-[#FBEBC8] bg-[#FEF9E9] text-[#8A5A00] dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
            )}
            title="Alertes du site"
          >
            <span className="tabular-nums">{alertCount}</span> {alertCount > 1 ? "alertes" : "alerte"}
          </Link>

          <PrintAgent />

          <Link
            href="/warehouse/stations"
            className={cx(
              "inline-flex min-h-[36px] items-center gap-2 rounded-lg border px-3 text-xs font-medium",
              wh.station && wh.stationValid
                ? "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                : "border-[#FBEBC8] bg-[#FEF9E9] text-[#8A5A00] dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
            )}
            title={wh.station ? `Poste ${wh.station.name}` : "Sans poste appairé, les étiquettes ne partent pas à l'imprimante : le PDF reste disponible."}
          >
            {wh.station ? (wh.stationValid ? `Poste ${wh.station.code}` : `Poste ${wh.station.code} : appairage révoqué`) : "Poste non appairé"}
          </Link>

          <button
            type="button"
            onClick={() => void wh.identifyOperator()}
            className={cx(
              "inline-flex min-h-[36px] items-center gap-2 rounded-lg border px-3 text-xs font-medium",
              wh.operator
                ? "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                : wh.operators.length > 0
                  ? "border-[#FBEBC8] bg-[#FEF9E9] text-[#8A5A00] dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                  : "border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
            )}
            title={wh.operator ? "Changer d'opérateur" : "S'identifier"}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />
            </svg>
            {wh.operator ? wh.operator.name : wh.operators.length > 0 ? "S'identifier" : "Aucun opérateur"}
          </button>
          {wh.operator ? (
            <button type="button" onClick={wh.clearOperator} className="min-h-[36px] rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Quitter le poste">
              Quitter
            </button>
          ) : null}
        </div>

        {/* Section tabs (tablet / small screens) */}
        <nav className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-3 pb-1 lg:hidden" aria-label="Entrepôt">
          {WAREHOUSE_NAV.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cx(
                  "flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium",
                  active ? "bg-[#E6F9EB] text-[#0A7A2C] dark:bg-emerald-950/60 dark:text-emerald-300" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                )}
              >
                {n.icon}
                {n.short}
              </Link>
            );
          })}
        </nav>
      </div>

      {wh.readOnly ? (
        <div role="alert" className="border-b border-[#FBEBC8] bg-[#FEF9E9] px-4 py-2 text-center text-sm font-medium text-[#8A5A00] dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
          Lecture seule : les écritures du module Entrepôt sont arrêtées. Les données restent consultables, aucun geste n'est enregistré.
        </div>
      ) : null}
      {!online ? (
        <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-center text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
          Connexion perdue — rien n'est enregistré tant que le réseau n'est pas revenu.
        </div>
      ) : null}

      <div className="mx-auto flex max-w-[1600px] gap-4 px-4 py-4">
        {/* Left rail (desktop) */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-[7.5rem] rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900" aria-label="Entrepôt">
            {WAREHOUSE_NAV.map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition",
                    active
                      ? "bg-[#E6F9EB] text-[#0A7A2C] dark:bg-emerald-950/60 dark:text-emerald-300"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  )}
                >
                  {n.icon}
                  <span className="min-w-0 flex-1 truncate">{n.label}</span>
                  {n.href === "/warehouse/exceptions" && (overview.data?.exceptions.open ?? 0) > 0 ? (
                    <span className="rounded-md border border-[#FBEBC8] bg-[#FEF9E9] px-1.5 text-xs tabular-nums text-[#8A5A00] dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                      {overview.data?.exceptions.open}
                    </span>
                  ) : null}
                  {n.href === "/warehouse/putaway" && (overview.data?.putaway.active ?? 0) > 0 ? (
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 text-xs tabular-nums text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {overview.data?.putaway.active}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 pb-16">{children}</main>
      </div>
    </div>
  );
}
