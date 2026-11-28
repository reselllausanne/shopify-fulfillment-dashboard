"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { BatchRow } from "@/lib/warehouse/batches";
import type { ConfirmPutawayResult, PutawayTaskView, RelocateResult } from "@/lib/warehouse/putaway";
import type { LocationSummary, UnitSummary } from "@/lib/warehouse/types";
import type { ScanResolution } from "@/lib/warehouse/units";
import { isWhError, newOpKey, whGet, whPost } from "../_lib/api";
import { useWarehouse } from "../_lib/context";
import { LOCATION_KIND_LABELS, itemTitle, plural } from "../_lib/format";
import { PendingGestureCard, useGesture } from "../_lib/gesture";
import { useLoad } from "../_lib/hooks";
import { FeedbackBanner, ScanInput, useScanFlow } from "../_components/scan";
import { UnitChips, UnitLine } from "../_components/units";
import { Btn, Card, Chip, EmptyState, ErrorNote, Field, Loading, Modal, Notice, PageHeader, Segmented, Thumb, cx, inputCls } from "../_components/ui";

type Queue = { tasks: PutawayTaskView[]; counts: { total: number; reserved: number; pending: number; blocked: number } };
type Scope = { kind: "site" } | { kind: "batch"; id: string; label: string } | { kind: "cart"; id: string; label: string };
type Mode = "putaway" | "move";
type Held = { unit: UnitSummary; task: PutawayTaskView | null };
type ConfirmFlags = { acceptMismatch?: boolean; acceptProfileMismatch?: boolean };
type Mismatch = { opKey: string; unit: UnitSummary; location: LocationSummary; message: string; plannedShortCode: string | null; flags: ConfirmFlags; kind: "destination" | "profile" };
type Full = { unit: UnitSummary; location: LocationSummary; message: string; opKey: string };

const HOLD_LABELS: Record<string, string> = {
  LEVEL_FULL: "Niveau signalé plein",
  NO_SLOT: "Aucune place libre",
  QUARANTINE: "Quarantaine",
};

function PutawayInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { siteId, site, readOnly, isAdmin } = useWarehouse();

  const [mode, setMode] = useState<Mode>("putaway");
  const [scope, setScope] = useState<Scope | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [mismatch, setMismatch] = useState<Mismatch | null>(null);
  const [full, setFull] = useState<Full | null>(null);
  const [moveReason, setMoveReason] = useState("");
  const [reasonFor, setReasonFor] = useState<{ unit: UnitSummary } | null>(null);
  const [reassignReason, setReassignReason] = useState("");
  const [proposeNote, setProposeNote] = useState<string | null>(null);

  const zones = useLoad<{ items: LocationSummary[] }>(() => whGet("locations", { siteId, kinds: "RECEIVING,CART", limit: 200 }), [siteId], { enabled: Boolean(siteId) });
  const batches = useLoad<BatchRow[]>(() => whGet<BatchRow[]>("batches", { siteId, status: "OPEN,PAUSED,CLOSED", limit: 50 }), [siteId], { enabled: Boolean(siteId) });

  const scopeQuery = useMemo(
    () => ({ siteId, batchId: scope?.kind === "batch" ? scope.id : undefined, cartLocationId: scope?.kind === "cart" ? scope.id : undefined }),
    [siteId, scope]
  );
  const queue = useLoad<Queue>(() => whGet<Queue>("putaway", { ...scopeQuery, limit: 500 }), [scopeQuery], { enabled: Boolean(siteId) && scope !== null, intervalMs: 30_000 });

  // Scope from the URL (?batch= / ?cart=), once the reference data is there.
  const batchParam = search.get("batch");
  const cartParam = search.get("cart");
  useEffect(() => {
    if (scope) return;
    if (batchParam && batches.data) {
      const b = batches.data.find((x) => x.id === batchParam);
      setScope({ kind: "batch", id: batchParam, label: b?.reference ?? "Lot" });
    } else if (cartParam && zones.data) {
      const z = zones.data.items.find((x) => x.id === cartParam);
      if (z) setScope({ kind: "cart", id: z.id, label: z.code });
    }
  }, [batchParam, cartParam, batches.data, zones.data, scope]);

  const flow = useScanFlow((code) => handleScan(code));
  const gesture = useGesture<ConfirmPutawayResult | RelocateResult>("warehouse.pending.putaway", flow, (result) => {
    setHeld(null);
    const where = "locationCode" in result ? result.locationCode : result.unit.currentLocationCode;
    flow.notify("ok", `Paire ${result.unit.shortRef} enregistrée en ${where ?? "—"}.`);
    void queue.reload();
  });

  const propose = useCallback(
    async (next: Scope, unitIds?: string[]) => {
      if (!siteId || readOnly) return;
      const r = await whPost<{ reserved: number; noSlot: number; remainingPending: number }>("putaway/propose", {
        siteId,
        batchId: next.kind === "batch" ? next.id : null,
        cartLocationId: next.kind === "cart" ? next.id : null,
        unitIds,
      });
      setProposeNote(
        r.noSlot > 0 || r.remainingPending > 0
          ? `${r.remainingPending} paire(s) sans place proposée${r.noSlot > 0 ? " : plus de niveau libre compatible" : ""}. Scannez le niveau de votre choix pour les ranger.`
          : null
      );
    },
    [siteId, readOnly]
  );

  const chooseScope = (next: Scope) =>
    flow.run(async () => {
      setHeld(null);
      setScope(next);
      await propose(next);
      flow.notify("ok", next.kind === "site" ? "Rangement de tout le site lancé." : `Rangement lancé : ${next.label}.`);
    });

  const pickUnit = async (unit: UnitSummary) => {
    if (mode === "move") {
      setHeld({ unit, task: null });
      setMoveReason("");
      flow.notify("warn", `Paire ${unit.shortRef} en main : scannez la destination.`, `${itemTitle(unit.itemBrand, unit.itemName)} · ${unit.itemSizeLabel ?? "—"} · actuellement en ${unit.currentLocationCode ?? "—"}`);
      return;
    }
    if (unit.presence !== "PRESENT") {
      flow.notify("error", "Cette paire n'est pas présente en stock : elle ne se range pas. Ouvrez sa fiche.", `${unit.shortRef}`);
      return;
    }
    let task = (queue.data?.tasks ?? []).find((t) => t.unit.id === unit.id) ?? null;
    if (!task || !task.proposedLocationId) {
      // Outside the loaded scope, or no place yet: ask for a proposal for this pair only.
      if (!readOnly && siteId) await whPost("putaway/propose", { siteId, unitIds: [unit.id] }).catch(() => undefined);
      const fresh = await whGet<Queue>("putaway", { siteId, limit: 500 });
      task = fresh.tasks.find((t) => t.unit.id === unit.id) ?? null;
    }
    if (!task) {
      flow.notify("warn", `Aucun rangement en attente pour ${unit.shortRef} (elle est en ${unit.currentLocationShortCode ?? unit.currentLocationCode ?? "—"}).`, "Pour la changer de place, utilisez « Déplacer une paire ».");
      return;
    }
    setHeld({ unit, task });
    if (task.proposedLocationShortCode) flow.notify("ok", `Rangez en ${task.proposedLocationShortCode}, puis scannez le niveau.`, `${itemTitle(unit.itemBrand, unit.itemName)} · ${unit.itemSizeLabel ?? "—"}`);
    else flow.notify("warn", "Aucune place proposée pour cette paire : scannez le niveau où vous la posez.", task.holdReason ? HOLD_LABELS[task.holdReason] ?? task.holdReason : undefined);
  };

  const afterMoved = async (r: ConfirmPutawayResult | RelocateResult, location: LocationSummary) => {
    setHeld(null);
    setMismatch(null);
    setFull(null);
    setMoveReason("");
    const fresh = scope ? await whGet<Queue>("putaway", { ...scopeQuery, limit: 500 }).catch(() => null) : null;
    if (fresh) queue.setData(fresh);
    const left = fresh?.counts.total;
    if (r.result === "ALREADY_THERE") {
      flow.notify("ok", `Paire ${r.unit.shortRef} déjà enregistrée en ${location.shortCode} : rien à faire.`);
      return;
    }
    const deviated = "deviated" in r && r.deviated;
    const over = "overCapacity" in r && r.overCapacity;
    flow.notify(
      over ? "warn" : "ok",
      `Paire ${r.unit.shortRef} ${mode === "move" ? "déplacée" : "rangée"} en ${location.shortCode}${deviated ? " (autre place que prévu)" : ""}${over ? " — capacité dépassée, écart ouvert" : ""}`,
      left !== undefined && mode === "putaway" ? (left === 0 ? "Plus rien à ranger ici." : `Reste ${plural(left, "paire", "paires")} à ranger.`) : undefined
    );
  };

  const confirmAt = async (h: Held, location: LocationSummary, opts: { opKey: string; flags?: ConfirmFlags; force?: boolean }) => {
    const flags = opts.flags ?? {};
    try {
      if (mode === "move") {
        if ((h.unit.currentLocationKind === "LEVEL" || opts.force) && moveReason.trim().length < 3) {
          // Nothing is sent without the reason the server would refuse anyway.
          flow.notify("warn", "Indiquez le motif du déplacement (bouton ou champ sous la paire), puis rescannez la destination.");
          return;
        }
        const r = await gesture.send(
          `units/${h.unit.id}/relocate`,
          { toLocationId: location.id, reason: moveReason.trim() || null, force: opts.force ? true : undefined, acceptProfileMismatch: flags.acceptProfileMismatch ? true : undefined, expectedVersion: h.unit.version },
          `Déplacement de ${h.unit.shortRef} vers ${location.shortCode}`,
          { prefix: "mov", opKey: opts.opKey }
        );
        if (r) await afterMoved(r, location);
        return;
      }
      const r = await gesture.send(
        "putaway/confirm",
        { unitId: h.unit.id, locationId: location.id, acceptMismatch: flags.acceptMismatch ? true : undefined, acceptProfileMismatch: flags.acceptProfileMismatch ? true : undefined },
        `Rangement de ${h.unit.shortRef} en ${location.shortCode}`,
        { prefix: "put", opKey: opts.opKey }
      );
      if (r) await afterMoved(r, location);
    } catch (err) {
      if (!isWhError(err)) throw err;
      if (err.code === "DESTINATION_MISMATCH") {
        setMismatch({ opKey: opts.opKey, unit: h.unit, location, message: err.message, plannedShortCode: (err.details?.plannedShortCode as string) ?? null, flags, kind: "destination" });
        flow.notify("warn", err.message);
        return;
      }
      if (err.code === "SIZE_PROFILE_MISMATCH" && !flags.acceptProfileMismatch) {
        // Box format and level format differ: same key, resent with the explicit confirmation.
        setMismatch({ opKey: opts.opKey, unit: h.unit, location, message: err.message, plannedShortCode: null, flags, kind: "profile" });
        flow.notify("warn", err.message);
        return;
      }
      if (err.code === "LEVEL_FULL") {
        setMismatch(null);
        setFull({ unit: h.unit, location, message: err.message, opKey: opts.opKey });
        flow.notify("error", err.message);
        return;
      }
      if (err.code === "INVALID_INPUT" && mode === "move" && /motif/i.test(err.message)) {
        setReasonFor({ unit: h.unit });
        flow.notify("warn", err.message);
        return;
      }
      setMismatch(null);
      throw err;
    }
  };

  async function handleScan(code: string) {
    if (readOnly) {
      flow.notify("error", "Lecture seule : aucun geste n'est enregistré.");
      return;
    }
    if (gesture.pending) {
      flow.notify("warn", "Une action attend d'être vérifiée : utilisez « Vérifier » avant de scanner.");
      return;
    }
    const res = await whGet<ScanResolution>("scan", { code });
    switch (res.kind) {
      case "EMPTY":
        return;
      case "UNIT":
        if (held && held.unit.id === res.unit.id) {
          flow.notify("info", `Paire ${res.unit.shortRef} déjà en main : scannez ${mode === "move" ? "la destination" : "le niveau"}.`);
          return;
        }
        return pickUnit(res.unit);
      case "LOCATION": {
        const loc = res.location;
        if (!held) {
          if (mode === "putaway" && (loc.kind === "CART" || loc.kind === "RECEIVING")) {
            setScope({ kind: "cart", id: loc.id, label: loc.code });
            await propose({ kind: "cart", id: loc.id, label: loc.code });
            flow.notify("ok", `Rangement lancé : ${loc.code}. Scannez l'étiquette d'une paire.`);
            return;
          }
          flow.notify("error", "Scannez d'abord l'étiquette de la paire.", `${loc.code} est un emplacement : il se scanne après la paire.`);
          return;
        }
        return confirmAt(held, loc, { opKey: newOpKey(mode === "move" ? "mov" : "put") });
      }
      case "GTIN":
        flow.notify("error", held ? "Scannez le niveau de destination." : "Scannez d'abord l'étiquette de la paire.", "Ce code est le code-barres de la boîte (GTIN) : il ne désigne pas une paire précise.");
        return;
      default:
        flow.notify("error", "hint" in res ? res.hint : "Code non reconnu.", `Code lu : ${code}`);
    }
  }

  const reassign = (unit: UnitSummary, reason: string) =>
    flow.run(async () => {
      const r = await whPost<{ proposedLocationCode: string | null; proposedLocationShortCode: string | null; noSlot: boolean }>("putaway/reassign", {
        opKey: newOpKey("rea"),
        unitId: unit.id,
        reason,
      });
      setFull(null);
      setReassignReason("");
      const fresh = await whGet<Queue>("putaway", { ...scopeQuery, limit: 500 });
      queue.setData(fresh);
      const all = fresh.tasks.find((t) => t.unit.id === unit.id) ?? (await whGet<Queue>("putaway", { siteId, limit: 500 })).tasks.find((t) => t.unit.id === unit.id) ?? null;
      setHeld({ unit, task: all });
      if (r.noSlot || !r.proposedLocationShortCode) flow.notify("warn", "Aucune autre place libre : scannez le niveau où vous posez la paire.");
      else flow.notify("ok", `Nouvelle place : ${r.proposedLocationShortCode}. Scannez ce niveau.`);
    });

  const reportFull = (f: Full) =>
    flow.run(async () => {
      const r = await whPost<{ locationCode: string; releasedReservations: number }>("putaway/level-full", { opKey: newOpKey("lvf"), locationId: f.location.id, note: null });
      setFull(null);
      if (scope) await propose(scope);
      else if (siteId) await whPost("putaway/propose", { siteId, unitIds: [f.unit.id] }).catch(() => undefined);
      const fresh = await whGet<Queue>("putaway", { siteId, limit: 500 });
      setHeld({ unit: f.unit, task: fresh.tasks.find((t) => t.unit.id === f.unit.id) ?? null });
      await queue.reload();
      flow.notify("warn", `${r.locationCode} signalé plein et bloqué. ${r.releasedReservations} place(s) réservée(s) libérée(s).`, "Un écart est ouvert pour revoir la capacité. Suivez la nouvelle place proposée.");
    });

  // ----- render -----

  const tasks = queue.data?.tasks ?? [];
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; shortCode: string | null; code: string | null; tasks: PutawayTaskView[] }>();
    for (const t of tasks) {
      const key = t.proposedLocationId ?? "none";
      const g = map.get(key) ?? { key, shortCode: t.proposedLocationShortCode, code: t.proposedLocationCode, tasks: [] };
      g.tasks.push(t);
      map.set(key, g);
    }
    return [...map.values()];
  }, [tasks]);

  const remaining = queue.data?.counts.total ?? null;
  const prompt = gesture.pending
    ? "Vérifiez l'action en attente"
    : held
      ? mode === "move"
        ? "Scannez la destination"
        : "Scannez le niveau"
      : "Scannez l'étiquette de la paire";
  const moveNeedsReason = mode === "move" && held?.unit.currentLocationKind === "LEVEL";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rangement"
        subtitle={site ? `${site.code} · de la zone de réception ou du chariot vers le rayon` : undefined}
        actions={
          <Segmented<Mode>
            value={mode}
            onChange={(m) => {
              setMode(m);
              setHeld(null);
              flow.clearFeedback();
            }}
            options={[
              { value: "putaway", label: "Ranger" },
              { value: "move", label: "Déplacer une paire" },
            ]}
          />
        }
      />

      {mode === "putaway" ? (
        <Card title="Que rangez-vous ?" subtitle="Choisissez, ou scannez le code du chariot / de la zone.">
          <div className="flex flex-wrap gap-2">
            {(zones.data?.items ?? [])
              .filter((z) => z.status !== "RETIRED")
              .map((z) => {
                const active = scope?.kind === "cart" && scope.id === z.id;
                return (
                  <button
                    key={z.id}
                    type="button"
                    disabled={flow.busy}
                    onClick={() => void chooseScope({ kind: "cart", id: z.id, label: z.code })}
                    className={cx(
                      "flex min-h-[56px] items-center gap-3 rounded-lg border px-4 text-left transition disabled:opacity-50",
                      active ? "border-[#02C73A] bg-[#E6F9EB] dark:bg-emerald-950/50" : "border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:hover:bg-slate-800"
                    )}
                  >
                    <span>
                      <span className="block font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{z.code}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{LOCATION_KIND_LABELS[z.kind] ?? z.kind}</span>
                    </span>
                    <span className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{z.occupiedCount}</span>
                  </button>
                );
              })}
            {(batches.data ?? [])
              .filter((b) => b.toPutAwayCount > 0)
              .map((b) => {
                const active = scope?.kind === "batch" && scope.id === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    disabled={flow.busy}
                    onClick={() => void chooseScope({ kind: "batch", id: b.id, label: b.reference })}
                    className={cx(
                      "flex min-h-[56px] items-center gap-3 rounded-lg border px-4 text-left transition disabled:opacity-50",
                      active ? "border-[#02C73A] bg-[#E6F9EB] dark:bg-emerald-950/50" : "border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:hover:bg-slate-800"
                    )}
                  >
                    <span>
                      <span className="block font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{b.reference}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">Lot{b.title ? ` · ${b.title}` : ""}</span>
                    </span>
                    <span className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{b.toPutAwayCount}</span>
                  </button>
                );
              })}
            <button
              type="button"
              disabled={flow.busy}
              onClick={() => void chooseScope({ kind: "site" })}
              className={cx(
                "min-h-[56px] rounded-lg border px-4 text-sm font-semibold transition disabled:opacity-50",
                scope?.kind === "site" ? "border-[#02C73A] bg-[#E6F9EB] text-slate-900 dark:bg-emerald-950/50 dark:text-slate-100" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              )}
            >
              Tout le site
            </button>
          </div>
          <ErrorNote error={zones.error ?? batches.error} className="mt-3" />
          {scope && (batchParam || cartParam) ? (
            <button type="button" className="mt-3 text-xs text-slate-500 underline" onClick={() => router.replace("/warehouse/putaway")}>
              Oublier le lot de l'adresse
            </button>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <ScanInput
              prompt={prompt}
              busy={flow.busy}
              disabled={readOnly}
              onScan={flow.submit}
              onEscape={() => {
                if (held && !flow.busy) {
                  setHeld(null);
                  flow.notify("info", "Paire reposée : rien n'a été enregistré.");
                }
              }}
              hint={held ? "Le niveau se scanne après la paire. Échap repose la paire." : mode === "move" ? "Étiquette de la paire à déplacer, puis emplacement de destination." : "Étiquette collée sur la boîte (QR), puis étiquette du niveau."}
            />
          </div>
          <FeedbackBanner feedback={flow.feedback} />
          <PendingGestureCard gesture={gesture} />

          {held ? (
            <div className="rounded-lg border-2 border-[#02C73A] bg-white p-4 dark:bg-slate-900">
              <div className="flex flex-col gap-4 md:flex-row md:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <Thumb src={held.unit.itemImageUrl} size={96} />
                  <div className="min-w-0">
                    <div className="truncate text-xl font-semibold text-slate-900 dark:text-slate-100">{itemTitle(held.unit.itemBrand, held.unit.itemName)}</div>
                    <div className="text-lg font-semibold text-slate-700 dark:text-slate-200">Pointure {held.unit.itemSizeLabel ?? "—"}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono font-medium text-[#0A7A2C] dark:text-emerald-400">{held.unit.shortRef}</span>
                      <span className="text-slate-500 dark:text-slate-400">en {held.unit.currentLocationCode ?? "—"}</span>
                      <UnitChips unit={held.unit} />
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-center md:text-right">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{mode === "move" ? "Destination" : "À ranger en"}</div>
                  <div className="font-mono text-6xl font-bold leading-none tracking-tight text-slate-900 dark:text-slate-100 md:text-7xl">
                    {mode === "move" ? "?" : held.task?.proposedLocationShortCode ?? "?"}
                  </div>
                  <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                    {mode === "move" ? "Scannez l'emplacement" : held.task?.proposedLocationCode ?? "Aucune place proposée : scannez le niveau choisi"}
                  </div>
                </div>
              </div>
              {moveNeedsReason ? (
                <div className="mt-4">
                  <div className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Motif du déplacement (obligatoire pour sortir une paire de son niveau)</div>
                  <div className="mb-2 flex flex-wrap gap-2">
                    {["Regroupement des pointures", "Niveau à libérer", "Erreur de rangement", "Contrôle demandé"].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setMoveReason(r)}
                        className={cx(
                          "min-h-[44px] rounded-lg border px-3 text-sm font-medium",
                          moveReason === r ? "border-[#02C73A] bg-[#E6F9EB] text-slate-900 dark:bg-emerald-950/50 dark:text-slate-100" : "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <input
                    value={moveReason}
                    onChange={(e) => setMoveReason(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter leaves the field so the next scan goes to the scan input.
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    placeholder="Autre motif"
                    aria-label="Motif du déplacement"
                    className={inputCls}
                  />
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {mode === "putaway" && held.task ? (
                  <Btn disabled={flow.busy || readOnly} onClick={() => setFull({ unit: held.unit, location: { shortCode: held.task?.proposedLocationShortCode ?? "", code: held.task?.proposedLocationCode ?? "", id: held.task?.proposedLocationId ?? "" } as LocationSummary, message: "", opKey: "" })}>
                    Cette place ne convient pas
                  </Btn>
                ) : null}
                <Btn
                  variant="ghost"
                  disabled={flow.busy}
                  onClick={() => {
                    setHeld(null);
                    flow.notify("info", "Paire reposée : rien n'a été enregistré.");
                  }}
                >
                  Reposer la paire
                </Btn>
              </div>
            </div>
          ) : null}

          {mode === "putaway" && scope && remaining === 0 && !held ? (
            <div className="rounded-lg border border-[#BDEFCB] bg-[#E6F9EB] px-6 py-10 text-center dark:border-emerald-800 dark:bg-emerald-950/40">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#02C73A] text-slate-950">
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5 9-10" />
                </svg>
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-900 dark:text-slate-100">{scope.kind === "cart" ? "Chariot vide" : "Tout est rangé"}</div>
              <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">Aucune paire en attente de rangement {scope.kind === "site" ? "sur ce site" : `pour ${scope.label}`}.</p>
            </div>
          ) : null}
          {proposeNote && mode === "putaway" ? <Notice tone="amber">{proposeNote}</Notice> : null}
        </div>

        {mode === "putaway" ? (
          <Card
            title={scope ? (scope.kind === "site" ? "Tout le site" : scope.label) : "Paires à ranger"}
            subtitle={queue.data ? `${plural(queue.data.counts.total, "paire restante", "paires restantes")} · ${queue.data.counts.reserved} avec place · ${queue.data.counts.pending} sans place` : "Dans l'ordre de marche"}
            flush
          >
            {!scope ? (
              <EmptyState title="Choisissez un chariot, une zone ou un lot">La liste s'affiche par niveau de destination, dans l'ordre de marche.</EmptyState>
            ) : !queue.data ? (
              queue.loading ? (
                <Loading />
              ) : (
                <ErrorNote error={queue.error} className="m-3" onRetry={() => void queue.reload()} />
              )
            ) : groups.length === 0 ? (
              <EmptyState title="Rien à ranger" />
            ) : (
              <div className="max-h-[70vh] overflow-y-auto">
                {groups.map((g) => (
                  <div key={g.key} className="border-b border-slate-200 last:border-0 dark:border-slate-800">
                    <div className="flex items-baseline justify-between gap-2 bg-slate-50 px-4 py-2 dark:bg-slate-800/50">
                      <div>
                        <span className="font-mono text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{g.shortCode ?? "Sans place"}</span>
                        {g.code ? <span className="ml-2 font-mono text-xs text-slate-500 dark:text-slate-400">{g.code}</span> : null}
                      </div>
                      <Chip tone={g.shortCode ? "green" : "amber"}>{plural(g.tasks.length, "paire", "paires")}</Chip>
                    </div>
                    <ul className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
                      {g.tasks.map((t) => (
                        <li key={t.taskId} className={held?.unit.id === t.unit.id ? "bg-[#E6F9EB]/60 dark:bg-emerald-950/30" : ""}>
                          <UnitLine
                            unit={t.unit}
                            right={
                              <>
                                <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{t.fromLocationCode}</span>
                                {t.holdReason ? <Chip tone="amber">{HOLD_LABELS[t.holdReason] ?? t.holdReason}</Chip> : null}
                              </>
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ) : (
          <Card title="Déplacer une paire">
            <ol className="list-inside list-decimal space-y-2 text-sm text-slate-700 dark:text-slate-200">
              <li>Scannez l'étiquette de la paire.</li>
              <li>Scannez l'emplacement où vous la posez : niveau, chariot, zone de réception, quarantaine.</li>
            </ol>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              Vers un chariot ou une zone de réception, la paire repart en rangement. Vers la quarantaine, elle est bloquée à la vente. Sortir une paire de son niveau demande un motif.
            </p>
          </Card>
        )}
      </div>

      {/* Deviation */}
      <Modal
        open={Boolean(mismatch)}
        tone="amber"
        title="Ranger ici quand même ?"
        onClose={() => {
          setMismatch(null);
          flow.notify("info", "Rangement non enregistré : la paire est toujours à ranger.");
        }}
        footer={
          <>
            <Btn
              size="lg"
              onClick={() => {
                setMismatch(null);
                flow.notify("info", "Rangement non enregistré : la paire est toujours à ranger.");
              }}
            >
              {mismatch?.kind === "profile" ? "Non, je choisis un autre niveau" : `Non, je vais en ${mismatch?.plannedShortCode ?? "place prévue"}`}
            </Btn>
            <Btn
              variant="warn"
              size="lg"
              busy={flow.busy}
              onClick={() => {
                const m = mismatch;
                if (m && held) void flow.run(() => confirmAt(held, m.location, { opKey: m.opKey, flags: { ...m.flags, ...(m.kind === "profile" ? { acceptProfileMismatch: true } : { acceptMismatch: true }) } }));
              }}
            >
              Ranger en {mismatch?.location.shortCode}
            </Btn>
          </>
        }
      >
        <p className="text-base text-slate-800 dark:text-slate-100">{mismatch?.message}</p>
        <div className={mismatch?.kind === "profile" ? "hidden" : "mt-4 grid grid-cols-2 gap-3 text-center"}>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="text-xs text-slate-500 dark:text-slate-400">Prévu</div>
            <div className="font-mono text-3xl font-bold text-slate-900 dark:text-slate-100">{mismatch?.plannedShortCode ?? "—"}</div>
          </div>
          <div className="rounded-lg border-2 border-amber-400 p-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">Scanné</div>
            <div className="font-mono text-3xl font-bold text-slate-900 dark:text-slate-100">{mismatch?.location.shortCode}</div>
          </div>
        </div>
      </Modal>

      {/* Level full / place does not fit */}
      <Modal
        open={Boolean(full)}
        tone={full?.message ? "red" : undefined}
        title={full?.message ? "Niveau plein" : "Cette place ne convient pas"}
        onClose={() => setFull(null)}
        footer={<Btn onClick={() => setFull(null)}>Fermer</Btn>}
      >
        {full ? (
          <div className="space-y-4">
            {full.message ? <p className="text-base text-slate-800 dark:text-slate-100">{full.message}</p> : null}
            <p className="text-sm text-slate-600 dark:text-slate-300">La paire n'a pas bougé : elle reste enregistrée en {full.unit.currentLocationCode ?? "—"}.</p>
            {mode === "putaway" ? (
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <Field label="Motif (obligatoire)">
                  <input value={reassignReason} onChange={(e) => setReassignReason(e.target.value)} placeholder={full.message ? "Niveau plein" : "ex. boîte trop grande, niveau encombré"} className={inputCls} />
                </Field>
                <Btn variant="primary" size="lg" className="mt-3 w-full" busy={flow.busy} onClick={() => void reassign(full.unit, reassignReason.trim() || (full.message ? "Niveau plein" : ""))} disabled={!full.message && reassignReason.trim().length < 3}>
                  Proposer une autre place
                </Btn>
              </div>
            ) : null}
            {full.location.id && (full.location.kind === "LEVEL" || !full.location.kind) ? (
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Si <span className="font-mono font-semibold">{full.location.shortCode}</span> est physiquement plein : il sera bloqué pour les prochains rangements et un écart sera ouvert pour revoir sa capacité.
                </p>
                <Btn variant="warn" size="lg" className="mt-3 w-full" busy={flow.busy} onClick={() => void reportFull(full)}>
                  Signaler niveau plein
                </Btn>
              </div>
            ) : null}
            {mode === "move" && isAdmin && full.opKey ? (
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-sm text-slate-600 dark:text-slate-300">Gestionnaire : enregistrer la réalité même si le niveau dépasse sa capacité (motif obligatoire, un écart est ouvert).</p>
                <Field label="Motif" className="mt-2">
                  <input value={moveReason} onChange={(e) => setMoveReason(e.target.value)} className={inputCls} />
                </Field>
                <Btn
                  variant="danger"
                  className="mt-3 w-full"
                  busy={flow.busy}
                  disabled={moveReason.trim().length < 3}
                  onClick={() => {
                    const f = full;
                    if (held) void flow.run(() => confirmAt(held, f.location, { opKey: f.opKey, force: true }));
                  }}
                >
                  Enregistrer quand même
                </Btn>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(reasonFor)} tone="amber" title="Motif requis" onClose={() => setReasonFor(null)} footer={<Btn onClick={() => setReasonFor(null)}>J'ai compris</Btn>}>
        <p className="text-base text-slate-800 dark:text-slate-100">Indiquez le motif du déplacement dans le champ sous la paire, puis rescannez la destination.</p>
      </Modal>
    </div>
  );
}

export default function PutawayPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PutawayInner />
    </Suspense>
  );
}
