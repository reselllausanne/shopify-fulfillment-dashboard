"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import type { BatchDetail, BatchRow } from "@/lib/warehouse/batches";
import type { ExceptionRow } from "@/lib/warehouse/exceptions";
import { errorMessage, isWhError, whGet, whPost } from "../../_lib/api";
import { useWarehouse } from "../../_lib/context";
import { BATCH_FLOW_LABELS, BATCH_KIND_LABELS, BATCH_STATUS, exceptionLabel, fmtAge, fmtDateTime, ownerLabel } from "../../_lib/format";
import { useLoad } from "../../_lib/hooks";
import BatchScanFlow from "../../_components/BatchScanFlow";
import CsvImport from "../../_components/CsvImport";
import { Btn, Card, Chip, EmptyState, ErrorNote, Field, KpiTile, Loading, Modal, Notice, Tabs, Td, Th, inputCls, rowCls, tableCls, theadCls } from "../../_components/ui";

type Tab = "lines" | "levels" | "exceptions" | "import";

const LINE_STATUS: Record<string, { label: string; tone: "green" | "amber" | "slate" | "red" }> = {
  OPEN: { label: "En cours", tone: "amber" },
  CLOSED: { label: "Close", tone: "slate" },
  CLOSED_SHORT: { label: "Close incomplète", tone: "red" },
};

function CloseBatchModal({ batch, open, onClose, onClosed }: { batch: BatchRow; open: boolean; onClose: () => void; onClosed: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [short, setShort] = useState<{ lineNo: number; expectedQty: number; receivedQty: number }[] | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await whPost(`batches/${batch.id}/close`, { reason: reason.trim() || null });
      onClosed();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      const lines = isWhError(err) ? (err.details?.shortLines as typeof short) : null;
      if (Array.isArray(lines)) setShort(lines);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Clôturer le lot ${batch.reference}`}
      footer={
        <>
          <Btn onClick={onClose}>Annuler</Btn>
          <Btn variant="primary" busy={busy} disabled={Boolean(short) && reason.trim().length < 3} onClick={() => void submit()}>
            Clôturer le lot
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          La clôture ne crée, ne supprime et ne déplace aucune paire. Elle fige le résumé du lot : attendu, identifié, à ranger, écarts à vérifier.
        </p>
        {short ? (
          <Notice tone="amber">
            <div className="font-semibold">Lignes attendues incomplètes : un motif est obligatoire.</div>
            <ul className="mt-1 list-inside list-disc">
              {short.map((l) => (
                <li key={l.lineNo} className="tabular-nums">
                  Ligne {l.lineNo} : {l.receivedQty} reçue(s) sur {l.expectedQty}
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}
        <Field label={short ? "Motif de clôture (obligatoire)" : "Motif de clôture (obligatoire si des lignes sont incomplètes)"} hint="Reliquat, manquant, erreur de bordereau…">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputCls + " py-2"} />
        </Field>
        {error ? <Notice tone="red">{error}</Notice> : null}
      </div>
    </Modal>
  );
}

function CloseSummary({ summary }: { summary: Record<string, unknown> }) {
  const n = (k: string) => (typeof summary[k] === "number" ? (summary[k] as number) : null);
  const rows: [string, number | null][] = [
    ["Attendues", n("expected")],
    ["Identifiées", n("identified")],
    ["Confirmées en rayon", n("confirmedOnShelf")],
    ["Restant à ranger", n("stillToPutAway")],
    ["Quarantaine", n("quarantine")],
    ["Introuvables", n("missingPairs")],
    ["Boîtes en excédent", n("surplusBoxes")],
    ["À vérifier", n("toVerify")],
    ["Étiquettes vérifiées", n("labelsVerified")],
    ["Niveaux comptés", n("levelsCounted")],
  ];
  return (
    <Card title="Résumé de clôture" subtitle={typeof summary.closedAt === "string" ? `Clos le ${fmtDateTime(summary.closedAt)}` : undefined}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{k}</dt>
            <dd className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{v ?? "—"}</dd>
          </div>
        ))}
      </dl>
      {typeof summary.reason === "string" && summary.reason ? <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">Motif : {summary.reason}</p> : null}
    </Card>
  );
}

export default function BatchPage() {
  const params = useParams<{ batchId: string }>();
  const batchId = params.batchId;
  const router = useRouter();
  const { readOnly } = useWarehouse();
  const [tab, setTab] = useState<Tab>("lines");
  const [closing, setClosing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const detail = useLoad<BatchDetail>(() => whGet<BatchDetail>(`batches/${batchId}`), [batchId], { intervalMs: 45_000 });
  const exceptions = useLoad<{ items: ExceptionRow[] }>(() => whGet(`exceptions`, { batchId, status: "OPEN", limit: 100 }), [batchId, detail.data?.totals.openExceptions], {
    enabled: Boolean(detail.data),
  });

  const setStatus = async (action: "PAUSE" | "RESUME" | "CANCEL") => {
    if (action === "CANCEL" && !window.confirm("Annuler ce lot vide ?")) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await whPost(`batches/${batchId}/status`, { action });
      if (action === "CANCEL") router.push("/warehouse/receiving");
      else await detail.reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  if (!detail.data) {
    return detail.loading ? <Loading /> : <ErrorNote error={detail.error} onRetry={() => void detail.reload()} />;
  }
  const { batch, totals, lines, sessions } = detail.data;
  // Added to the batch detail after the contract freeze: read defensively.
  const pace = (detail.data as BatchDetail & { pace?: { pairs: number; activeMinutes: number; pairsPerActiveHour: number | null; reprints: number; recounts: number } }).pace ?? null;
  const st = BATCH_STATUS[batch.status] ?? { label: batch.status, tone: "slate" as const };
  const live = batch.status === "OPEN" || batch.status === "PAUSED";
  const stockTake = batch.kind === "STOCK_TAKE";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/warehouse/receiving" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
            ← Réception et reprise
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{batch.reference}</h1>
            <Chip tone={st.tone}>{st.label}</Chip>
            <Chip>{BATCH_KIND_LABELS[batch.kind] ?? batch.kind}</Chip>
            <Chip>{BATCH_FLOW_LABELS[batch.flow] ?? batch.flow}</Chip>
            <Chip tone="blue">{ownerLabel(batch.ownerKind, batch.ownerName)}</Chip>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {[batch.title, batch.supplierName ? `Fournisseur : ${batch.supplierName}` : null, batch.sourceDocRef ? `${batch.sourceDocType ?? "Document"} ${batch.sourceDocRef}` : null, `créé le ${fmtDateTime(batch.createdAt)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {batch.notes ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{batch.notes}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {totals.atTemporary > 0 ? (
            <Link
              href={`/warehouse/putaway?batch=${batch.id}`}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Ranger les {totals.atTemporary} paires
            </Link>
          ) : null}
          <Link
            href={`/warehouse/stock?batchId=${batch.id}`}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Voir les paires
          </Link>
          {batch.status === "OPEN" ? (
            <Btn disabled={readOnly} busy={actionBusy} onClick={() => void setStatus("PAUSE")}>
              Mettre en pause
            </Btn>
          ) : null}
          {batch.status === "PAUSED" ? (
            <Btn variant="primary" disabled={readOnly} busy={actionBusy} onClick={() => void setStatus("RESUME")}>
              Reprendre le lot
            </Btn>
          ) : null}
          {live && batch.unitCount === 0 ? (
            <Btn variant="ghost" disabled={readOnly || actionBusy} onClick={() => void setStatus("CANCEL")}>
              Annuler le lot
            </Btn>
          ) : null}
          {live ? (
            <Btn disabled={readOnly} onClick={() => setClosing(true)}>
              Clôturer le lot
            </Btn>
          ) : null}
        </div>
      </div>

      {actionError ? <Notice tone="red">{actionError}</Notice> : null}
      <ErrorNote error={detail.error} onRetry={() => void detail.reload()} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <KpiTile label="Attendues" value={totals.expected ?? "—"} sub={totals.expected === null ? "Contenu non annoncé" : undefined} />
        <KpiTile label="Identifiées" value={totals.identified} tone="green" />
        <KpiTile label="En zone temporaire" value={totals.atTemporary} tone={totals.atTemporary > 0 ? "amber" : undefined} />
        <KpiTile label="En rayon" value={totals.shelved} />
        <KpiTile label="Quarantaine" value={totals.quarantine} tone={totals.quarantine > 0 ? "red" : undefined} />
        <KpiTile label="Introuvables" value={totals.missing} tone={totals.missing > 0 ? "red" : undefined} />
        <KpiTile label="Étiquettes vérifiées" value={totals.labelsVerified} sub={`sur ${totals.identified}`} />
        <KpiTile label="Écarts ouverts" value={totals.openExceptions} tone={totals.openExceptions > 0 ? "amber" : undefined} />
      </div>

      {pace && pace.pairs > 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Cadence mesurée : <span className="font-medium tabular-nums text-slate-800 dark:text-slate-100">{pace.pairsPerActiveHour !== null ? `${Math.round(pace.pairsPerActiveHour)} paires par heure` : "—"}</span> sur{" "}
          <span className="tabular-nums">{Math.round(pace.activeMinutes)} min</span> de scan effectif
          {pace.reprints > 0 ? ` · ${pace.reprints} réimpression(s)` : ""}
          {pace.recounts > 0 ? ` · ${pace.recounts} recomptage(s)` : ""}
        </p>
      ) : null}

      {batch.status === "OPEN" ? (
        <BatchScanFlow detail={detail.data} onChanged={() => void detail.reload()} />
      ) : batch.status === "PAUSED" ? (
        <Notice tone="amber">Lot en pause : rien ne peut être scanné tant qu'il n'est pas repris.</Notice>
      ) : batch.closeSummary && typeof batch.closeSummary === "object" ? (
        <CloseSummary summary={batch.closeSummary as Record<string, unknown>} />
      ) : null}

      <Card flush>
        <div className="px-2">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "lines", label: "Lignes attendues", count: lines.length },
              ...(stockTake ? [{ id: "levels" as Tab, label: "Niveaux comptés", count: sessions.length }] : []),
              { id: "exceptions", label: "Écarts du lot", count: totals.openExceptions, tone: "amber" as const },
              ...(live ? [{ id: "import" as Tab, label: "Importer des lignes (CSV)" }] : []),
            ]}
          />
        </div>

        {tab === "lines" ? (
          lines.length === 0 ? (
            <EmptyState title="Aucune ligne attendue">Le contenu de ce lot n'a pas été annoncé : chaque boîte scannée est acceptée. Un fichier CSV peut être importé.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <Th>N°</Th>
                    <Th>Variante</Th>
                    <Th>Pointure</Th>
                    <Th>GTIN</Th>
                    <Th>Référence</Th>
                    <Th className="text-right">Reçues / attendues</Th>
                    <Th>Statut</Th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const ls = LINE_STATUS[l.status] ?? { label: l.status, tone: "slate" as const };
                    const done = l.expectedQty !== null && l.receivedQty >= l.expectedQty;
                    return (
                      <tr key={l.id} className={rowCls}>
                        <Td className="tabular-nums text-slate-500">{l.lineNo}</Td>
                        <Td>{l.itemName ?? l.description ?? "—"}</Td>
                        <Td>{l.sizeLabel ?? "—"}</Td>
                        <Td className="font-mono text-xs">{l.gtin ?? "—"}</Td>
                        <Td className="font-mono text-xs">{l.externalRef ?? "—"}</Td>
                        <Td className="text-right font-semibold tabular-nums">
                          <span className={done ? "text-[#0A7A2C] dark:text-emerald-400" : ""}>{l.receivedQty}</span> / {l.expectedQty ?? "—"}
                        </Td>
                        <Td>
                          <Chip tone={ls.tone}>{ls.label}</Chip>
                          {l.closeReason ? <div className="mt-1 text-xs text-slate-500">{l.closeReason}</div> : null}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "levels" ? (
          sessions.length === 0 ? (
            <EmptyState title="Aucun niveau compté pour l'instant" />
          ) : (
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <Th>Niveau</Th>
                    <Th>Code</Th>
                    <Th className="text-right">Comptage n°</Th>
                    <Th className="text-right">Paires comptées</Th>
                    <Th>État</Th>
                    <Th>Ouvert</Th>
                    <Th>Clos</Th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className={rowCls}>
                      <Td className="font-mono text-base font-semibold">{s.locationShortCode}</Td>
                      <Td className="font-mono text-xs text-slate-500">{s.locationCode}</Td>
                      <Td className="text-right tabular-nums">{s.round}</Td>
                      <Td className="text-right font-semibold tabular-nums">{s.countedUnits}</Td>
                      <Td>{s.status === "OPEN" ? <Chip tone="amber">En cours</Chip> : <Chip tone="green">Terminé</Chip>}</Td>
                      <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDateTime(s.openedAt)}</Td>
                      <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDateTime(s.closedAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "exceptions" ? (
          !exceptions.data ? (
            exceptions.loading ? (
              <Loading />
            ) : (
              <ErrorNote error={exceptions.error} className="m-3" />
            )
          ) : exceptions.data.items.length === 0 ? (
            <EmptyState title="Aucun écart ouvert sur ce lot" />
          ) : (
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <Th>Type</Th>
                    <Th>Paire</Th>
                    <Th>Emplacement</Th>
                    <Th>Code lu</Th>
                    <Th>Ouvert</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {exceptions.data.items.map((e) => (
                    <tr key={e.id} className={rowCls}>
                      <Td>
                        <Chip tone="amber">{e.typeLabel || exceptionLabel(e.type)}</Chip>
                      </Td>
                      <Td>
                        {e.unitId ? (
                          <Link href={`/warehouse/stock/${e.unitId}`} className="hover:underline">
                            {e.itemName ?? "Paire"} {e.itemSizeLabel ? `· ${e.itemSizeLabel}` : ""}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td className="font-mono text-xs">{e.locationCode ?? "—"}</Td>
                      <Td className="font-mono text-xs">{e.rawCode ?? "—"}</Td>
                      <Td className="whitespace-nowrap text-xs text-slate-500">{fmtAge(e.createdAt)}</Td>
                      <Td className="text-right">
                        <Link href="/warehouse/exceptions" className="text-sm font-medium text-[#0A7A2C] underline dark:text-emerald-400">
                          Traiter
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "import" && live ? (
          <div className="p-4">
            <CsvImport
              kind="BATCH_LINES"
              targetId={batch.id}
              disabled={readOnly}
              columns="gtin (ou ean), description (ou modèle), pointure, quantité, référence"
              example={"gtin;description;pointure;quantite;reference\n0196154123456;Dunk Low Panda;42;3;BL-0012"}
              onApplied={() => void detail.reload()}
            />
          </div>
        ) : null}
      </Card>

      <CloseBatchModal batch={batch} open={closing} onClose={() => setClosing(false)} onClosed={() => void detail.reload()} />
    </div>
  );
}
