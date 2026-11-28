"use client";

import { useEffect, useRef, useState } from "react";
import type { ClaimedJob } from "@/lib/warehouse/printing";
import { ensureQzConnected, listQzPrinters } from "@/app/lib/printStationClient";
import { QZ_TRAY_DOWNLOAD_URL, buildQzPdfDataOptions, buildQzPixelConfigOptions, defaultPrintStationConfig } from "@/lib/printStation";
import { AGENT_PAUSE_STORAGE_KEY, errorMessage, isWhError, whPost } from "../_lib/api";
import { useWarehouse } from "../_lib/context";
import { useLocalFlag } from "../_lib/hooks";
import { cx } from "./ui";

/**
 * Print agent of a paired station. One loop per browser profile (Web Lock, or a localStorage
 * lease where locks are unavailable):
 *
 *   QZ Tray connected ? → claim ONE job → print the PDF through QZ → report SENT / FAILED.
 *
 * Nothing is claimed while QZ is not connected: jobs stay QUEUED instead of becoming UNCERTAIN.
 */

type AgentJob = ClaimedJob & { pdfBase64: string };
type AgentState = "idle" | "starting" | "connected" | "printing" | "no-qz" | "qz-wait" | "paused" | "revoked" | "standby" | "read-only" | "offline";

const CLAIM_INTERVAL_MS = 2000;
const QZ_RETRY_MS = 8000;
const QZ_ANSWER_TIMEOUT_MS = 12_000;
const LEASE_KEY = "warehouse.agentLease.v1";
const LEASE_TTL_MS = 8000;
const LOCK_NAME = "warehouse-print-agent";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const id = setTimeout(done, ms);
    function done() {
      clearTimeout(id);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });

const TIMED_OUT = Symbol("timeout");

/** Resolve with TIMED_OUT when `p` has not settled in time (the promise itself keeps running). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => resolve(TIMED_OUT), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      }
    );
  });
}

/**
 * QZ Tray is usable only when it ANSWERS a request: an open socket is not enough (an
 * authorization dialog may still be waiting on the desk). Listing printers is the probe.
 */
async function qzAnswers(): Promise<boolean> {
  const qz = window.qz;
  if (!qz || !qz.websocket.isActive()) return false;
  try {
    const found = await withTimeout(qz.printers.find(), QZ_ANSWER_TIMEOUT_MS);
    return found !== TIMED_OUT;
  } catch {
    return false;
  }
}

/** Send one claimed job to QZ. Everything thrown before `qz.print` is a "nothing was sent" failure. */
async function printJob(job: AgentJob): Promise<void> {
  const qz = window.qz;
  const systemName = String(job.printer?.systemName ?? "").trim();
  if (!qz || !qz.websocket.isActive()) throw new Error("QZ Tray déconnecté avant l'envoi");
  if (!systemName) throw new Error("Nom système de l'imprimante manquant");
  if (!job.pdfBase64) throw new Error("Étiquette vide");
  const listed = await withTimeout(listQzPrinters(), QZ_ANSWER_TIMEOUT_MS);
  if (listed === TIMED_OUT) throw new Error("QZ Tray ne répond pas (autorisation en attente sur le poste ?)");
  const printers = listed;
  const match = printers.find((p) => p.trim().toLowerCase() === systemName.toLowerCase());
  if (!match) throw new Error(`Imprimante introuvable sur ce poste : ${systemName}`);

  const margin = Number(job.printer.marginMm) || 0;
  const cfg = defaultPrintStationConfig({
    printerName: match,
    labelWidthMm: job.widthMm,
    labelHeightMm: job.heightMm,
    orientation: job.printer.orientation === "portrait" ? "portrait" : "landscape",
    dpi: job.printer.dpi ?? null,
    marginTopMm: margin,
    marginRightMm: margin,
    marginBottomMm: margin,
    marginLeftMm: margin,
    // The PDF page already has the label size: fit it to the media.
    scaleContent: true,
    useDriverPaperSize: Boolean(job.printer.useDriverPaperSize),
  });
  const config = qz.configs.create(match, { ...buildQzPixelConfigOptions(cfg, 1), jobName: `entrepot-${job.id.slice(0, 8)}` });
  const pdfOptions = buildQzPdfDataOptions(cfg);
  const data = [{ type: "pixel", format: "pdf", flavor: "base64", data: job.pdfBase64, ...(pdfOptions ? { options: pdfOptions } : {}) }];
  await qz.print(config, data);
}

async function report(job: AgentJob, outcome: "SENT" | "FAILED", error: string | null, signal: AbortSignal): Promise<void> {
  // The report is idempotent on the server: repeat it until it is acknowledged or refused.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await whPost("agent/report", { jobId: job.id, claimToken: job.claimToken, outcome, error: error ? error.slice(0, 280) : undefined }, { silent: true });
      return;
    } catch (err) {
      if (!isWhError(err) || !err.fateUnknown) return; // refused (stale claim): the job is already UNCERTAIN / handled.
      await sleep(1500 * (attempt + 1), signal);
      if (signal.aborted && attempt >= 1) return;
    }
  }
}

function tabId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Fallback single-runner guard when the Web Locks API is unavailable (plain http). */
function holdLease(id: string): boolean {
  try {
    const raw = window.localStorage.getItem(LEASE_KEY);
    const lease = raw ? (JSON.parse(raw) as { id: string; at: number }) : null;
    if (lease && lease.id !== id && Date.now() - lease.at < LEASE_TTL_MS) return false;
    window.localStorage.setItem(LEASE_KEY, JSON.stringify({ id, at: Date.now() }));
    const check = JSON.parse(window.localStorage.getItem(LEASE_KEY) ?? "null") as { id: string } | null;
    return check?.id === id;
  } catch {
    return true;
  }
}

export default function PrintAgent() {
  const { station, stationValid, readOnly } = useWarehouse();
  const [paused, setPaused] = useLocalFlag(AGENT_PAUSE_STORAGE_KEY, false);
  const [state, setState] = useState<AgentState>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [printed, setPrinted] = useState(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const active = Boolean(station && stationValid);
  const credential = station?.credential ?? null;

  useEffect(() => {
    if (!active || !credential) {
      setState("idle");
      return;
    }
    const abort = new AbortController();
    const signal = abort.signal;
    const me = tabId();
    setState("starting");

    const loop = async () => {
      let qzFailures = 0;
      let qzReady = false;
      while (!signal.aborted) {
        if (pausedRef.current) {
          setState("paused");
          await sleep(1000, signal);
          continue;
        }
        if (readOnlyRef.current) {
          setState("read-only");
          await sleep(10_000, signal);
          continue;
        }
        if (!navigator.onLine) {
          setState("offline");
          await sleep(3000, signal);
          continue;
        }
        let connected: boolean | typeof TIMED_OUT = false;
        try {
          connected = await withTimeout(ensureQzConnected(), QZ_ANSWER_TIMEOUT_MS);
        } catch {
          connected = false;
        }
        if (signal.aborted) return;
        if (connected !== true) {
          // Never claim without QZ: the jobs must stay queued.
          qzFailures += 1;
          qzReady = false;
          setState(connected === TIMED_OUT ? "qz-wait" : "no-qz");
          await sleep(Math.min(30_000, QZ_RETRY_MS * Math.min(qzFailures, 3)), signal);
          continue;
        }
        if (!qzReady) {
          // First contact (or reconnection): make sure QZ really answers before taking a job.
          qzReady = await qzAnswers();
          if (signal.aborted) return;
          if (!qzReady) {
            qzFailures += 1;
            setState("qz-wait");
            await sleep(Math.min(30_000, QZ_RETRY_MS * Math.min(qzFailures, 3)), signal);
            continue;
          }
        }
        qzFailures = 0;
        setState("connected");

        let job: AgentJob | null = null;
        try {
          const res = await whPost<{ job: AgentJob | null }>("agent/claim", {}, { silent: true });
          job = res.job;
        } catch (err) {
          if (isWhError(err) && err.status === 401) {
            setState("revoked");
            setLastError(err.message);
            await sleep(15_000, signal);
          } else if (isWhError(err) && err.code === "WRITES_DISABLED") {
            setState("read-only");
            await sleep(10_000, signal);
          } else {
            // A lost claim answer may leave a job CLAIMED: the server turns it UNCERTAIN after its deadline.
            setLastError(errorMessage(err));
            await sleep(5000, signal);
          }
          continue;
        }
        if (!job) {
          await sleep(CLAIM_INTERVAL_MS, signal);
          continue;
        }

        setState("printing");
        try {
          await printJob(job);
          await report(job, "SENT", null, signal);
          setPrinted((n) => n + 1);
          setLastError(null);
        } catch (err) {
          const message = errorMessage(err) || "Échec d'impression";
          setLastError(message);
          await report(job, "FAILED", message, signal);
          // Check QZ again before the next claim.
          qzReady = false;
          await sleep(1500, signal);
        }
      }
    };

    const runWithLease = async () => {
      while (!signal.aborted && !holdLease(me)) {
        setState("standby");
        await sleep(3000, signal);
      }
      if (signal.aborted) return;
      const keep = window.setInterval(() => holdLease(me), 3000);
      try {
        await loop();
      } finally {
        window.clearInterval(keep);
        try {
          const lease = JSON.parse(window.localStorage.getItem(LEASE_KEY) ?? "null") as { id: string } | null;
          if (lease?.id === me) window.localStorage.removeItem(LEASE_KEY);
        } catch {
          /* ignore */
        }
      }
    };

    if (typeof navigator !== "undefined" && navigator.locks?.request) {
      // Second tab (or a double mount): waits here until the first one goes away.
      let got = false;
      const standby = window.setTimeout(() => {
        if (!got && !signal.aborted) setState("standby");
      }, 800);
      navigator.locks
        .request(LOCK_NAME, { signal }, async () => {
          got = true;
          window.clearTimeout(standby);
          await loop();
        })
        .catch(() => {
          /* aborted on unmount */
        });
    } else {
      void runWithLease();
    }

    return () => abort.abort();
  }, [active, credential]);

  if (!station) return null;

  const view: Record<AgentState, { label: string; dot: string }> = {
    idle: { label: "inactif", dot: "bg-slate-400" },
    starting: { label: "démarrage…", dot: "bg-slate-400" },
    connected: { label: "connecté", dot: "bg-[#02C73A]" },
    printing: { label: "impression…", dot: "bg-[#02C73A] animate-pulse" },
    "no-qz": { label: "QZ Tray absent", dot: "bg-red-500" },
    "qz-wait": { label: "QZ Tray ne répond pas (autorisation à donner sur le poste ?)", dot: "bg-amber-400" },
    paused: { label: "en pause", dot: "bg-amber-400" },
    revoked: { label: "appairage révoqué", dot: "bg-red-500" },
    standby: { label: "actif dans un autre onglet", dot: "bg-slate-400" },
    "read-only": { label: "lecture seule", dot: "bg-amber-400" },
    offline: { label: "hors ligne", dot: "bg-red-500" },
  };
  const shown = !stationValid ? view.revoked : paused && state !== "standby" ? view.paused : view[state];

  return (
    <div
      className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-slate-200 bg-white pl-3 pr-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      title={lastError ? `Dernière erreur : ${lastError}` : `${printed} étiquette(s) envoyée(s) depuis l'ouverture`}
    >
      <span className={cx("h-2 w-2 shrink-0 rounded-full", shown.dot)} aria-hidden />
      <span className="whitespace-nowrap">
        <span className="hidden text-slate-500 dark:text-slate-400 xl:inline">Agent d'impression : </span>
        <span className="font-medium">{shown.label}</span>
      </span>
      {state === "no-qz" && !paused ? (
        <a href={QZ_TRAY_DOWNLOAD_URL} target="_blank" rel="noreferrer" className="whitespace-nowrap font-medium text-sky-700 underline dark:text-sky-400">
          Installer
        </a>
      ) : null}
      {stationValid ? (
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          aria-pressed={paused}
          className="min-h-[32px] rounded-md px-2 font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {paused ? "Reprendre" : "Pause"}
        </button>
      ) : null}
    </div>
  );
}
