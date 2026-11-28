"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SiteRow } from "@/lib/warehouse/locations";
import type { OperatorRow } from "@/lib/warehouse/operators";
import type { StaffRole } from "@/lib/warehouse/types";
import {
  MUTE_STORAGE_KEY,
  SITE_STORAGE_KEY,
  errorMessage,
  isWhError,
  loadOperator,
  loadStation,
  registerApiListeners,
  saveOperator,
  saveStation,
  whGet,
  whPost,
  type StoredOperator,
  type StoredStation,
} from "./api";
import { useLocalFlag } from "./hooks";
import { Btn, ErrorNote, Field, Modal, inputCls } from "../_components/ui";
import { setDisplayTimeZone } from "./format";

export type WhFlags = {
  moduleEnabled: boolean;
  writesEnabled: boolean;
  reservationTtlMinutes: number;
  printClaimTimeoutSeconds: number;
  labelJournalEnforced: boolean;
  labelJournalDir: string | null;
  [key: string]: unknown;
};

export type WhConfig = {
  role: StaffRole;
  flags: WhFlags;
  sites: SiteRow[];
  operators: OperatorRow[];
  operatorId: string | null;
  station: { id: string; siteId: string; siteCode: string; code: string; name: string } | null;
  labelProfiles: Record<string, { widthMm: number; heightMm: number }>;
};

type Status = "loading" | "ready" | "disabled" | "error";

type WarehouseContextValue = {
  status: Status;
  error: unknown;
  config: WhConfig | null;
  role: StaffRole | null;
  isAdmin: boolean;
  sites: SiteRow[];
  site: SiteRow | null;
  siteId: string | null;
  setSiteId: (id: string) => void;
  operators: OperatorRow[];
  operator: StoredOperator | null;
  /** Opens the picker. Resolves true once someone is identified. */
  identifyOperator: () => Promise<boolean>;
  clearOperator: () => void;
  station: StoredStation | null;
  /** False when this browser holds a credential the server no longer accepts. */
  stationValid: boolean;
  setStation: (st: StoredStation | null) => void;
  /** Writes are stopped on the server: show the banner and disable write buttons. */
  readOnly: boolean;
  muted: boolean;
  setMuted: (v: boolean) => void;
  reloadConfig: () => Promise<void>;
};

const WarehouseContext = createContext<WarehouseContextValue | null>(null);

export function useWarehouse(): WarehouseContextValue {
  const ctx = useContext(WarehouseContext);
  if (!ctx) throw new Error("useWarehouse must be used inside the warehouse layout");
  return ctx;
}

export function WarehouseProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<unknown>(null);
  const [config, setConfig] = useState<WhConfig | null>(null);
  const [siteId, setSiteIdState] = useState<string | null>(null);
  const [operator, setOperatorState] = useState<StoredOperator | null>(null);
  const [station, setStationState] = useState<StoredStation | null>(null);
  const [stationValid, setStationValid] = useState(true);
  const [writesStopped, setWritesStopped] = useState(false);
  const [muted, setMuted] = useLocalFlag(MUTE_STORAGE_KEY, false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerWaiters = useRef<((ok: boolean) => void)[]>([]);

  const reloadConfig = useCallback(async () => {
    try {
      const cfg = await whGet<WhConfig>("config", undefined, { silent: true });
      setConfig(cfg);
      setError(null);
      setStatus("ready");
      setWritesStopped(!cfg.flags.writesEnabled);

      const storedOp = loadOperator();
      // The server tells whether the token is still accepted (12 h, or operator deactivated).
      if (storedOp && cfg.operatorId !== storedOp.operatorId) {
        saveOperator(null);
        setOperatorState(null);
      } else setOperatorState(storedOp);

      const storedSt = loadStation();
      setStationState(storedSt);
      setStationValid(!storedSt || cfg.station?.id === storedSt.stationId);

      setSiteIdState((current) => {
        const known = (id: string | null) => (id && cfg.sites.some((s) => s.id === id) ? id : null);
        let stored: string | null = null;
        try {
          stored = window.localStorage.getItem(SITE_STORAGE_KEY);
        } catch {
          stored = null;
        }
        return known(current) ?? known(stored) ?? known(cfg.station?.siteId ?? null) ?? cfg.sites.find((s) => !s.isTest)?.id ?? cfg.sites[0]?.id ?? null;
      });
    } catch (err) {
      if (isWhError(err) && err.code === "MODULE_DISABLED") {
        setStatus("disabled");
        return;
      }
      setError(err);
      setStatus((prev) => (prev === "ready" ? "ready" : "error"));
    }
  }, []);

  useEffect(() => {
    void reloadConfig();
  }, [reloadConfig]);

  const identifyOperator = useCallback(() => {
    return new Promise<boolean>((resolve) => {
      pickerWaiters.current.push(resolve);
      setPickerOpen(true);
    });
  }, []);

  const settlePicker = useCallback((ok: boolean) => {
    setPickerOpen(false);
    const waiters = pickerWaiters.current;
    pickerWaiters.current = [];
    waiters.forEach((w) => w(ok));
  }, []);

  useEffect(() => {
    return registerApiListeners({
      requestOperator: identifyOperator,
      onWritesDisabled: () => setWritesStopped(true),
      onModuleDisabled: () => setStatus("disabled"),
    });
  }, [identifyOperator]);

  const setSiteId = useCallback((id: string) => {
    setSiteIdState(id);
    try {
      window.localStorage.setItem(SITE_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const clearOperator = useCallback(() => {
    saveOperator(null);
    setOperatorState(null);
  }, []);

  const setStation = useCallback((st: StoredStation | null) => {
    saveStation(st);
    setStationState(st);
    setStationValid(true);
  }, []);

  const value = useMemo<WarehouseContextValue>(() => {
    const sites = config?.sites ?? [];
    // Before the children render: every date on screen is shown in the active site's time zone.
    setDisplayTimeZone(sites.find((s) => s.id === siteId)?.timezone);
    return {
      status,
      error,
      config,
      role: config?.role ?? null,
      isAdmin: config?.role === "admin",
      sites,
      site: sites.find((s) => s.id === siteId) ?? null,
      siteId,
      setSiteId,
      operators: config?.operators ?? [],
      operator,
      identifyOperator,
      clearOperator,
      station,
      stationValid,
      setStation,
      readOnly: writesStopped,
      muted,
      setMuted,
      reloadConfig,
    };
  }, [status, error, config, siteId, setSiteId, operator, identifyOperator, clearOperator, station, stationValid, setStation, writesStopped, muted, setMuted, reloadConfig]);

  return (
    <WarehouseContext.Provider value={value}>
      {children}
      <OperatorPicker
        open={pickerOpen}
        operators={config?.operators ?? []}
        current={operator}
        onDone={(op) => {
          saveOperator(op);
          setOperatorState(op);
          settlePicker(true);
        }}
        onCancel={() => settlePicker(false)}
      />
    </WarehouseContext.Provider>
  );
}

function OperatorPicker({
  open,
  operators,
  current,
  onDone,
  onCancel,
}: {
  open: boolean;
  operators: OperatorRow[];
  current: StoredOperator | null;
  onDone: (op: StoredOperator) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<OperatorRow | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelected(null);
      setPin("");
      setErr(null);
    }
  }, [open]);

  const login = async (op: OperatorRow, pinValue: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await whPost<{ operator: { id: string; name: string }; token: string }>("operators/login", { operatorId: op.id, pin: pinValue }, { silent: true });
      onDone({ operatorId: res.operator.id, name: res.operator.name, token: res.token });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onCancel} title="Qui scanne ?">
      {operators.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">Aucun opérateur actif n'est défini. Les gestes sont enregistrés sous le rôle de la session.</p>
      ) : selected && selected.hasPin ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void login(selected, pin);
          }}
          className="space-y-3"
        >
          <p className="text-sm text-slate-700 dark:text-slate-200">
            Code PIN de <strong>{selected.name}</strong>
          </p>
          <Field label="Code PIN">
            <input autoFocus type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} className={inputCls} />
          </Field>
          {err ? <ErrorNote error={new Error(err)} /> : null}
          <div className="flex gap-2">
            <Btn onClick={() => setSelected(null)}>Retour</Btn>
            <Btn type="submit" variant="primary" busy={busy} disabled={!pin}>
              Valider
            </Btn>
          </div>
        </form>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-slate-600 dark:text-slate-300">Choisissez votre nom. Chaque geste sera enregistré à ce nom sur cet appareil.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {operators.map((op) => (
              <button
                key={op.id}
                type="button"
                disabled={busy}
                onClick={() => (op.hasPin ? setSelected(op) : void login(op, null))}
                className={
                  "flex min-h-[56px] items-center justify-between gap-2 rounded-lg border px-4 text-left text-base font-medium transition disabled:opacity-50 " +
                  (current?.operatorId === op.id
                    ? "border-[#02C73A] bg-[#E6F9EB] text-slate-900 dark:bg-emerald-950/50 dark:text-slate-100"
                    : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800")
                }
              >
                <span>{op.name}</span>
                <span className="font-mono text-xs text-slate-500">{op.code}</span>
              </button>
            ))}
          </div>
          {err ? <ErrorNote error={new Error(err)} /> : null}
        </div>
      )}
    </Modal>
  );
}
