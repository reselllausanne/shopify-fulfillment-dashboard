"use client";

import { useCallback, useRef, useState } from "react";
import { Btn } from "../_components/ui";
import type { ScanFlow } from "../_components/scan";
import { errorMessage, isWhError, lookupOperation, newOpKey, whGesture } from "./api";
import { fmtTime } from "./format";
import { usePendingGesture, type PendingGesture } from "./hooks";

/**
 * A physical gesture with its action key.
 *
 *  - the key is generated ONCE (`send` without `opKey`), stored with the exact body in state and
 *    sessionStorage before the request leaves;
 *  - network error / timeout: the same body is retried automatically, then the gesture stays
 *    "pending" with Vérifier / Réessayer (same key) — never a new key;
 *  - a business error means nothing was written: the pending entry is dropped and the error
 *    is thrown to the caller (which may resend the SAME key with a confirmation flag).
 */
export function useGesture<T>(storageKey: string | null, flow: ScanFlow, onRecovered: (result: T, pending: PendingGesture) => void) {
  const { pending, setPending, restored } = usePendingGesture(storageKey);
  const [checking, setChecking] = useState(false);
  // True while the request is on its way (including the wait for the operator to identify).
  const [inFlight, setInFlight] = useState(false);
  const recoveredRef = useRef(onRecovered);
  recoveredRef.current = onRecovered;

  const exec = useCallback(
    async (entry: PendingGesture): Promise<T | null> => {
      setPending(entry);
      setInFlight(true);
      try {
        const result = await whGesture<T>(entry.path, { ...(entry.body as Record<string, unknown>), opKey: entry.opKey });
        setPending(null);
        return result;
      } catch (err) {
        if (isWhError(err) && err.fateUnknown) {
          // Fate unknown: keep the key. Nothing else may be scanned until this is settled.
          flow.notify("error", "Connexion perdue — le résultat de l'action est inconnu.", "Utilisez « Vérifier » : la même action sera relue ou renvoyée avec la même clé, sans doublon.");
          return null;
        }
        setPending(null);
        throw err;
      } finally {
        setInFlight(false);
      }
    },
    [flow, setPending]
  );

  /** New gesture (new key) — or a resend with an explicit, already used key (confirmation flags). */
  const send = useCallback(
    (path: string, body: Record<string, unknown>, label: string, opts: { prefix: string; opKey?: string; extra?: Record<string, unknown> }): Promise<T | null> => {
      const opKey = opts.opKey ?? newOpKey(opts.prefix);
      return exec({ opKey, path, body, label, startedAt: Date.now(), extra: opts.extra });
    },
    [exec]
  );

  /** Ask the server what happened to the pending key; replay it when nothing was recorded. */
  const verify = useCallback(
    async (resendIfAbsent: boolean) => {
      if (!pending || checking) return;
      setChecking(true);
      try {
        const found = await lookupOperation<T>(pending.opKey);
        if (found.found && found.result) {
          const entry = pending;
          setPending(null);
          flow.notify("ok", "Action retrouvée : elle avait bien été enregistrée.");
          recoveredRef.current(found.result, entry);
          return;
        }
        if (!resendIfAbsent) {
          flow.notify("warn", "Rien n'a été enregistré pour cette action.", "Vous pouvez la renvoyer (même clé) ou l'abandonner.");
          return;
        }
        const entry = pending;
        const result = await exec(entry);
        if (result) {
          flow.notify("ok", "Action enregistrée.");
          recoveredRef.current(result, entry);
        }
      } catch (err) {
        if (isWhError(err) && err.fateUnknown) flow.notify("error", "Connexion perdue — vérification impossible pour l'instant.");
        else flow.notify("error", errorMessage(err));
      } finally {
        setChecking(false);
      }
    },
    [pending, checking, setPending, flow, exec]
  );

  const abandon = useCallback(() => setPending(null), [setPending]);

  return { pending, restored, checking, inFlight, send, verify, abandon };
}

export type Gesture<T> = ReturnType<typeof useGesture<T>>;

/** Shown while a gesture has no known outcome. Blocks the flow until settled. */
export function PendingGestureCard<T>({ gesture }: { gesture: Gesture<T> }) {
  const p = gesture.pending;
  if (!p) return null;
  if (gesture.inFlight && !gesture.checking) {
    // Not an incident yet: the request is on its way, or waits for the operator to identify.
    return (
      <div role="status" className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
        Enregistrement en cours : <span className="font-semibold">{p.label}</span>…
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-lg border-2 border-amber-400 bg-[#FEF9E9] px-4 py-3 text-slate-900 dark:bg-amber-950/60 dark:text-amber-100">
      <div className="text-xs font-bold uppercase tracking-wide">Action en attente de vérification</div>
      <div className="mt-1 text-lg font-semibold">{p.label}</div>
      <p className="mt-1 text-sm">
        Envoyée à {fmtTime(p.startedAt)}, réponse non reçue. Ne rescannez pas la boîte : vérifiez d'abord. La même clé d'action est réutilisée, aucun doublon n'est possible.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn variant="warn" size="lg" busy={gesture.checking} onClick={() => void gesture.verify(false)}>
          Vérifier
        </Btn>
        <Btn size="lg" disabled={gesture.checking} onClick={() => void gesture.verify(true)}>
          Réessayer (même clé)
        </Btn>
        <Btn
          variant="ghost"
          size="lg"
          disabled={gesture.checking}
          onClick={() => {
            if (window.confirm("Abandonner cette action ? Faites-le seulement après « Vérifier » : si elle avait été enregistrée, elle le reste.")) gesture.abandon();
          }}
        >
          Abandonner
        </Btn>
      </div>
    </div>
  );
}
