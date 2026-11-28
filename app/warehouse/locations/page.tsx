"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { CounterDrift, SiteStructure } from "@/lib/warehouse/locations";
import type { PrintOutcome } from "@/lib/warehouse/printing";
import type { LocationSummary, UnitSummary } from "@/lib/warehouse/types";
import { errorMessage, newOpKey, whGet, whPatch, whPost, whUrl } from "../_lib/api";
import { useWarehouse } from "../_lib/context";
import { LOCATION_KIND_LABELS, LOCATION_STATUS, plural } from "../_lib/format";
import { useLoad } from "../_lib/hooks";
import CsvImport from "../_components/CsvImport";
import { UnitChips, UnitLine } from "../_components/units";
import { Btn, Card, Chip, Drawer, EmptyState, ErrorNote, Field, KpiTile, Loading, Modal, Notice, OccupancyBar, PageHeader, Td, Th, cx, inputCls, rowCls, tableCls, theadCls } from "../_components/ui";

type RowKey = { sector: string; rowNo: number };
type Tool = "generate" | "special" | "import" | "reconcile" | null;
type Flash = { tone: "green" | "red" | "amber"; text: string } | null;

const pad2 = (n: number) => String(n).padStart(2, "0");
const SPECIAL_KINDS = ["RECEIVING", "CART", "PACKING", "RETURNS", "QUARANTINE"] as const;

// ───────────── level drawer ─────────────

function LocationDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { isAdmin, readOnly, station, stationValid } = useWarehouse();
  const detail = useLoad<{ location: LocationSummary; units: UnitSummary[]; hasMore: boolean }>(() => whGet(`locations/${id}`), [id], { enabled: Boolean(id) });
  const [capacity, setCapacity] = useState("");
  const [reason, setReason] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newShort, setNewShort] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  const loc = detail.data && detail.data.location.id === id ? detail.data.location : null;
  useEffect(() => {
    if (loc) {
      setCapacity(loc.capacity === null ? "" : String(loc.capacity));
      setNewCode(loc.code);
      setNewShort(loc.shortCode);
    }
    setReason("");
    setRenaming(false);
    setFlash(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc?.id]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    setFlash(null);
    try {
      await fn();
      if (ok) setFlash({ tone: "green", text: ok });
      await detail.reload();
      onChanged();
    } catch (err) {
      setFlash({ tone: "red", text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (status: "ACTIVE" | "BLOCKED" | "RETIRED") => {
    if (!loc) return;
    if (status !== "ACTIVE" && reason.trim().length < 3) {
      setFlash({ tone: "amber", text: "Indiquez le motif avant de bloquer ou de retirer cet emplacement." });
      return;
    }
    if (status === "RETIRED" && !window.confirm(`Retirer ${loc.code} ? Il ne recevra plus de paires. Son code reste lisible.`)) return;
    void run(`status-${status}`, () => whPost(`locations/${loc.id}/status`, { status, reason: reason.trim() || null }), status === "ACTIVE" ? "Emplacement débloqué." : status === "BLOCKED" ? "Emplacement bloqué : ses places réservées sont libérées." : "Emplacement retiré.");
  };

  const printLabel = () => {
    if (!loc) return;
    void run("print", async () => {
      const r = await whPost<{ queued: number; notQueued: number; jobs: PrintOutcome[] }>("locations/print-labels", { opKey: newOpKey("loc"), locationIds: [loc.id] });
      const first = r.jobs[0];
      setFlash(r.queued > 0 ? { tone: "green", text: `Étiquette envoyée sur ${first?.status === "QUEUED" ? first.printerName ?? "l'imprimante du poste" : "le poste"}.` } : { tone: "amber", text: first && first.status === "NOT_QUEUED" ? first.message : "Étiquette non envoyée : ouvrez le PDF." });
    });
  };

  const st = loc ? LOCATION_STATUS[loc.status] ?? { label: loc.status, tone: "slate" as const } : null;

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      title={
        loc ? (
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-2xl font-bold tracking-tight">{loc.shortCode}</span>
            <span className="font-mono text-xs font-normal text-slate-500">{loc.code}</span>
          </span>
        ) : (
          "Emplacement"
        )
      }
    >
      {!loc ? (
        detail.loading ? (
          <Loading />
        ) : (
          <ErrorNote error={detail.error} onRetry={() => void detail.reload()} />
        )
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Chip>{LOCATION_KIND_LABELS[loc.kind] ?? loc.kind}</Chip>
            {st ? <Chip tone={st.tone}>{st.label}</Chip> : null}
            {loc.statusReason ? <span className="text-xs text-slate-500">{loc.statusReason}</span> : null}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <div className="text-xs text-slate-500 dark:text-slate-400">Occupées</div>
              <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{loc.occupiedCount}</div>
            </div>
            <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <div className="text-xs text-slate-500 dark:text-slate-400">Réservées</div>
              <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{loc.reservedCount}</div>
            </div>
            <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <div className="text-xs text-slate-500 dark:text-slate-400">Capacité</div>
              <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{loc.capacity ?? "∞"}</div>
            </div>
          </div>
          <OccupancyBar occupied={loc.occupiedCount} reserved={loc.reservedCount} capacity={loc.capacity} />
          {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}

          <div className="flex flex-wrap gap-2">
            <Btn busy={busy === "print"} disabled={readOnly} onClick={printLabel} title={station && stationValid ? undefined : "Ce navigateur n'est pas appairé : utilisez le PDF."}>
              Imprimer l'étiquette
            </Btn>
            <a
              href={whUrl("locations/labels", { ids: loc.id, format: "pdf" })}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Ouvrir le PDF
            </a>
            <Link
              href={`/warehouse/stock?locationId=${loc.id}&tab=present`}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Voir dans le stock
            </Link>
          </div>

          {loc.status !== "RETIRED" ? (
            <section className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Bloquer, débloquer</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Un emplacement bloqué ne reçoit plus de rangement proposé. Les paires déjà dedans ne bougent pas.</p>
              {loc.status === "ACTIVE" ? (
                <Field label="Motif (obligatoire pour bloquer ou retirer)" className="mt-2">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="ex. étagère abîmée, zone en travaux" />
                </Field>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {loc.status === "ACTIVE" ? (
                  <Btn variant="warn" busy={busy === "status-BLOCKED"} disabled={readOnly} onClick={() => setStatus("BLOCKED")}>
                    Bloquer
                  </Btn>
                ) : (
                  <Btn variant="primary" busy={busy === "status-ACTIVE"} disabled={readOnly} onClick={() => setStatus("ACTIVE")}>
                    Débloquer
                  </Btn>
                )}
                {isAdmin ? (
                  <Btn variant="ghost" busy={busy === "status-RETIRED"} disabled={readOnly} onClick={() => setStatus("RETIRED")}>
                    Retirer définitivement
                  </Btn>
                ) : null}
              </div>
              {loc.status === "BLOCKED" && isAdmin ? (
                <Field label="Motif du retrait" className="mt-3">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
                </Field>
              ) : null}
            </section>
          ) : isAdmin ? (
            <Btn busy={busy === "status-ACTIVE"} disabled={readOnly} onClick={() => setStatus("ACTIVE")}>
              Remettre en service
            </Btn>
          ) : null}

          {isAdmin ? (
            <section className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Capacité</h3>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Field label="Nombre de paires (vide = sans limite)">
                  <input inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/[^0-9]/g, ""))} className={inputCls + " w-40 tabular-nums"} />
                </Field>
                <Btn
                  busy={busy === "capacity"}
                  disabled={readOnly || capacity === (loc.capacity === null ? "" : String(loc.capacity))}
                  onClick={() => void run("capacity", () => whPatch(`locations/${loc.id}`, { capacity: capacity === "" ? null : Number(capacity) }), "Capacité enregistrée.")}
                >
                  Enregistrer
                </Btn>
              </div>
              {capacity !== "" && Number(capacity) < loc.occupiedCount + loc.reservedCount ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Inférieure aux paires déjà présentes ou réservées : aucun nouveau rangement n'y sera proposé.</p>
              ) : null}

              {loc.kind === "LEVEL" ? (
                <>
                  <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">Format de boîte accepté</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(
                      [
                        ["STANDARD", "Standard"],
                        ["LARGE", "Grande"],
                        ["ANY", "Tous formats"],
                      ] as const
                    ).map(([value, label]) => (
                      <Btn
                        key={value}
                        size="sm"
                        variant={loc.sizeProfile === value ? "primary" : "secondary"}
                        busy={busy === `profile-${value}`}
                        disabled={readOnly || loc.sizeProfile === value}
                        onClick={() => void run(`profile-${value}`, () => whPatch(`locations/${loc.id}`, { sizeProfile: value }), "Format enregistré.")}
                      >
                        {label}
                      </Btn>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Une boîte d'un autre format n'y est rangée qu'après confirmation explicite au rangement.</p>
                </>
              ) : null}

              <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">Code</h3>
              {!renaming ? (
                <Btn size="sm" className="mt-2" disabled={readOnly} onClick={() => setRenaming(true)}>
                  Renommer
                </Btn>
              ) : (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400">L'ancien code reste lisible par la douchette (alias). Une nouvelle étiquette est à coller.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Nouveau code">
                      <input value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} className={inputCls + " font-mono"} />
                    </Field>
                    <Field label="Code court">
                      <input value={newShort} onChange={(e) => setNewShort(e.target.value.toUpperCase())} className={inputCls + " font-mono"} />
                    </Field>
                  </div>
                  <div className="flex gap-2">
                    <Btn
                      variant="primary"
                      busy={busy === "rename"}
                      disabled={readOnly || !newCode.trim() || (newCode.trim() === loc.code && newShort.trim() === loc.shortCode)}
                      onClick={() => void run("rename", () => whPost(`locations/${loc.id}/rename`, { newCode: newCode.trim(), newShortCode: newShort.trim() || undefined }), "Emplacement renommé.")}
                    >
                      Renommer
                    </Btn>
                    <Btn onClick={() => setRenaming(false)}>Annuler</Btn>
                  </div>
                </div>
              )}
            </section>
          ) : null}

          <section>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Paires présentes ({detail.data?.units.length ?? 0}
              {detail.data?.hasMore ? "+" : ""})
            </h3>
            {detail.data && detail.data.units.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Aucune paire enregistrée ici.</p>
            ) : (
              <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
                {(detail.data?.units ?? []).map((u) => (
                  <li key={u.id}>
                    <UnitLine unit={u} right={<UnitChips unit={u} />} />
                  </li>
                ))}
              </ul>
            )}
            {detail.data?.hasMore ? <p className="mt-2 text-xs text-slate-500">Liste limitée aux 200 premières : ouvrez le stock pour tout voir.</p> : null}
          </section>
        </div>
      )}
    </Drawer>
  );
}

// ───────────── admin tools ─────────────

function GenerateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { siteId, site } = useWarehouse();
  const [f, setF] = useState({ sector: "A", rowFrom: "1", rowTo: "1", racksPerRow: "4", levelsPerRack: "5", capacityPerLevel: "12", serpentine: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number; levelCodes: string[] } | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setResult(null);
    }
  }, [open]);

  const n = (v: string) => (/^[0-9]+$/.test(v) ? Number(v) : NaN);
  const rowFrom = n(f.rowFrom);
  const rowTo = n(f.rowTo);
  const racks = n(f.racksPerRow);
  const levels = n(f.levelsPerRack);
  const cap = n(f.capacityPerLevel);
  const sector = f.sector.trim().toUpperCase();
  const problems: string[] = [];
  if (!/^[A-Z0-9]{1,4}$/.test(sector)) problems.push("Secteur : 1 à 4 lettres ou chiffres.");
  if (!(rowFrom >= 1 && rowTo >= rowFrom && rowTo <= 99)) problems.push("Rangées : de 1 à 99, la dernière après la première.");
  if (!(racks >= 1 && racks <= 99)) problems.push("Racks par rangée : 1 à 99.");
  if (!(levels >= 1 && levels <= 20)) problems.push("Niveaux par rack : 1 à 20.");
  if (!(cap >= 0)) problems.push("Capacité par niveau : entier positif.");
  const total = problems.length ? 0 : (rowTo - rowFrom + 1) * racks * levels;
  if (total > 20000) problems.push("20 000 niveaux au maximum par génération.");
  const code = (row: number, rack: number, level: number) => `${site?.code ?? "SITE"}-${sector}-R${pad2(row)}-T${pad2(rack)}-N${pad2(level)}`;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await whPost<{ created: number; skipped: number; levelCodes: string[] }>(
        "locations/generate",
        { siteId, sector, rowFrom, rowTo, racksPerRow: racks, levelsPerRack: levels, capacityPerLevel: cap, serpentine: f.serpentine },
        { timeoutMs: 180_000 }
      );
      setResult(r);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const num = (key: "rowFrom" | "rowTo" | "racksPerRow" | "levelsPerRack" | "capacityPerLevel", label: string) => (
    <Field label={label}>
      <input inputMode="numeric" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value.replace(/[^0-9]/g, "") })} className={inputCls + " tabular-nums"} />
    </Field>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Générer des racks"
      footer={
        result ? (
          <Btn variant="primary" onClick={onClose}>
            Fermer
          </Btn>
        ) : (
          <>
            <Btn onClick={onClose}>Annuler</Btn>
            <Btn variant="primary" busy={busy} disabled={problems.length > 0} onClick={() => void submit()}>
              Créer {total > 0 ? plural(total, "niveau", "niveaux") : ""}
            </Btn>
          </>
        )
      }
    >
      {result ? (
        <Notice tone="green">
          <div className="font-semibold">
            {result.created} emplacement(s) créé(s), {result.skipped} déjà existant(s).
          </div>
          <div className="mt-1">Sélectionnez ensuite les niveaux pour imprimer leurs étiquettes.</div>
        </Notice>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Secteur">
              <input value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value.toUpperCase() })} className={inputCls + " font-mono"} maxLength={4} />
            </Field>
            {num("rowFrom", "Première rangée")}
            {num("rowTo", "Dernière rangée")}
            {num("racksPerRow", "Racks par rangée")}
            {num("levelsPerRack", "Niveaux par rack")}
            {num("capacityPerLevel", "Paires par niveau")}
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" className="h-5 w-5" checked={f.serpentine} onChange={(e) => setF({ ...f, serpentine: e.target.checked })} />
            Ordre de marche en serpentin (les rangées paires se parcourent en sens inverse)
          </label>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Aperçu</div>
            {problems.length > 0 ? (
              <ul className="mt-1 list-inside list-disc text-sm text-amber-700 dark:text-amber-400">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <div className="mt-1 grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{total.toLocaleString("fr-CH")}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    niveaux · {(total * cap).toLocaleString("fr-CH")} places
                  </div>
                </div>
                <div>
                  <div className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{code(rowFrom, 1, 1)}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">premier code</div>
                </div>
                <div>
                  <div className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{code(rowTo, racks, levels)}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">dernier code</div>
                </div>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Relancer la même génération n'ajoute que ce qui manque : aucun niveau existant n'est modifié.</p>
          {error ? <Notice tone="red">{error}</Notice> : null}
        </div>
      )}
    </Modal>
  );
}

function SpecialModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { siteId } = useWarehouse();
  const [kind, setKind] = useState<(typeof SPECIAL_KINDS)[number]>("CART");
  const [number, setNumber] = useState("");
  const [capacity, setCapacity] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await whPost("locations/special", { siteId, kind, number: number ? Number(number) : undefined, capacity: capacity ? Number(capacity) : null, label: label.trim() || undefined });
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajouter une zone"
      footer={
        <>
          <Btn onClick={onClose}>Annuler</Btn>
          <Btn variant="primary" busy={busy} onClick={() => void submit()}>
            Créer la zone
          </Btn>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" className="sm:col-span-2">
          <select value={kind} onChange={(e) => setKind(e.target.value as (typeof SPECIAL_KINDS)[number])} className={inputCls}>
            {SPECIAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {LOCATION_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Numéro (facultatif)" hint="Vide = numéro suivant.">
          <input inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/[^0-9]/g, ""))} className={inputCls + " tabular-nums"} />
        </Field>
        <Field label="Capacité (facultatif)" hint="Vide = sans limite.">
          <input inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/[^0-9]/g, ""))} className={inputCls + " tabular-nums"} />
        </Field>
        <Field label="Libellé (facultatif)" className="sm:col-span-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
        </Field>
      </div>
      {error ? (
        <Notice tone="red" className="mt-3">
          {error}
        </Notice>
      ) : null}
    </Modal>
  );
}

function ReconcileModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { siteId, readOnly } = useWarehouse();
  const [data, setData] = useState<{ checked: number; drifts: CounterDrift[]; fixed: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (fix: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const r = await whPost<{ checked: number; drifts: CounterDrift[]; fixed: number }>("locations/reconcile", { siteId, fix }, { timeoutMs: 120_000 });
        setData(r);
        if (fix) onDone();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [siteId, onDone]
  );

  useEffect(() => {
    if (open) {
      setData(null);
      void run(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Vérifier les compteurs"
      footer={
        <>
          <Btn onClick={onClose}>Fermer</Btn>
          {data && data.drifts.length > 0 && data.fixed === 0 ? (
            <Btn variant="primary" busy={busy} disabled={readOnly} onClick={() => void run(true)}>
              Corriger {plural(data.drifts.length, "compteur", "compteurs")}
            </Btn>
          ) : null}
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">Compare les compteurs « occupées / réservées » de chaque emplacement avec les paires et les rangements réellement enregistrés. Aucune paire n'est modifiée.</p>
      {error ? <Notice tone="red">{error}</Notice> : null}
      {!data ? (
        busy ? (
          <Loading label="Vérification…" />
        ) : null
      ) : data.fixed > 0 ? (
        <Notice tone="green">{data.fixed} compteur(s) corrigé(s) d'après la réalité enregistrée.</Notice>
      ) : data.drifts.length === 0 ? (
        <Notice tone="green">{data.checked} emplacement(s) vérifié(s) : tous les compteurs sont justes.</Notice>
      ) : (
        <>
          <Notice tone="amber" className="mb-3">
            {data.drifts.length} compteur(s) faux sur {data.checked} emplacement(s).
          </Notice>
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className={tableCls}>
              <thead className={theadCls + " sticky top-0"}>
                <tr>
                  <Th>Emplacement</Th>
                  <Th className="text-right">Occupées (compteur)</Th>
                  <Th className="text-right">Occupées (réel)</Th>
                  <Th className="text-right">Réservées (compteur)</Th>
                  <Th className="text-right">Réservées (réel)</Th>
                </tr>
              </thead>
              <tbody>
                {data.drifts.map((d) => (
                  <tr key={d.locationId} className={rowCls}>
                    <Td className="font-mono text-xs">{d.code}</Td>
                    <Td className="text-right tabular-nums">{d.occupiedCount}</Td>
                    <Td className="text-right font-semibold tabular-nums">{d.actualOccupied}</Td>
                    <Td className="text-right tabular-nums">{d.reservedCount}</Td>
                    <Td className="text-right font-semibold tabular-nums">{d.actualReserved}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

// ───────────── page ─────────────

function LocationsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { siteId, site, isAdmin, readOnly } = useWarehouse();
  const [row, setRow] = useState<RowKey | null>(null);
  const [levels, setLevels] = useState<LocationSummary[]>([]);
  const [levelsCursor, setLevelsCursor] = useState<string | null>(null);
  const [levelsLoading, setLevelsLoading] = useState(false);
  const [levelsError, setLevelsError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<string | null>(params.get("level"));
  const [tool, setTool] = useState<Tool>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [printBusy, setPrintBusy] = useState(false);

  const structure = useLoad<SiteStructure>(() => whGet<SiteStructure>("locations/structure", { siteId }), [siteId], { enabled: Boolean(siteId) });

  const levelParam = params.get("level");
  useEffect(() => {
    if (levelParam) setDrawer(levelParam);
  }, [levelParam]);

  useEffect(() => {
    setRow(null);
    setLevels([]);
    setSelected(new Set());
  }, [siteId]);

  const loadLevels = useCallback(
    async (key: RowKey, cursor: string | null) => {
      if (!siteId) return;
      setLevelsLoading(true);
      try {
        const res = await whGet<{ items: LocationSummary[]; nextCursor: string | null }>("locations", { siteId, kinds: "LEVEL", sector: key.sector, rowNo: key.rowNo, limit: 200, cursor });
        setLevels((prev) => (cursor ? [...prev, ...res.items] : res.items));
        setLevelsCursor(res.nextCursor);
        setLevelsError(null);
      } catch (err) {
        setLevelsError(err);
      } finally {
        setLevelsLoading(false);
      }
    },
    [siteId]
  );

  const openRow = (key: RowKey) => {
    setRow(key);
    setLevels([]);
    setSelected(new Set());
    void loadLevels(key, null);
  };

  const refresh = () => {
    void structure.reload();
    if (row) void loadLevels(row, null);
  };

  const closeDrawer = () => {
    setDrawer(null);
    if (levelParam) router.replace("/warehouse/locations");
  };

  const selectedIds = useMemo(() => [...selected], [selected]);
  const queueLabels = async () => {
    setPrintBusy(true);
    setFlash(null);
    try {
      const r = await whPost<{ queued: number; notQueued: number; jobs: PrintOutcome[] }>("locations/print-labels", { opKey: newOpKey("loc"), locationIds: selectedIds });
      const refused = r.jobs.find((j) => j.status === "NOT_QUEUED");
      setFlash(
        r.notQueued === 0
          ? { tone: "green", text: `${r.queued} étiquette(s) envoyée(s) à l'imprimante du poste.` }
          : { tone: "amber", text: `${r.queued} envoyée(s), ${r.notQueued} non envoyée(s). ${refused && refused.status === "NOT_QUEUED" ? refused.message : ""} Utilisez « Ouvrir le PDF ».` }
      );
    } catch (err) {
      setFlash({ tone: "red", text: errorMessage(err) });
    } finally {
      setPrintBusy(false);
    }
  };

  const s = structure.data;
  const allSelected = levels.length > 0 && levels.every((l) => selected.has(l.id));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Emplacements"
        subtitle={site ? `${site.code} · secteurs, rangées, racks, niveaux et zones` : undefined}
        actions={
          isAdmin ? (
            <>
              <Btn disabled={readOnly} onClick={() => setTool("generate")}>
                Générer des racks
              </Btn>
              <Btn disabled={readOnly} onClick={() => setTool("special")}>
                Ajouter une zone
              </Btn>
              <Btn disabled={readOnly} onClick={() => setTool("import")}>
                Importer un CSV
              </Btn>
              <Btn onClick={() => setTool("reconcile")}>Vérifier les compteurs</Btn>
            </>
          ) : undefined
        }
      />
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <ErrorNote error={structure.error} onRetry={() => void structure.reload()} />

      {!s ? (
        structure.loading ? (
          <Loading />
        ) : null
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiTile label="Niveaux" value={s.totals.levels.toLocaleString("fr-CH")} />
            <KpiTile label="Capacité" value={s.totals.capacity.toLocaleString("fr-CH")} sub="paires" />
            <KpiTile label="Occupées" value={s.totals.occupied.toLocaleString("fr-CH")} tone="green" />
            <KpiTile label="Réservées" value={s.totals.reserved.toLocaleString("fr-CH")} tone={s.totals.reserved > 0 ? "amber" : undefined} />
            <KpiTile label="Niveaux bloqués" value={s.totals.blocked.toLocaleString("fr-CH")} tone={s.totals.blocked > 0 ? "red" : undefined} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
            <div className="space-y-4">
              <Card title="Rayonnages" subtitle="Choisissez une rangée pour voir ses niveaux." flush>
                {s.sectors.length === 0 ? (
                  <EmptyState title="Aucun rayonnage">{isAdmin ? "Utilisez « Générer des racks » pour créer la structure." : "La structure n'est pas encore créée."}</EmptyState>
                ) : (
                  s.sectors.map((sec) => (
                    <div key={sec.sector} className="border-b border-slate-200 last:border-0 dark:border-slate-800">
                      <div className="flex items-baseline justify-between bg-slate-50 px-4 py-2 dark:bg-slate-800/50">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Secteur {sec.sector}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{plural(sec.rows.length, "rangée", "rangées")}</span>
                      </div>
                      <ul>
                        {sec.rows.map((r) => {
                          const active = row?.sector === sec.sector && row.rowNo === r.rowNo;
                          return (
                            <li key={r.rowNo}>
                              <button
                                type="button"
                                onClick={() => openRow({ sector: sec.sector, rowNo: r.rowNo })}
                                className={cx(
                                  "block w-full border-l-4 px-4 py-3 text-left transition",
                                  active ? "border-[#02C73A] bg-[#E6F9EB]/60 dark:bg-emerald-950/30" : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                )}
                              >
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100">
                                    {sec.sector}-{pad2(r.rowNo)}
                                  </span>
                                  <span className="text-sm tabular-nums text-slate-600 dark:text-slate-300">
                                    {r.occupied + r.reserved} / {r.capacity}
                                  </span>
                                </div>
                                <OccupancyBar className="mt-1.5" occupied={r.occupied} reserved={r.reserved} capacity={r.capacity} />
                                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                  {r.racks} racks · {r.levels} niveaux{r.reserved > 0 ? ` · ${r.reserved} réservée(s)` : ""}
                                  {r.blocked > 0 ? <span className="text-amber-700 dark:text-amber-400"> · {r.blocked} bloqué(s)</span> : null}
                                </div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))
                )}
              </Card>

              <Card title="Zones" subtitle="Réception, chariots, quarantaine…" flush>
                {s.special.length === 0 ? (
                  <EmptyState title="Aucune zone" />
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {s.special.map((z) => {
                      const st = LOCATION_STATUS[z.status] ?? { label: z.status, tone: "slate" as const };
                      return (
                        <li key={z.id}>
                          <button type="button" onClick={() => setDrawer(z.id)} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <span className="min-w-0 flex-1">
                              <span className="block font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">{z.code}</span>
                              <span className="block text-xs text-slate-500 dark:text-slate-400">{LOCATION_KIND_LABELS[z.kind] ?? z.kind}</span>
                            </span>
                            {z.status !== "ACTIVE" ? <Chip tone={st.tone}>{st.label}</Chip> : null}
                            <span className="text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                              {z.occupiedCount}
                              {z.capacity !== null ? <span className="text-sm font-normal text-slate-400"> / {z.capacity}</span> : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </div>

            <Card
              title={row ? `Rangée ${row.sector}-${pad2(row.rowNo)}` : "Niveaux"}
              subtitle={row ? `${levels.length} niveau(x) affiché(s)${selected.size ? ` · ${selected.size} sélectionné(s)` : ""}` : undefined}
              actions={
                row && selected.size > 0 ? (
                  <>
                    <Btn size="sm" variant="primary" busy={printBusy} disabled={readOnly} onClick={() => void queueLabels()}>
                      Imprimer les étiquettes ({selected.size})
                    </Btn>
                    <a
                      href={whUrl("locations/labels", { ids: selectedIds.slice(0, 500).join(","), format: "pdf" })}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-[36px] items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      Ouvrir le PDF
                    </a>
                  </>
                ) : undefined
              }
              flush
            >
              {!row ? (
                <EmptyState title="Choisissez une rangée">Chaque niveau affiche son code, sa capacité et son occupation.</EmptyState>
              ) : levels.length === 0 ? (
                levelsLoading ? (
                  <Loading />
                ) : levelsError ? (
                  <ErrorNote error={levelsError} className="m-3" onRetry={() => void loadLevels(row, null)} />
                ) : (
                  <EmptyState title="Aucun niveau dans cette rangée" />
                )
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className={tableCls}>
                      <thead className={theadCls}>
                        <tr>
                          <Th className="w-12">
                            <input
                              type="checkbox"
                              aria-label="Tout sélectionner"
                              className="h-5 w-5"
                              checked={allSelected}
                              onChange={(e) => setSelected(e.target.checked ? new Set(levels.map((l) => l.id)) : new Set())}
                            />
                          </Th>
                          <Th>Code court</Th>
                          <Th>Code</Th>
                          <Th className="text-right">Capacité</Th>
                          <Th className="text-right">Occupées</Th>
                          <Th className="text-right">Réservées</Th>
                          <Th className="w-40">Occupation</Th>
                          <Th>Statut</Th>
                          <Th />
                        </tr>
                      </thead>
                      <tbody>
                        {levels.map((l) => {
                          const st = LOCATION_STATUS[l.status] ?? { label: l.status, tone: "slate" as const };
                          return (
                            <tr key={l.id} className={rowCls + " hover:bg-slate-50/70 dark:hover:bg-slate-800/40"}>
                              <Td>
                                <input
                                  type="checkbox"
                                  aria-label={`Sélectionner ${l.shortCode}`}
                                  className="h-5 w-5"
                                  checked={selected.has(l.id)}
                                  onChange={(e) => {
                                    const next = new Set(selected);
                                    if (e.target.checked) next.add(l.id);
                                    else next.delete(l.id);
                                    setSelected(next);
                                  }}
                                />
                              </Td>
                              <Td className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100">{l.shortCode}</Td>
                              <Td className="font-mono text-xs text-slate-500">{l.code}</Td>
                              <Td className="text-right tabular-nums">{l.capacity ?? "∞"}</Td>
                              <Td className="text-right font-semibold tabular-nums">{l.occupiedCount}</Td>
                              <Td className="text-right tabular-nums">{l.reservedCount || "—"}</Td>
                              <Td>
                                <OccupancyBar occupied={l.occupiedCount} reserved={l.reservedCount} capacity={l.capacity} />
                              </Td>
                              <Td>
                                <Chip tone={st.tone} title={l.statusReason ?? undefined}>
                                  {st.label}
                                </Chip>
                              </Td>
                              <Td className="text-right">
                                <Btn size="sm" onClick={() => setDrawer(l.id)}>
                                  Ouvrir
                                </Btn>
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {levelsCursor ? (
                    <div className="flex justify-center border-t border-slate-200 p-3 dark:border-slate-800">
                      <Btn busy={levelsLoading} onClick={() => void loadLevels(row, levelsCursor)}>
                        Charger plus
                      </Btn>
                    </div>
                  ) : null}
                </>
              )}
            </Card>
          </div>
        </>
      )}

      <LocationDrawer id={drawer} onClose={closeDrawer} onChanged={refresh} />
      <GenerateModal open={tool === "generate"} onClose={() => setTool(null)} onDone={refresh} />
      <SpecialModal open={tool === "special"} onClose={() => setTool(null)} onDone={refresh} />
      <ReconcileModal open={tool === "reconcile"} onClose={() => setTool(null)} onDone={refresh} />
      <Modal open={tool === "import"} onClose={() => setTool(null)} wide title="Importer des emplacements (CSV)" footer={<Btn onClick={() => setTool(null)}>Fermer</Btn>}>
        {siteId ? (
          <CsvImport
            kind="LOCATIONS"
            targetId={siteId}
            disabled={readOnly}
            columns="secteur, rangée, rack (ou travée), niveau, capacité, profil (facultatif)"
            example={"secteur;rangee;rack;niveau;capacite\nB;1;1;1;12\nB;1;1;2;12"}
            onApplied={refresh}
          />
        ) : null}
      </Modal>
    </div>
  );
}

export default function LocationsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LocationsInner />
    </Suspense>
  );
}
