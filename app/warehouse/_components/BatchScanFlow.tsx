"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { BatchDetail, CloseSessionResult, CountSessionView, ReceiveUnitResult, StockTakeCreateResult, StockTakeScanResult } from "@/lib/warehouse/batches";
import type { LocationSummary, UnitSummary } from "@/lib/warehouse/types";
import type { ScanResolution } from "@/lib/warehouse/units";
import { isWhError, newOpKey, whGet, whPost } from "../_lib/api";
import { useWarehouse } from "../_lib/context";
import { LOCATION_KIND_LABELS, exceptionLabel, itemTitle, plural } from "../_lib/format";
import { PendingGestureCard, useGesture } from "../_lib/gesture";
import type { PendingGesture } from "../_lib/hooks";
import { ConfirmBoxCard, DEFAULT_BOX_OPTIONS, IdentifyPanel, NO_IDENT, identFromGtin, identGtin, identLabel, materializeItem, type BoxOptions, type Ident } from "./box";
import { FeedbackBanner, ScanInput, useScanFlow } from "./scan";
import { PrintOutcomeNote, UnitLine } from "./units";
import { Btn, Card, Chip, Modal, Notice, OccupancyBar, cx } from "./ui";

type CreatedEntry = { unit: UnitSummary; print: StockTakeCreateResult["print"]; note?: string };
type UnitConfirm = { opKey: string; unit: UnitSummary; flags: { confirmMove?: boolean; acknowledgeOwner?: boolean }; confirm: "confirmMove" | "acknowledgeOwner"; message: string };

const TEMP_KINDS = ["RECEIVING", "CART", "QUARANTINE"];

function StepPills({ step }: { step: 1 | 2 | 3 }) {
  const steps: [number, string][] = [
    [1, "Niveau"],
    [2, "Boîtes"],
    [3, "Terminer le niveau"],
  ];
  return (
    <ol className="flex flex-wrap gap-2 text-sm">
      {steps.map(([n, label]) => (
        <li
          key={n}
          className={cx(
            "flex items-center gap-2 rounded-lg border px-3 py-1.5 font-medium",
            n === step
              ? "border-[#02C73A] bg-[#E6F9EB] text-[#0A7A2C] dark:bg-emerald-950/60 dark:text-emerald-300"
              : n < step
                ? "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                : "border-slate-200 bg-white text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500"
          )}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs tabular-nums">{n}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

/**
 * Scan flow of a batch.
 *  - STOCK_TAKE: scan a level → for each box scan its GTIN, confirm once → pair + label;
 *    an existing pair label is counted in place; "Terminer ce niveau" closes the count.
 *  - RECEIVING: each box → GTIN → confirm once → pair on the receiving zone / cart + label.
 * One scan never creates a pair: creation always goes through the explicit confirmation.
 */
export default function BatchScanFlow({ detail, onChanged }: { detail: BatchDetail; onChanged: () => void }) {
  const { readOnly, station, stationValid } = useWarehouse();
  const batch = detail.batch;
  const stockTake = batch.kind === "STOCK_TAKE";

  const [session, setSession] = useState<CountSessionView | null>(null);
  const [level, setLevel] = useState<LocationSummary | null>(null);
  const [destination, setDestination] = useState<LocationSummary | null>(null);
  const [ident, setIdent] = useState<Ident>(NO_IDENT);
  const [options, setOptions] = useState<BoxOptions>(DEFAULT_BOX_OPTIONS);
  const [recent, setRecent] = useState<CreatedEntry[]>([]);
  const [takeover, setTakeover] = useState<{ location: LocationSummary; message: string } | null>(null);
  const [unitConfirm, setUnitConfirm] = useState<UnitConfirm | null>(null);
  const [closeSummary, setCloseSummary] = useState<CloseSessionResult | null>(null);

  const refreshSession = useCallback(async (sessionId: string) => {
    const s = await whGet<CountSessionView>(`sessions/${sessionId}`);
    setSession(s.status === "OPEN" ? s : null);
    if (s.status === "OPEN") {
      const loc = await whGet<{ location: LocationSummary }>(`locations/${s.locationId}`);
      setLevel(loc.location);
    } else setLevel(null);
  }, []);

  // ----- outcomes (also used when a lost answer is recovered) -----

  const applyCreated = (r: StockTakeCreateResult | ReceiveUnitResult, notify: (tone: "ok" | "warn", message: string, detail?: ReactNode) => void) => {
    const exceptions = "exceptions" in r ? r.exceptions : r.exception ? [r.exception] : [];
    const surplus = exceptions.some((e) => e.type === "SURPLUS");
    const notes: string[] = [];
    if (exceptions.length) notes.push(`Écart ouvert : ${exceptions.map((e) => exceptionLabel(e.type)).join(", ")}`);
    if ("line" in r && r.line) notes.push(`Ligne ${r.line.lineNo} : ${r.line.receivedQty}${r.line.expectedQty !== null ? ` / ${r.line.expectedQty}` : ""} reçue(s)`);
    if ("countedInSession" in r) notes.push(`${plural(r.countedInSession, "paire comptée", "paires comptées")} sur ce niveau`);
    setRecent((prev) => [{ unit: r.unit, print: r.print, note: notes.join(" · ") }, ...prev].slice(0, 30));
    setIdent(NO_IDENT);
    setOptions(DEFAULT_BOX_OPTIONS);
    const printed = r.print?.status === "QUEUED";
    notify(
      printed && !surplus ? "ok" : "warn",
      surplus
        ? `Paire créée ${r.unit.shortRef} — excédent : cette boîte ne correspond à aucune ligne attendue.`
        : printed
          ? `Paire créée ${r.unit.shortRef} · ${itemTitle(r.unit.itemBrand, r.unit.itemName)} · ${r.unit.itemSizeLabel ?? ""}`
          : `Paire créée ${r.unit.shortRef} — étiquette à imprimer`,
      <div className="space-y-1">
        <PrintOutcomeNote print={r.print} unitId={r.unit.id} />
        {notes.length ? <div>{notes.join(" · ")}</div> : null}
      </div>
    );
    onChanged();
  };

  const applyScanned = (r: StockTakeScanResult, notify: (tone: "ok" | "warn", message: string, detail?: ReactNode) => void) => {
    const good = r.result === "FOUND_HERE" || r.result === "MOVED_HERE";
    notify(
      good ? "ok" : "warn",
      r.message || (good ? `Paire ${r.unit.shortRef} comptée.` : `Paire ${r.unit.shortRef} non comptée.`),
      <span>
        {itemTitle(r.unit.itemBrand, r.unit.itemName)} · {r.unit.itemSizeLabel ?? "—"} · {plural(r.countedInSession, "paire comptée", "paires comptées")}
        {r.exceptions?.length ? ` · Écart ouvert : ${r.exceptions.map((e) => exceptionLabel(e.type)).join(", ")}` : ""}
      </span>
    );
    onChanged();
  };

  const flow = useScanFlow((code) => handleScan(code));

  const gesture = useGesture<StockTakeCreateResult | ReceiveUnitResult | StockTakeScanResult | { unitId: string; alreadyVerified: boolean }>(
    `warehouse.pending.batch.${batch.id}`,
    flow,
    (result, pending: PendingGesture) => {
      const kind = pending.extra?.kind;
      if (kind === "create") applyCreated(result as StockTakeCreateResult, flow.notify);
      else if (kind === "scan-unit") applyScanned(result as StockTakeScanResult, flow.notify);
      if (session) void refreshSession(session.id).catch(() => undefined);
    }
  );

  // Resume the level in progress (reload, other tab, coffee break).
  const openSessionId = detail.openSession?.id ?? null;
  useEffect(() => {
    if (!stockTake) return;
    if (!openSessionId) {
      setSession(null);
      setLevel(null);
      return;
    }
    if (session?.id === openSessionId) return;
    refreshSession(openSessionId).catch((err) => flow.notifyError(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockTake, openSessionId]);

  // ----- level -----

  const openLevel = async (location: LocationSummary, takeOver: boolean) => {
    try {
      const r = await whPost<{ session: CountSessionView; resumed: boolean }>(`batches/${batch.id}/sessions`, { locationId: location.id, takeOver });
      setSession(r.session);
      setLevel(location);
      setTakeover(null);
      setCloseSummary(null);
      setRecent([]);
      flow.notify(
        "ok",
        r.resumed ? `Comptage repris sur ${location.shortCode}` : `Niveau ${location.shortCode} ouvert`,
        `${location.code} · ${plural(r.session.countedUnits, "paire déjà comptée", "paires déjà comptées")}${r.session.notYetScanned.length ? ` · ${r.session.notYetScanned.length} déjà enregistrée(s) ici, à rescanner` : ""}`
      );
      onChanged();
    } catch (err) {
      if (isWhError(err) && err.code === "SESSION_CONFLICT" && (err.details?.takeOver || err.details?.stationId)) {
        setTakeover({ location, message: err.message });
        flow.notify("warn", err.message);
        return;
      }
      if (isWhError(err) && err.code === "SESSION_CONFLICT" && typeof err.details?.batchId === "string") {
        flow.notify(
          "error",
          err.message,
          <Link className="underline" href={`/warehouse/receiving/${err.details.batchId}`}>
            Ouvrir l'autre lot
          </Link>
        );
        return;
      }
      throw err;
    }
  };

  const closeLevel = () =>
    flow.run(async () => {
      if (!session) return;
      if (ident.step !== "none") {
        flow.notify("warn", "Une boîte est en cours : confirmez-la ou annulez-la avant de terminer le niveau.");
        return;
      }
      const r = await whPost<CloseSessionResult>(`sessions/${session.id}/close`);
      setCloseSummary(r);
      setSession(null);
      setLevel(null);
      flow.notify("ok", `Niveau ${r.locationCode} terminé : ${plural(r.counted, "paire comptée", "paires comptées")}`, r.notScanned.length ? `${r.notScanned.length} paire(s) enregistrée(s) ici n'ont pas été scannées : voir le résumé.` : undefined);
      onChanged();
    });

  // ----- existing pair scanned during a stock-take -----

  const scanExistingUnit = async (unit: UnitSummary, flags: UnitConfirm["flags"], opKey: string) => {
    if (!session) return;
    try {
      const r = await gesture.send(`sessions/${session.id}/scan-unit`, { unitId: unit.id, ...flags }, `Comptage de la paire ${unit.shortRef}`, { prefix: "stu", opKey, extra: { kind: "scan-unit" } });
      setUnitConfirm(null);
      if (r) {
        applyScanned(r as StockTakeScanResult, flow.notify);
        await refreshSession(session.id);
      }
    } catch (err) {
      const confirm = isWhError(err) && err.code === "CONFIRMATION_REQUIRED" ? err.details?.confirm : null;
      if (isWhError(err) && (confirm === "confirmMove" || confirm === "acknowledgeOwner")) {
        // Same key, resent with the explicit flag once the operator has confirmed.
        setUnitConfirm({ opKey, unit, flags, confirm, message: err.message });
        flow.notify("warn", err.message);
        return;
      }
      setUnitConfirm(null);
      throw err;
    }
  };

  // ----- scan dispatcher -----

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

    if (stockTake && session && res.kind === "LOCATION" && res.location.id === session.locationId) {
      // Scanning the level again proves where the operator stands: it resumes a count left idle
      // (SESSION_STALE) without losing the box being confirmed.
      let r: { session: CountSessionView; resumed: boolean };
      try {
        r = await whPost<{ session: CountSessionView; resumed: boolean }>(`batches/${batch.id}/sessions`, { locationId: session.locationId, takeOver: false });
      } catch (err) {
        // The count was taken over on another desk meanwhile: taking it back is an explicit choice.
        if (isWhError(err) && err.code === "SESSION_CONFLICT" && (err.details?.takeOver || err.details?.stationId)) {
          setTakeover({ location: res.location, message: err.message });
          flow.notify("warn", err.message);
          return;
        }
        throw err;
      }
      setSession(r.session);
      setLevel(res.location);
      flow.notify(
        ident.step === "none" ? "ok" : "warn",
        `Comptage repris sur ${session.locationShortCode}.`,
        ident.step === "ready" ? "Confirmez la boîte en cours (Entrée)." : ident.step === "none" ? "Scannez le code-barres d'une boîte." : "Choisissez la variante de la boîte en cours."
      );
      return;
    }

    if (ident.step !== "none") {
      // A confirmation (or a choice) is pending: a second read never creates anything.
      const same = res.kind === "GTIN" && res.resolution.gtin === identGtin(ident);
      flow.notify(
        "warn",
        same ? "Boîte déjà lue : confirmez avec Entrée ou le bouton. Rien n'a été créé." : "Une boîte est en cours : confirmez-la ou annulez-la (Échap) avant de scanner autre chose.",
        same ? "Dix boîtes identiques = dix scans et dix confirmations." : undefined
      );
      return;
    }

    switch (res.kind) {
      case "EMPTY":
        return;
      case "LOCATION": {
        const loc = res.location;
        if (stockTake) {
          if (!session) return openLevel(loc, false);
          flow.notify("warn", `Niveau ${session.locationShortCode} en cours : terminez-le avant d'ouvrir ${loc.shortCode}.`);
          return;
        }
        if (TEMP_KINDS.includes(loc.kind) && loc.status === "ACTIVE") {
          setDestination(loc);
          flow.notify("ok", `Les prochaines boîtes seront posées sur ${loc.code}.`);
        } else flow.notify("error", `${loc.code} n'est pas une zone de réception ni un chariot actif. Le rayon vient au rangement.`);
        return;
      }
      case "GTIN": {
        if (stockTake && !session) {
          flow.notify("error", "Scannez d'abord le niveau où se trouve cette boîte.");
          return;
        }
        if (res.resolution.status === "PACKAGING") {
          // Carton / inner-pack code: never one box.
          flow.notify("error", res.resolution.message, res.resolution.containedGtin ? `Code lu : ${res.resolution.gtin} · code probable de la boîte : ${res.resolution.containedGtin}` : `Code lu : ${res.resolution.gtin}`);
          return;
        }
        const next = identFromGtin(res.resolution);
        setIdent(next);
        setOptions(DEFAULT_BOX_OPTIONS);
        const bad = res.resolution.checksumValid ? "" : " Clé de contrôle du code-barres invalide : vérifiez la lecture.";
        if (next.step === "ready") flow.notify("warn", `Variante identifiée : vérifiez, puis confirmez.${bad}`);
        else if (next.step === "unknown") flow.notify("warn", `Code-barres inconnu (${res.resolution.gtin}) : identifiez la boîte.${bad}`);
        else flow.notify("warn", `Plusieurs variantes possibles : choisissez la bonne.${bad}`);
        return;
      }
      case "UNIT": {
        if (stockTake) {
          if (!session) {
            flow.notify("error", "Scannez d'abord le niveau où se trouve cette paire.");
            return;
          }
          return scanExistingUnit(res.unit, {}, newOpKey("stu"));
        }
        // A pair that is not waiting in this batch (already shelved, sold, missing, or received in
        // another batch) is not "a label to verify": show where the system holds it and send the
        // operator to the pair, where a move is an explicit, audited gesture (A33).
        const u = res.unit;
        const waitingHere = u.originBatchId === batch.id && u.presence === "PRESENT" && (u.currentLocationKind === null || TEMP_KINDS.includes(u.currentLocationKind));
        if (!waitingHere) {
          const where =
            u.presence === "PRESENT"
              ? `enregistrée sur ${u.currentLocationShortCode ?? u.currentLocationCode ?? "un emplacement inconnu"}`
              : u.presence === "MISSING"
                ? "déclarée introuvable"
                : u.presence === "OUT"
                  ? "déjà sortie du stock"
                  : "en transfert";
          flow.notify(
            "warn",
            `Paire ${u.shortRef} déjà connue : ${where}${u.originBatchId !== batch.id ? ", reçue dans un autre lot" : ""}. Rien n'a été modifié.`,
            <>
              {itemTitle(u.itemBrand, u.itemName)} · {u.itemSizeLabel ?? "—"} ·{" "}
              <Link className="underline" href={`/warehouse/stock/${u.id}`}>
                Ouvrir la paire pour la déplacer ou corriger son état
              </Link>
            </>
          );
          return;
        }
        // Receiving: scanning back the freshly stuck label proves it is readable.
        const r = await gesture.send(`units/${res.unit.id}/confirm-label`, {}, `Vérification de l'étiquette ${res.unit.shortRef}`, { prefix: "lbl", opKey: newOpKey("lbl"), extra: { kind: "label" } });
        if (r) {
          flow.notify("ok", `Étiquette ${res.unit.shortRef} lue et vérifiée.`, `${itemTitle(res.unit.itemBrand, res.unit.itemName)} · ${res.unit.itemSizeLabel ?? "—"}`);
          onChanged();
        }
        return;
      }
      case "EXTERNAL_REF_AMBIGUOUS":
      case "MANGLED_NUMBER":
      case "UNIT_CODE_UNKNOWN":
      case "LOCATION_UNKNOWN":
      case "EXTERNAL_REF_UNKNOWN":
      case "UNKNOWN":
        flow.notify("error", res.hint, `Code lu : ${code}`);
        return;
    }
  }

  // ----- the single confirmation -----

  const confirmBox = () =>
    flow.run(async () => {
      if (ident.step !== "ready" || gesture.pending || readOnly) return;
      if (stockTake && !session) return;
      const label = identLabel(ident);
      const item = await materializeItem(ident);
      setIdent({ step: "ready", gtin: ident.gtin, item, candidate: null });
      const common = { itemId: item.id, condition: options.condition, boxCondition: options.boxCondition, boxProfile: options.boxProfile, print: true };
      const r = stockTake
        ? await gesture.send(`sessions/${session!.id}/create-unit`, { ...common, ownerUncertain: options.flag }, `Création : ${label} sur ${session!.locationShortCode}`, {
            prefix: "stc",
            opKey: newOpKey("stc"),
            extra: { kind: "create" },
          })
        : await gesture.send(`batches/${batch.id}/receive`, { ...common, hold: options.flag, locationId: destination?.id ?? null }, `Réception : ${label}`, {
            prefix: "rcv",
            opKey: newOpKey("rcv"),
            extra: { kind: "create" },
          });
      if (!r) return;
      applyCreated(r as StockTakeCreateResult | ReceiveUnitResult, flow.notify);
      if (stockTake && session) await refreshSession(session.id);
    });

  const cancelBox = () => {
    if (flow.busy || ident.step === "none") return;
    setIdent(NO_IDENT);
    setOptions(DEFAULT_BOX_OPTIONS);
    flow.notify("info", "Boîte annulée : rien n'a été créé.");
  };

  // ----- render -----

  const step: 1 | 2 | 3 = !stockTake ? 2 : !session ? 1 : 2;
  const prompt = gesture.pending
    ? "Vérifiez l'action en attente"
    : stockTake && !session
      ? "Scannez un niveau"
      : ident.step === "ready"
        ? "Confirmez la boîte"
        : ident.step !== "none"
          ? "Choisissez la variante"
          : "Scannez le code-barres de la boîte";
  const capacity = level?.capacity ?? null;
  const noStation = !station || !stationValid;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
        {stockTake ? <StepPills step={step} /> : null}

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <ScanInput
            prompt={prompt}
            busy={flow.busy}
            disabled={readOnly}
            onScan={flow.submit}
            onEmptyEnter={() => {
              if (ident.step === "ready") void confirmBox();
            }}
            onEscape={cancelBox}
            hint={
              stockTake && !session
                ? "Code du niveau, par exemple CH01-A-R01-T01-N01."
                : ident.step === "none"
                  ? "Code-barres de la boîte (GTIN). Une boîte = un scan = une confirmation."
                  : "Entrée confirme, Échap annule."
            }
            right={
              (!stockTake || session) && ident.step === "none" ? (
                <Btn size="md" disabled={flow.busy || readOnly || Boolean(gesture.pending)} onClick={() => setIdent({ step: "unknown", gtin: null, checksumValid: true })}>
                  Boîte sans code-barres
                </Btn>
              ) : undefined
            }
          />
        </div>

        <FeedbackBanner feedback={flow.feedback} />
        <PendingGestureCard gesture={gesture} />
        {noStation ? (
          <Notice tone="amber">
            Ce navigateur n'est pas appairé à un poste : les étiquettes ne partent pas à l'imprimante. Chaque paire propose « Ouvrir le PDF ».{" "}
            <Link href="/warehouse/stations" className="font-semibold underline">
              Appairer ce poste
            </Link>
          </Notice>
        ) : null}

        <IdentifyPanel
          ident={ident}
          busy={flow.busy}
          onCancel={cancelBox}
          onPick={(next) => {
            setIdent(next);
            if (next.step === "ready") flow.notify("warn", "Variante choisie : vérifiez, puis confirmez.");
          }}
        />
        <ConfirmBoxCard
          ident={ident}
          options={options}
          onOptions={setOptions}
          flagLabel={stockTake ? "Propriétaire incertain" : "Mettre de côté (contrôle)"}
          confirmLabel="Créer la paire et imprimer"
          onConfirm={() => void confirmBox()}
          onCancel={cancelBox}
          busy={flow.busy}
          disabled={Boolean(gesture.pending) || readOnly}
          disabledReason={gesture.pending ? "Une action attend d'être vérifiée." : undefined}
        />

        {closeSummary ? (
          <Card
            title={`Résumé du niveau ${closeSummary.locationCode}`}
            subtitle={`Comptage n° ${closeSummary.round}`}
            actions={
              <Btn size="sm" onClick={() => setCloseSummary(null)}>
                Masquer
              </Btn>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ["Comptées", closeSummary.counted],
                  ["Créées", closeSummary.created],
                  ["Retrouvées ici", closeSummary.foundHere],
                  ["Déplacées ici", closeSummary.movedHere],
                ] as [string, number][]
              ).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                  <div className="text-xs text-slate-500 dark:text-slate-400">{k}</div>
                  <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{v}</div>
                </div>
              ))}
            </div>
            {closeSummary.notScanned.length > 0 ? (
              <Notice tone="amber" className="mt-3">
                <div className="font-semibold">{closeSummary.notScanned.length} paire(s) enregistrée(s) sur ce niveau n'ont pas été scannées.</div>
                <div className="mt-1">À recompter, ou à déclarer introuvables depuis leur fiche. Rien n'a été modifié automatiquement.</div>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {closeSummary.notScanned.map((u) => (
                    <li key={u.unitId}>
                      <Link href={`/warehouse/stock/${u.unitId}`} className="font-mono text-xs underline">
                        {u.labelCode.slice(0, 8).toUpperCase()}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            {closeSummary.movementsDuringCount > 0 ? (
              <Notice tone="amber" className="mt-3">
                {closeSummary.movementsDuringCount} mouvement(s) ont eu lieu sur ce niveau pendant le comptage : un recomptage est conseillé.
              </Notice>
            ) : null}
            {closeSummary.exceptionId ? (
              <p className="mt-3 text-sm">
                <Link href="/warehouse/exceptions" className="font-medium text-[#0A7A2C] underline dark:text-emerald-400">
                  Un écart de comptage a été ouvert
                </Link>
              </p>
            ) : null}
            <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">Scannez le niveau suivant pour continuer.</p>
          </Card>
        ) : null}

        {recent.length > 0 ? (
          <Card title="Dernières paires créées" subtitle="Depuis l'ouverture de cet écran" flush>
            <ul className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
              {recent.map((e) => (
                <li key={e.unit.id}>
                  <UnitLine
                    unit={e.unit}
                    right={
                      <>
                        {e.print?.status === "QUEUED" ? <Chip tone="green">Étiquette en file</Chip> : <Chip tone="amber">Étiquette à imprimer</Chip>}
                        <a
                          href={`/api/warehouse/units/${e.unit.id}/label?format=pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          PDF
                        </a>
                      </>
                    }
                  />
                  {e.note ? <div className="pb-2 pl-14 text-xs text-slate-500 dark:text-slate-400">{e.note}</div> : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      {/* Side panel */}
      <div className="space-y-3">
        {stockTake ? (
          session ? (
            <Card title="Niveau en cours">
              <div className="font-mono text-5xl font-bold leading-none tracking-tight text-slate-900 dark:text-slate-100">{session.locationShortCode}</div>
              <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">{session.locationCode}</div>
              <div className="mt-4 flex items-end justify-between gap-2">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Comptées dans ce comptage</div>
                  <div className="text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{session.countedUnits}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Sur le niveau / capacité</div>
                  <div className={cx("text-3xl font-semibold tabular-nums", capacity !== null && (level?.occupiedCount ?? 0) > capacity ? "text-red-600" : "text-slate-900 dark:text-slate-100")}>
                    {level?.occupiedCount ?? "—"}
                    <span className="text-lg text-slate-400"> / {capacity ?? "∞"}</span>
                  </div>
                </div>
              </div>
              {level ? <OccupancyBar className="mt-2" occupied={level.occupiedCount} reserved={level.reservedCount} capacity={level.capacity} /> : null}
              {capacity !== null && level && level.occupiedCount > capacity ? (
                <Notice tone="red" className="mt-2">
                  Plus de paires que la capacité déclarée : un écart est ouvert, le comptage continue.
                </Notice>
              ) : null}
              <Btn variant="secondary" size="lg" className="mt-4 w-full" disabled={flow.busy || readOnly || Boolean(gesture.pending)} onClick={() => void closeLevel()}>
                Terminer ce niveau
              </Btn>
            </Card>
          ) : (
            <Card title="Aucun niveau ouvert">
              <p className="text-sm text-slate-600 dark:text-slate-300">Placez-vous devant un niveau et scannez son étiquette. Les boîtes scannées ensuite seront enregistrées à cette adresse.</p>
            </Card>
          )
        ) : (
          <Card title="Les boîtes sont posées sur">
            <div className="font-mono text-3xl font-bold leading-none text-slate-900 dark:text-slate-100">{destination?.code ?? batch.receivingLocationCode ?? "—"}</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {destination ? `${LOCATION_KIND_LABELS[destination.kind] ?? destination.kind} choisi pour cette session` : "Position du lot"}. Scannez un autre chariot ou une zone pour en changer.
            </div>
            {destination ? (
              <Btn size="sm" className="mt-3" onClick={() => setDestination(null)}>
                Revenir à {batch.receivingLocationCode}
              </Btn>
            ) : null}
          </Card>
        )}

        {stockTake && session ? (
          <>
            <Card title={`Scannées (${session.scans.length})`} flush>
              {session.scans.length === 0 ? (
                <p className="px-4 py-4 text-sm text-slate-500 dark:text-slate-400">Aucune boîte pour l'instant.</p>
              ) : (
                <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto px-4 dark:divide-slate-800">
                  {session.scans.map((s) => (
                    <li key={s.unitId}>
                      <UnitLine unit={s.unit} right={<Chip tone={s.result === "CREATED" ? "green" : "blue"}>{s.result === "CREATED" ? "Créée" : s.result === "FOUND_HERE" ? "Retrouvée" : "Déplacée ici"}</Chip>} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {session.notYetScanned.length > 0 ? (
              <Card title={`Enregistrées ici, pas encore scannées (${session.notYetScanned.length})`} subtitle="Scannez leur étiquette si elles sont bien là." flush>
                <ul className="max-h-[320px] divide-y divide-slate-100 overflow-y-auto px-4 dark:divide-slate-800">
                  {session.notYetScanned.map((u) => (
                    <li key={u.id}>
                      <UnitLine unit={u} />
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        ) : null}
      </div>

      <Modal
        open={Boolean(takeover)}
        tone="amber"
        title="Niveau déjà en cours de comptage"
        onClose={() => setTakeover(null)}
        footer={
          <>
            <Btn size="lg" onClick={() => setTakeover(null)}>
              Annuler
            </Btn>
            <Btn
              variant="warn"
              size="lg"
              busy={flow.busy}
              onClick={() => {
                const t = takeover;
                if (t) void flow.run(() => openLevel(t.location, true));
              }}
            >
              Reprendre ce niveau
            </Btn>
          </>
        }
      >
        <p className="text-base text-slate-800 dark:text-slate-100">{takeover?.message}</p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Reprenez ce niveau uniquement si l'autre poste a arrêté de le compter. Les boîtes déjà scannées restent comptées.</p>
      </Modal>

      <Modal
        open={Boolean(unitConfirm)}
        tone="amber"
        title={unitConfirm?.confirm === "acknowledgeOwner" ? "Paire d'un autre propriétaire" : "Paire enregistrée ailleurs"}
        onClose={() => {
          setUnitConfirm(null);
          flow.notify("info", "Scan annulé : rien n'a été modifié.");
        }}
        footer={
          <>
            <Btn
              size="lg"
              onClick={() => {
                setUnitConfirm(null);
                flow.notify("info", "Scan annulé : rien n'a été modifié.");
              }}
            >
              Annuler
            </Btn>
            <Btn
              variant="warn"
              size="lg"
              busy={flow.busy}
              onClick={() => {
                const c = unitConfirm;
                if (c) void flow.run(() => scanExistingUnit(c.unit, { ...c.flags, [c.confirm]: true }, c.opKey));
              }}
            >
              {unitConfirm?.confirm === "acknowledgeOwner" ? "Compter quand même" : "Oui, elle est ici"}
            </Btn>
          </>
        }
      >
        {unitConfirm ? (
          <>
            <UnitLine unit={unitConfirm.unit} link={false} />
            <p className="mt-2 text-base text-slate-800 dark:text-slate-100">{unitConfirm.message}</p>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
