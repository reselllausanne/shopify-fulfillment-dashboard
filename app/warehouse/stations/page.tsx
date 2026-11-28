"use client";

import { useEffect, useMemo, useState } from "react";
import type { PrintJobRow, PrintOutcome, PrinterRow, StationRow } from "@/lib/warehouse/printing";
import { listQzPrinters } from "@/app/lib/printStationClient";
import { QZ_TRAY_DOWNLOAD_URL } from "@/lib/printStation";
import { errorMessage, newOpKey, whGet, whPatch, whPost, whUrl } from "../_lib/api";
import { useWarehouse } from "../_lib/context";
import { LABEL_KIND_LABELS, PRINT_STATUS, fmtAge, fmtDateTime } from "../_lib/format";
import { useLoad } from "../_lib/hooks";
import { Btn, Card, Chip, EmptyState, ErrorNote, Field, Loading, Modal, Notice, PageHeader, Tabs, Td, Th, inputCls, rowCls, tableCls, theadCls } from "../_components/ui";

type StationsData = { stations: StationRow[]; printers: PrinterRow[]; journal: { total: number; pendingExport: number; lastExportedAt: string | null; sink: string | null } };
type QueueTab = "queued" | "failed" | "uncertain" | "sent";
type Flash = { tone: "green" | "red" | "amber"; text: string } | null;

const ROUTED_KINDS = ["PAIR", "LOCATION"] as const;
const MEDIA_PRESETS = [
  { id: "pair", label: "50 × 30 mm (paire)", w: 50, h: 30 },
  { id: "location", label: "100 × 50 mm (emplacement)", w: 100, h: 50 },
  { id: "custom", label: "Autre format", w: 0, h: 0 },
];

// ───────────── printer form ─────────────

type PrinterDraft = {
  name: string;
  adapter: "QZ_TRAY" | "PDF_MANUAL";
  systemName: string;
  mediaWidthMm: string;
  mediaHeightMm: string;
  dpi: string;
  orientation: "landscape" | "portrait";
  marginMm: string;
  useDriverPaperSize: boolean;
  supportedKinds: string[];
};

const emptyDraft: PrinterDraft = { name: "", adapter: "QZ_TRAY", systemName: "", mediaWidthMm: "50", mediaHeightMm: "30", dpi: "203", orientation: "landscape", marginMm: "0", useDriverPaperSize: false, supportedKinds: ["PAIR"] };

function PrinterModal({ open, printer, siteId, onClose, onSaved }: { open: boolean; printer: PrinterRow | null; siteId: string; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<PrinterDraft>(emptyDraft);
  const [qzPrinters, setQzPrinters] = useState<string[] | null>(null);
  const [qzBusy, setQzBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setQzPrinters(null);
    setDraft(
      printer
        ? {
            name: printer.name,
            adapter: printer.adapter,
            systemName: printer.systemName ?? "",
            mediaWidthMm: String(printer.mediaWidthMm),
            mediaHeightMm: String(printer.mediaHeightMm),
            dpi: printer.dpi ? String(printer.dpi) : "",
            orientation: printer.orientation === "portrait" ? "portrait" : "landscape",
            marginMm: String(printer.marginMm ?? 0),
            useDriverPaperSize: printer.useDriverPaperSize,
            supportedKinds: printer.supportedKinds,
          }
        : emptyDraft
    );
  }, [open, printer]);

  const preset = MEDIA_PRESETS.find((p) => String(p.w) === draft.mediaWidthMm && String(p.h) === draft.mediaHeightMm)?.id ?? "custom";

  const loadQz = async () => {
    setQzBusy(true);
    try {
      setQzPrinters(await listQzPrinters());
    } finally {
      setQzBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      siteId,
      name: draft.name.trim(),
      adapter: draft.adapter,
      systemName: draft.adapter === "QZ_TRAY" ? draft.systemName.trim() : null,
      mediaWidthMm: Number(draft.mediaWidthMm.replace(",", ".")),
      mediaHeightMm: Number(draft.mediaHeightMm.replace(",", ".")),
      dpi: draft.dpi.trim() ? Number(draft.dpi) : null,
      orientation: draft.orientation,
      marginMm: Number(draft.marginMm.replace(",", ".")) || 0,
      useDriverPaperSize: draft.useDriverPaperSize,
      supportedKinds: draft.supportedKinds,
    };
    try {
      if (printer) await whPatch(`printers/${printer.id}`, body);
      else await whPost("printers", body);
      onSaved();
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
      wide
      title={printer ? `Modifier ${printer.name}` : "Ajouter une imprimante"}
      footer={
        <>
          <Btn onClick={onClose}>Annuler</Btn>
          <Btn variant="primary" busy={busy} disabled={!draft.name.trim() || draft.supportedKinds.length === 0} onClick={() => void save()}>
            {printer ? "Enregistrer" : "Ajouter"}
          </Btn>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom affiché">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputCls} placeholder="ex. Zebra réception" />
        </Field>
        <Field label="Mode d'impression">
          <select value={draft.adapter} onChange={(e) => setDraft({ ...draft, adapter: e.target.value as PrinterDraft["adapter"] })} className={inputCls}>
            <option value="QZ_TRAY">Impression silencieuse (QZ Tray)</option>
            <option value="PDF_MANUAL">PDF ouvert à la main (secours)</option>
          </select>
        </Field>

        {draft.adapter === "QZ_TRAY" ? (
          <div className="sm:col-span-2">
            <Field
              label="Nom système de l'imprimante (tel que vu par ce poste)"
              hint={
                qzPrinters && qzPrinters.length === 0 ? (
                  <>
                    QZ Tray ne répond pas sur ce navigateur : saisissez le nom exact, ou{" "}
                    <a className="underline" href={QZ_TRAY_DOWNLOAD_URL} target="_blank" rel="noreferrer">
                      installez QZ Tray
                    </a>
                    .
                  </>
                ) : (
                  "Le nom doit être exactement celui du système d'exploitation."
                )
              }
            >
              <div className="flex flex-wrap gap-2">
                {qzPrinters && qzPrinters.length > 0 ? (
                  <select value={draft.systemName} onChange={(e) => setDraft({ ...draft, systemName: e.target.value })} className={inputCls + " flex-1"}>
                    <option value="">Choisir…</option>
                    {[...new Set([...(draft.systemName ? [draft.systemName] : []), ...qzPrinters])].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={draft.systemName} onChange={(e) => setDraft({ ...draft, systemName: e.target.value })} className={inputCls + " flex-1 font-mono"} placeholder="ex. ZDesigner_ZD421" />
                )}
                <Btn busy={qzBusy} onClick={() => void loadQz()}>
                  Lister les imprimantes de ce poste
                </Btn>
              </div>
            </Field>
          </div>
        ) : null}

        <Field label="Format d'étiquette">
          <select
            value={preset}
            onChange={(e) => {
              const p = MEDIA_PRESETS.find((x) => x.id === e.target.value);
              if (p && p.w) setDraft({ ...draft, mediaWidthMm: String(p.w), mediaHeightMm: String(p.h) });
              else setDraft({ ...draft, mediaWidthMm: "", mediaHeightMm: "" });
            }}
            className={inputCls}
          >
            {MEDIA_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Largeur (mm)">
            <input inputMode="decimal" value={draft.mediaWidthMm} onChange={(e) => setDraft({ ...draft, mediaWidthMm: e.target.value })} className={inputCls + " tabular-nums"} />
          </Field>
          <Field label="Hauteur (mm)">
            <input inputMode="decimal" value={draft.mediaHeightMm} onChange={(e) => setDraft({ ...draft, mediaHeightMm: e.target.value })} className={inputCls + " tabular-nums"} />
          </Field>
        </div>
        <Field label="Résolution (dpi)" hint="Vide = réglage du pilote. 203 ou 300 pour une thermique.">
          <input inputMode="numeric" value={draft.dpi} onChange={(e) => setDraft({ ...draft, dpi: e.target.value })} className={inputCls + " tabular-nums"} />
        </Field>
        <Field label="Orientation">
          <select value={draft.orientation} onChange={(e) => setDraft({ ...draft, orientation: e.target.value as PrinterDraft["orientation"] })} className={inputCls}>
            <option value="landscape">Paysage</option>
            <option value="portrait">Portrait</option>
          </select>
        </Field>
        <Field label="Marge (mm)">
          <input inputMode="decimal" value={draft.marginMm} onChange={(e) => setDraft({ ...draft, marginMm: e.target.value })} className={inputCls + " tabular-nums"} />
        </Field>
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Étiquettes imprimées</span>
          <div className="flex flex-wrap gap-4">
            {ROUTED_KINDS.map((k) => (
              <label key={k} className="flex min-h-[44px] items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={draft.supportedKinds.includes(k)}
                  onChange={(e) => setDraft({ ...draft, supportedKinds: e.target.checked ? [...new Set([...draft.supportedKinds, k])] : draft.supportedKinds.filter((x) => x !== k) })}
                />
                {LABEL_KIND_LABELS[k]}
              </label>
            ))}
          </div>
        </div>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-700 dark:text-slate-200 sm:col-span-2">
          <input type="checkbox" className="h-5 w-5" checked={draft.useDriverPaperSize} onChange={(e) => setDraft({ ...draft, useDriverPaperSize: e.target.checked })} />
          Laisser le pilote choisir le format du papier (ne pas envoyer la taille)
        </label>
      </div>
      {error ? (
        <Notice tone="red" className="mt-3">
          {error}
        </Notice>
      ) : null}
    </Modal>
  );
}

// ───────────── page ─────────────

export default function StationsPage() {
  const wh = useWarehouse();
  const { siteId, isAdmin, readOnly } = wh;
  const [flash, setFlash] = useState<Flash>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [printerModal, setPrinterModal] = useState<{ printer: PrinterRow | null } | null>(null);
  const [newStation, setNewStation] = useState<{ name: string; code: string } | null>(null);
  const [paired, setPaired] = useState<{ station: StationRow; credential: string } | null>(null);
  const [test, setTest] = useState<{ printer: PrinterRow; stationId: string; outcome: PrintOutcome | null } | null>(null);
  const [reroute, setReroute] = useState<{ job: PrintJobRow; printerId: string } | null>(null);
  const [tab, setTab] = useState<QueueTab>("queued");
  const [reconcileReport, setReconcileReport] = useState<{ entries: number; alreadyKnown: number; restored: number; conflicts: { code: string; reason: string }[] } | null>(null);

  const data = useLoad<StationsData>(() => whGet<StationsData>("stations", { siteId }), [siteId], { enabled: Boolean(siteId), intervalMs: 30_000 });
  const jobs = useLoad<PrintJobRow[]>(() => whGet<PrintJobRow[]>("print-jobs", { siteId, limit: 500 }), [siteId], { enabled: Boolean(siteId), intervalMs: 10_000 });

  const printers = data.data?.printers ?? [];
  const stations = data.data?.stations ?? [];
  const printerById = useMemo(() => new Map(printers.map((p) => [p.id, p])), [printers]);

  const act = async (key: string, fn: () => Promise<unknown>, okText?: string) => {
    setBusyKey(key);
    setFlash(null);
    try {
      await fn();
      if (okText) setFlash({ tone: "green", text: okText });
      await Promise.all([data.reload(), jobs.reload()]);
    } catch (err) {
      setFlash({ tone: "red", text: errorMessage(err) });
    } finally {
      setBusyKey(null);
    }
  };

  const pair = (st: StationRow) => {
    if (st.paired && !window.confirm(`${st.code} est déjà appairé à un navigateur. L'appairer ici révoque l'autre navigateur. Continuer ?`)) return;
    void act(`pair-${st.id}`, async () => {
      const r = await whPost<{ station: StationRow; credential: string }>(`stations/${st.id}/pair`);
      // Stored on THIS browser only; the server keeps a hash.
      wh.setStation({ stationId: r.station.id, code: r.station.code, name: r.station.name, credential: r.credential });
      setPaired(r);
      await wh.reloadConfig();
    });
  };

  const unpair = (st: StationRow) => {
    if (!window.confirm(`Retirer l'appairage de ${st.code} ? Le navigateur de ce poste n'imprimera plus.`)) return;
    void act(
      `unpair-${st.id}`,
      async () => {
        await whPost(`stations/${st.id}/unpair`);
        if (wh.station?.stationId === st.id) wh.setStation(null);
        await wh.reloadConfig();
      },
      `Appairage de ${st.code} retiré.`
    );
  };

  const jobAction = (job: PrintJobRow, action: string, extra: Record<string, unknown> = {}, okText?: string) =>
    act(`job-${job.id}`, () => whPost(`print-jobs/${job.id}/action`, { action, ...extra }), okText);

  const groups = useMemo(() => {
    const all = jobs.data ?? [];
    return {
      queued: all.filter((j) => j.status === "QUEUED" || j.status === "CLAIMED"),
      failed: all.filter((j) => j.status === "FAILED"),
      uncertain: all.filter((j) => j.status === "UNCERTAIN"),
      sent: all.filter((j) => j.status === "SENT" || j.status === "CONFIRMED"),
    } satisfies Record<QueueTab, PrintJobRow[]>;
  }, [jobs.data]);
  const shown = groups[tab];

  const jobTitle = (j: PrintJobRow) => {
    const p = j.payload as unknown as Record<string, string | null | undefined>;
    if (j.labelKind === "PAIR") return `${p.title ?? "Paire"}${p.sizeLabel ? ` · ${p.sizeLabel}` : ""}`;
    if (j.labelKind === "LOCATION") return `${p.shortCode ?? ""} ${p.code ?? ""}`.trim();
    return p.text ?? "Étiquette de test";
  };

  if (!data.data) {
    return (
      <div>
        <PageHeader title="Postes et imprimantes" />
        {data.loading ? <Loading /> : <ErrorNote error={data.error} onRetry={() => void data.reload()} />}
      </div>
    );
  }
  const journal = data.data.journal;
  const localStationId = wh.station?.stationId ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Postes et imprimantes"
        subtitle="Un poste est un navigateur appairé. Il imprime les étiquettes de ses propres gestes sur les imprimantes qu'on lui attribue."
        actions={
          isAdmin ? (
            <>
              <Btn disabled={readOnly} onClick={() => setNewStation({ name: "", code: "" })}>
                Ajouter un poste
              </Btn>
              <Btn variant="primary" disabled={readOnly} onClick={() => setPrinterModal({ printer: null })}>
                Ajouter une imprimante
              </Btn>
            </>
          ) : undefined
        }
      />
      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <ErrorNote error={data.error} onRetry={() => void data.reload()} />

      {wh.station && !wh.stationValid ? (
        <Notice tone="red">
          Ce navigateur garde un appairage ({wh.station.code}) que le serveur n'accepte plus. Appairez-le de nouveau, ou{" "}
          <button type="button" className="font-semibold underline" onClick={() => wh.setStation(null)}>
            oubliez cet appairage
          </button>
          .
        </Notice>
      ) : null}

      {/* Stations */}
      <Card title="Postes" subtitle={localStationId ? undefined : "Ce navigateur n'est appairé à aucun poste."} flush>
        {stations.length === 0 ? (
          <EmptyState title="Aucun poste sur ce site" />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {stations.map((st) => {
              const mine = st.id === localStationId;
              return (
                <li key={st.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100">{st.code}</span>
                        <span className="text-sm text-slate-700 dark:text-slate-200">{st.name}</span>
                        <Chip tone={st.status === "ACTIVE" ? "green" : "slate"}>{st.status === "ACTIVE" ? "Actif" : "Désactivé"}</Chip>
                        <Chip tone={st.paired ? "green" : "amber"}>{st.paired ? "Appairé" : "Non appairé"}</Chip>
                        {mine ? <Chip tone="blue">Ce navigateur</Chip> : null}
                      </div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {st.pairedAt ? `Appairé le ${fmtDateTime(st.pairedAt)} · ` : ""}
                        {st.lastSeenAt ? `vu ${fmtAge(st.lastSeenAt)}` : "jamais vu"}
                      </div>
                    </div>
                    {isAdmin ? (
                      <div className="flex flex-wrap gap-2">
                        <Btn size="sm" variant={mine ? "secondary" : "primary"} busy={busyKey === `pair-${st.id}`} disabled={readOnly || st.status !== "ACTIVE"} onClick={() => pair(st)}>
                          {mine ? "Réappairer ce navigateur" : "Appairer ce navigateur"}
                        </Btn>
                        {st.paired ? (
                          <Btn size="sm" busy={busyKey === `unpair-${st.id}`} disabled={readOnly} onClick={() => unpair(st)}>
                            Retirer l'appairage
                          </Btn>
                        ) : null}
                        <Btn
                          size="sm"
                          disabled={readOnly}
                          onClick={() => {
                            const name = window.prompt("Nouveau nom du poste :", st.name);
                            if (name && name.trim() && name.trim() !== st.name) void act(`st-${st.id}`, () => whPatch(`stations/${st.id}`, { name: name.trim() }), "Poste renommé.");
                          }}
                        >
                          Renommer
                        </Btn>
                        <Btn
                          size="sm"
                          disabled={readOnly}
                          busy={busyKey === `st-${st.id}`}
                          onClick={() => {
                            const disable = st.status === "ACTIVE";
                            if (disable && !window.confirm(`Désactiver ${st.code} ? Son appairage sera révoqué.`)) return;
                            void act(`st-${st.id}`, async () => {
                              await whPatch(`stations/${st.id}`, { status: disable ? "DISABLED" : "ACTIVE" });
                              if (disable && mine) wh.setStation(null);
                            });
                          }}
                        >
                          {st.status === "ACTIVE" ? "Désactiver" : "Réactiver"}
                        </Btn>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {ROUTED_KINDS.map((kind) => {
                      const route = st.routes.find((r) => r.labelKind === kind);
                      const options = printers.filter((p) => p.supportedKinds.includes(kind) && (p.status === "ACTIVE" || p.id === route?.printerId));
                      const setRoute = (printerId: string, fallbackPrinterId: string) =>
                        act(`route-${st.id}-${kind}`, () => whPost(`stations/${st.id}/route`, { labelKind: kind, printerId: printerId || null, fallbackPrinterId: fallbackPrinterId || null }), "Routage enregistré.");
                      return (
                        <div key={kind} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">Étiquettes {LABEL_KIND_LABELS[kind].toLowerCase()}</span>
                            {route ? route.printerStatus === "ACTIVE" ? <Chip tone="green">Routée</Chip> : <Chip tone="red">Imprimante désactivée</Chip> : <Chip tone="amber">Aucune imprimante</Chip>}
                          </div>
                          {isAdmin ? (
                            <div className="grid gap-2 sm:grid-cols-2">
                              <Field label="Imprimante">
                                <select value={route?.printerId ?? ""} disabled={readOnly || busyKey === `route-${st.id}-${kind}`} onChange={(e) => void setRoute(e.target.value, e.target.value ? route?.fallbackPrinterId ?? "" : "")} className={inputCls}>
                                  <option value="">Aucune (PDF à la main)</option>
                                  {options.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Secours">
                                <select
                                  value={route?.fallbackPrinterId ?? ""}
                                  disabled={readOnly || !route || busyKey === `route-${st.id}-${kind}`}
                                  onChange={(e) => void setRoute(route?.printerId ?? "", e.target.value)}
                                  className={inputCls}
                                >
                                  <option value="">Aucune</option>
                                  {options
                                    .filter((p) => p.id !== route?.printerId)
                                    .map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name}
                                      </option>
                                    ))}
                                </select>
                              </Field>
                            </div>
                          ) : (
                            <div className="text-sm text-slate-700 dark:text-slate-200">
                              {route ? route.printerName : "Aucune imprimante : le PDF reste disponible."}
                              {route?.fallbackPrinterName ? ` · secours : ${route.fallbackPrinterName}` : ""}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Printers */}
      <Card title="Imprimantes" flush>
        {printers.length === 0 ? (
          <EmptyState title="Aucune imprimante">Sans imprimante, chaque étiquette reste disponible en PDF.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <Th>Imprimante</Th>
                  <Th>Mode</Th>
                  <Th>Format</Th>
                  <Th>Étiquettes</Th>
                  <Th>État</Th>
                  <Th>Test physique</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {printers.map((p) => (
                  <tr key={p.id} className={rowCls}>
                    <Td>
                      <div className="font-medium text-slate-900 dark:text-slate-100">{p.name}</div>
                      {p.systemName ? <div className="font-mono text-xs text-slate-500">{p.systemName}</div> : null}
                      {p.lastError ? (
                        <div className="text-xs text-red-700 dark:text-red-400">
                          {p.lastError} ({fmtAge(p.lastErrorAt)})
                        </div>
                      ) : null}
                    </Td>
                    <Td>{p.adapter === "QZ_TRAY" ? "QZ Tray (silencieuse)" : "PDF à la main"}</Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {p.mediaWidthMm} × {p.mediaHeightMm} mm
                      <div className="text-xs text-slate-500">
                        {p.dpi ? `${p.dpi} dpi · ` : ""}
                        {p.orientation === "portrait" ? "portrait" : "paysage"}
                        {p.marginMm ? ` · marge ${p.marginMm} mm` : ""}
                      </div>
                    </Td>
                    <Td>{p.supportedKinds.map((k) => LABEL_KIND_LABELS[k] ?? k).join(", ")}</Td>
                    <Td>
                      <Chip tone={p.status === "ACTIVE" ? "green" : "slate"}>{p.status === "ACTIVE" ? "Active" : "Désactivée"}</Chip>
                    </Td>
                    <Td>
                      {p.verifiedAt ? (
                        <Chip tone="green" title={p.verifiedNote ?? undefined}>
                          Vérifiée le {fmtDateTime(p.verifiedAt)}
                        </Chip>
                      ) : (
                        <Chip tone="amber">Jamais vérifiée</Chip>
                      )}
                    </Td>
                    <Td className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Btn size="sm" disabled={readOnly || p.status !== "ACTIVE" || stations.length === 0} onClick={() => setTest({ printer: p, stationId: localStationId ?? stations.find((s) => s.status === "ACTIVE")?.id ?? "", outcome: null })}>
                          Test d'impression
                        </Btn>
                        {isAdmin ? (
                          <>
                            <Btn size="sm" disabled={readOnly} onClick={() => setPrinterModal({ printer: p })}>
                              Modifier
                            </Btn>
                            <Btn
                              size="sm"
                              disabled={readOnly}
                              busy={busyKey === `pr-${p.id}`}
                              onClick={() => void act(`pr-${p.id}`, () => whPatch(`printers/${p.id}`, { status: p.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }))}
                            >
                              {p.status === "ACTIVE" ? "Désactiver" : "Réactiver"}
                            </Btn>
                          </>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Queue */}
      <Card title="File d'impression" subtitle="Actualisée toutes les 10 secondes" flush>
        <div className="px-2">
          <Tabs<QueueTab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "queued", label: "En attente", count: groups.queued.length, tone: "amber" },
              { id: "failed", label: "Échec", count: groups.failed.length, tone: "red" },
              { id: "uncertain", label: "Incertain", count: groups.uncertain.length, tone: "red" },
              { id: "sent", label: "Envoyées", count: groups.sent.length },
            ]}
          />
        </div>
        {tab === "uncertain" && shown.length > 0 ? (
          <Notice tone="amber" className="m-3">
            Ces étiquettes ont été prises par un poste qui n'a pas répondu : <strong>elles peuvent encore sortir</strong>. Regardez l'imprimante et sa file avant de répondre. Elles ne sont jamais renvoyées automatiquement.
          </Notice>
        ) : null}
        <ErrorNote error={jobs.error} className="m-3" onRetry={() => void jobs.reload()} />
        {!jobs.data ? (
          <Loading />
        ) : shown.length === 0 ? (
          <EmptyState title="Aucune étiquette dans cet état" />
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <Th>Étiquette</Th>
                  <Th>Poste · Imprimante</Th>
                  <Th>État</Th>
                  <Th>Demandée</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 200).map((j) => {
                  const pr = j.printerId ? printerById.get(j.printerId) : undefined;
                  const manual = pr?.adapter === "PDF_MANUAL";
                  const busy = busyKey === `job-${j.id}`;
                  const pdf = (
                    <a
                      href={whUrl(`print-jobs/${j.id}/label`, { format: "pdf" })}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-[36px] items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      Ouvrir le PDF
                    </a>
                  );
                  return (
                    <tr key={j.id} className={rowCls}>
                      <Td>
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip>{LABEL_KIND_LABELS[j.labelKind] ?? j.labelKind}</Chip>
                          {j.isReprint ? <Chip tone="blue">Réimpression</Chip> : null}
                          <span className="font-medium text-slate-900 dark:text-slate-100">{jobTitle(j)}</span>
                        </div>
                        <div className="font-mono text-xs text-slate-500">{j.labelCode ? j.labelCode.slice(0, 8).toUpperCase() : ""}</div>
                        {j.reason ? <div className="text-xs text-slate-500">Motif : {j.reason}</div> : null}
                      </Td>
                      <Td className="text-xs">
                        <span className="font-mono">{j.stationCode ?? "—"}</span> · {j.printerName ?? "—"}
                        {manual ? <div className="text-slate-500">PDF à la main</div> : null}
                      </Td>
                      <Td>
                        <Chip tone={PRINT_STATUS[j.status]?.tone}>{PRINT_STATUS[j.status]?.label ?? j.status}</Chip>
                        {j.attempts > 0 ? <span className="ml-2 text-xs tabular-nums text-slate-500">{j.attempts} essai(s)</span> : null}
                        {j.lastError ? <div className="mt-1 text-xs text-red-700 dark:text-red-400">{j.lastError}</div> : null}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-slate-500">{fmtAge(j.createdAt)}</Td>
                      <Td>
                        <div className="flex flex-wrap justify-end gap-2">
                          {j.status === "QUEUED" && manual ? (
                            <>
                              {pdf}
                              <Btn size="sm" variant="primary" busy={busy} disabled={readOnly} onClick={() => void jobAction(j, "MANUAL_SENT")}>
                                Marquer comme imprimée
                              </Btn>
                            </>
                          ) : null}
                          {j.status === "QUEUED" || j.status === "FAILED" ? (
                            <>
                              {j.status === "FAILED" ? (
                                <Btn size="sm" variant="primary" busy={busy} disabled={readOnly} onClick={() => void jobAction(j, "RETRY", {}, "Étiquette remise en file.")}>
                                  Relancer
                                </Btn>
                              ) : null}
                              {j.status === "FAILED" && manual ? pdf : null}
                              <Btn size="sm" disabled={readOnly || busy} onClick={() => setReroute({ job: j, printerId: "" })}>
                                Rediriger
                              </Btn>
                              <Btn
                                size="sm"
                                variant="ghost"
                                disabled={readOnly || busy}
                                onClick={() => {
                                  if (window.confirm("Annuler cette impression ? L'étiquette pourra être réimprimée depuis la fiche de la paire.")) void jobAction(j, "CANCEL");
                                }}
                              >
                                Annuler
                              </Btn>
                            </>
                          ) : null}
                          {j.status === "UNCERTAIN" ? (
                            <>
                              <Btn size="sm" variant="primary" busy={busy} disabled={readOnly} onClick={() => void jobAction(j, "CONFIRM", {}, "Étiquette confirmée.")}>
                                L'étiquette est sortie
                              </Btn>
                              <Btn size="sm" disabled={readOnly || busy} onClick={() => void jobAction(j, "NOT_PRINTED", {}, "Impression close : réimprimez depuis la fiche de la paire si nécessaire.")}>
                                Rien n'est sorti
                              </Btn>
                            </>
                          ) : null}
                          {j.status === "SENT" ? (
                            <Btn size="sm" busy={busy} disabled={readOnly} onClick={() => void jobAction(j, "CONFIRM")}>
                              Confirmer la sortie
                            </Btn>
                          ) : null}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length > 200 ? <p className="px-4 py-2 text-xs text-slate-500">200 premières lignes affichées sur {shown.length}.</p> : null}
          </div>
        )}
      </Card>

      {/* Journal */}
      <Card title="Journal d'émission des étiquettes" subtitle="Copie hors base de chaque QR émis : permet de reconstruire le registre après un incident.">
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">QR émis</div>
            <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{journal.total}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">À exporter</div>
            <div className={"text-2xl font-semibold tabular-nums " + (journal.pendingExport > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-slate-100")}>{journal.pendingExport}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Dernier export</div>
            <div className="text-sm text-slate-900 dark:text-slate-100">{journal.lastExportedAt ? fmtDateTime(journal.lastExportedAt) : "Jamais"}</div>
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-500 dark:text-slate-400">Dossier</div>
            <div className="break-all font-mono text-xs text-slate-900 dark:text-slate-100">{journal.sink ?? "Non configuré"}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn
            busy={busyKey === "journal"}
            disabled={readOnly || !journal.sink}
            onClick={() =>
              void act("journal", async () => {
                const r = await whPost<{ exported: number; pending: number }>("journal/export", {});
                setFlash({ tone: "green", text: `${r.exported} entrée(s) exportée(s), ${r.pending} restante(s).` });
              })
            }
          >
            Exporter maintenant
          </Btn>
          {isAdmin ? (
            <Btn
              variant="ghost"
              busy={busyKey === "reconcile"}
              disabled={!journal.sink}
              onClick={() =>
                void act("reconcile", async () => {
                  setReconcileReport(await whPost("journal/reconcile", { dryRun: true }));
                })
              }
            >
              Comparer le journal et la base (sans rien modifier)
            </Btn>
          ) : null}
        </div>
        {reconcileReport ? (
          <Notice tone={reconcileReport.conflicts.length ? "red" : "green"} className="mt-3">
            {reconcileReport.entries} entrée(s) lue(s) · {reconcileReport.alreadyKnown} déjà connue(s) · {reconcileReport.restored} à restaurer · {reconcileReport.conflicts.length} conflit(s)
            {reconcileReport.conflicts.slice(0, 10).map((c) => (
              <div key={c.code} className="font-mono text-xs">
                {c.code.slice(0, 8)} : {c.reason}
              </div>
            ))}
          </Notice>
        ) : null}
      </Card>

      {/* Dialogs */}
      {siteId ? <PrinterModal open={Boolean(printerModal)} printer={printerModal?.printer ?? null} siteId={siteId} onClose={() => setPrinterModal(null)} onSaved={() => void data.reload()} /> : null}

      <Modal
        open={Boolean(newStation)}
        onClose={() => setNewStation(null)}
        title="Ajouter un poste"
        footer={
          <>
            <Btn onClick={() => setNewStation(null)}>Annuler</Btn>
            <Btn
              variant="primary"
              busy={busyKey === "new-station"}
              disabled={!newStation?.name.trim()}
              onClick={() => {
                const s = newStation;
                if (!s) return;
                void act("new-station", async () => {
                  await whPost("stations", { siteId, name: s.name.trim(), code: s.code.trim() || undefined });
                  setNewStation(null);
                });
              }}
            >
              Créer le poste
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Nom du poste">
            <input autoFocus value={newStation?.name ?? ""} onChange={(e) => setNewStation((s) => (s ? { ...s, name: e.target.value } : s))} className={inputCls} placeholder="ex. Poste réception 2" />
          </Field>
          <Field label="Code (facultatif)" hint="Laisser vide pour un code automatique, ex. CH01-P3.">
            <input value={newStation?.code ?? ""} onChange={(e) => setNewStation((s) => (s ? { ...s, code: e.target.value.toUpperCase() } : s))} className={inputCls + " font-mono"} />
          </Field>
          {flash?.tone === "red" ? <Notice tone="red">{flash.text}</Notice> : null}
        </div>
      </Modal>

      <Modal open={Boolean(paired)} onClose={() => setPaired(null)} tone="amber" title="Navigateur appairé" footer={<Btn variant="primary" onClick={() => setPaired(null)}>J'ai compris</Btn>}>
        {paired ? (
          <div className="space-y-3 text-sm text-slate-700 dark:text-slate-200">
            <p className="text-base">
              Ce navigateur est maintenant le poste <strong className="font-mono">{paired.station.code}</strong> ({paired.station.name}).
            </p>
            <p>
              Le secret d'appairage ci-dessous <strong>n'est affiché qu'une seule fois</strong>. Il est déjà enregistré dans ce navigateur : vous n'avez rien à recopier. Vider les données du navigateur ou appairer un autre navigateur à ce poste demandera un nouvel appairage.
            </p>
            <div className="break-all rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-800">{paired.credential}</div>
            <p>L'agent d'impression démarre dans le bandeau du haut dès que QZ Tray est ouvert sur ce poste.</p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(test)}
        onClose={() => setTest(null)}
        title={`Test d'impression · ${test?.printer.name ?? ""}`}
        footer={
          test?.outcome ? (
            <>
              <Btn onClick={() => setTest(null)}>Fermer</Btn>
              {isAdmin ? (
                <Btn
                  variant="primary"
                  busy={busyKey === "verified"}
                  disabled={readOnly}
                  onClick={() => {
                    const t = test;
                    void act(
                      "verified",
                      async () => {
                        await whPost(`printers/${t.printer.id}/verified`, { note: `Test physique confirmé depuis ${stations.find((s) => s.id === t.stationId)?.code ?? "un poste"}` });
                        setTest(null);
                      },
                      `${t.printer.name} : test physique confirmé.`
                    );
                  }}
                >
                  J'ai l'étiquette en main, elle est lisible
                </Btn>
              ) : null}
            </>
          ) : (
            <>
              <Btn onClick={() => setTest(null)}>Annuler</Btn>
              <Btn
                variant="primary"
                busy={busyKey === "test"}
                disabled={!test?.stationId || readOnly}
                onClick={() => {
                  const t = test;
                  if (!t) return;
                  void act("test", async () => {
                    const outcome = await whPost<PrintOutcome>(`stations/${t.stationId}/test-print`, { opKey: newOpKey("tst"), printerId: t.printer.id });
                    setTest({ ...t, outcome });
                  });
                }}
              >
                Envoyer l'étiquette de test
              </Btn>
            </>
          )
        }
      >
        {test ? (
          <div className="space-y-3">
            <Field label="Poste qui imprime" hint="Le poste doit être ouvert, appairé, avec QZ Tray lancé (sauf imprimante PDF).">
              <select value={test.stationId} disabled={Boolean(test.outcome)} onChange={(e) => setTest({ ...test, stationId: e.target.value })} className={inputCls}>
                {stations
                  .filter((s) => s.status === "ACTIVE")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name}
                      {s.id === localStationId ? " (ce navigateur)" : ""}
                    </option>
                  ))}
              </select>
            </Field>
            {test.outcome ? (
              test.outcome.status === "QUEUED" ? (
                <Notice tone="green">
                  Étiquette de test en file sur <strong>{test.outcome.printerName}</strong> (poste {test.outcome.stationCode}).
                  {test.printer.adapter === "PDF_MANUAL" ? (
                    <>
                      {" "}
                      <a className="font-semibold underline" target="_blank" rel="noreferrer" href={whUrl(`print-jobs/${test.outcome.jobId}/label`, { format: "pdf" })}>
                        Ouvrir le PDF
                      </a>{" "}
                      et imprimez-le.
                    </>
                  ) : (
                    " Elle sort dès que le poste la prend."
                  )}
                  <div className="mt-2">Scannez le QR de l'étiquette avec la douchette : il doit se lire du premier coup.</div>
                </Notice>
              ) : (
                <Notice tone="amber">{test.outcome.message}</Notice>
              )
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-300">Une étiquette de test est envoyée sur cette imprimante. Vérifiez la taille, le cadrage et la lisibilité du QR.</p>
            )}
            {flash?.tone === "red" ? <Notice tone="red">{flash.text}</Notice> : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(reroute)}
        onClose={() => setReroute(null)}
        title="Rediriger l'étiquette"
        footer={
          <>
            <Btn onClick={() => setReroute(null)}>Annuler</Btn>
            <Btn
              variant="primary"
              disabled={!reroute?.printerId}
              onClick={() => {
                const r = reroute;
                if (!r) return;
                setReroute(null);
                void jobAction(r.job, "REROUTE", { printerId: r.printerId }, "Étiquette redirigée.");
              }}
            >
              Rediriger
            </Btn>
          </>
        }
      >
        {reroute ? (
          <Field label="Imprimante de destination" hint="L'étiquette prend le format de l'imprimante choisie.">
            <select value={reroute.printerId} onChange={(e) => setReroute({ ...reroute, printerId: e.target.value })} className={inputCls}>
              <option value="">Choisir…</option>
              {printers
                .filter((p) => p.status === "ACTIVE" && p.id !== reroute.job.printerId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.mediaWidthMm} × {p.mediaHeightMm} mm
                  </option>
                ))}
            </select>
          </Field>
        ) : null}
      </Modal>
    </div>
  );
}
