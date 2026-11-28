"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExceptionRow } from "@/lib/warehouse/exceptions";
import type { ReconcileRow } from "@/lib/warehouse/overview";
import { errorMessage, whGet, whPost } from "../_lib/api";
import { useWarehouse } from "../_lib/context";
import { PRESENCE, QC, SALE, exceptionLabel, fmtAge, fmtDateTime, ownerLabel } from "../_lib/format";
import { Btn, Card, Chip, EmptyState, ErrorNote, Field, Loading, Modal, Notice, PageHeader, Segmented, Tabs, Td, Th, cx, inputCls, rowCls, tableCls, theadCls } from "../_components/ui";

type TabId = "OPEN" | "RESOLVED" | "DISMISSED";
type ListResult = { items: ExceptionRow[]; nextCursor: string | null; openByType: Record<string, number> };
type Reconciliation = { rows: ReconcileRow[]; totalUnits: number; distinctIds: number };

function detailsText(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof d.instruction === "string") parts.push(d.instruction);
  if (typeof d.reason === "string") parts.push(`Motif : ${d.reason}`);
  if (typeof d.note === "string" && d.note) parts.push(`Note : ${d.note}`);
  if (typeof d.expectedQty === "number") parts.push(`Attendu ${d.expectedQty}, reçu ${typeof d.receivedQty === "number" ? d.receivedQty : "?"}`);
  if (typeof d.description === "string" && d.description) parts.push(d.description);
  if (typeof d.capacity === "number") parts.push(`Capacité ${d.capacity}, occupées ${d.occupiedCount ?? "?"}, réservées ${d.reservedCount ?? "?"}`);
  if (typeof d.recordedLocationCode === "string") parts.push(`Enregistrée en ${d.recordedLocationCode}`);
  if (Array.isArray(d.notScanned)) parts.push(`${d.notScanned.length} paire(s) non scannée(s)`);
  return parts.length ? parts.join(" · ") : null;
}

function ResolveModal({ exception, onClose, onDone }: { exception: ExceptionRow | null; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<"RESOLVED" | "DISMISSED">("RESOLVED");
  const [resolution, setResolution] = useState("");
  const [reason, setReason] = useState("");
  const [proofRef, setProofRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (exception) {
      setStatus("RESOLVED");
      setResolution("");
      setReason("");
      setProofRef("");
      setError(null);
    }
  }, [exception]);

  if (!exception) return null;
  const valid = resolution.trim().length > 0 && reason.trim().length > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await whPost(`exceptions/${exception.id}/resolve`, { status, resolution: resolution.trim(), reason: reason.trim(), proofRef: proofRef.trim() || null });
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
      open
      onClose={onClose}
      title={`Traiter l'écart : ${exception.typeLabel || exceptionLabel(exception.type)}`}
      footer={
        <>
          <Btn onClick={onClose}>Annuler</Btn>
          <Btn variant="primary" busy={busy} disabled={!valid} onClick={() => void submit()}>
            {status === "RESOLVED" ? "Marquer résolu" : "Classer sans suite"}
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Traiter un écart ne modifie jamais le stock : la correction (déplacer, déclarer introuvable, corriger la variante…) se fait sur la fiche de la paire, puis l'écart est clos ici.
        </p>
        <Segmented<"RESOLVED" | "DISMISSED">
          value={status}
          onChange={setStatus}
          options={[
            { value: "RESOLVED", label: "Résolu" },
            { value: "DISMISSED", label: "Classé sans suite" },
          ]}
        />
        <Field label="Résolution (obligatoire)" hint="Ce qui a été fait ou constaté.">
          <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} className={inputCls + " py-2"} />
        </Field>
        <Field label="Motif (obligatoire)" hint="Pourquoi l'écart s'est produit, ou pourquoi il est classé.">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputCls + " py-2"} />
        </Field>
        <Field label="Référence de preuve (facultatif)" hint="Photo, bordereau, message du partenaire…">
          <input value={proofRef} onChange={(e) => setProofRef(e.target.value)} className={inputCls} />
        </Field>
        {error ? <Notice tone="red">{error}</Notice> : null}
      </div>
    </Modal>
  );
}

function ReconciliationModal({ open, onClose, siteId }: { open: boolean; onClose: () => void; siteId: string | null }) {
  const [data, setData] = useState<Reconciliation | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await whGet<Reconciliation>("reconciliation", { siteId }));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const coherent = data ? data.totalUnits === data.distinctIds && data.rows.reduce((s, r) => s + r.units, 0) === data.totalUnits : true;

  return (
    <Modal open={open} onClose={onClose} wide title="Contrôle de cohérence du stock" footer={<Btn onClick={onClose}>Fermer</Btn>}>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">Stock reconstruit à partir des paires elles-mêmes, par propriétaire et par état. À comparer avec tout export ou total affiché ailleurs.</p>
      <ErrorNote error={error} onRetry={() => void load()} />
      {!data ? (
        loading ? (
          <Loading />
        ) : null
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <div className="text-xs text-slate-500 dark:text-slate-400">Paires</div>
              <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{data.totalUnits}</div>
            </div>
            <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <div className="text-xs text-slate-500 dark:text-slate-400">Identifiants distincts</div>
              <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{data.distinctIds}</div>
            </div>
            <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <div className="text-xs text-slate-500 dark:text-slate-400">Résultat</div>
              <div className="mt-1">{coherent ? <Chip tone="green">Cohérent</Chip> : <Chip tone="red">Incohérence à examiner</Chip>}</div>
            </div>
          </div>
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className={tableCls}>
              <thead className={theadCls + " sticky top-0"}>
                <tr>
                  <Th>Site</Th>
                  <Th>Propriétaire</Th>
                  <Th>Présence</Th>
                  <Th>Contrôle</Th>
                  <Th>Vente</Th>
                  <Th className="text-right">Paires</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} className={rowCls}>
                    <Td className="font-mono text-xs">{r.siteCode ?? "—"}</Td>
                    <Td>{ownerLabel(r.ownerKind, r.ownerName)}</Td>
                    <Td>
                      <Chip tone={PRESENCE[r.presence]?.tone}>{PRESENCE[r.presence]?.label ?? r.presence}</Chip>
                    </Td>
                    <Td>
                      <Chip tone={QC[r.qcState]?.tone}>{QC[r.qcState]?.label ?? r.qcState}</Chip>
                    </Td>
                    <Td>
                      <Chip tone={SALE[r.saleState]?.tone}>{SALE[r.saleState]?.label ?? r.saleState}</Chip>
                    </Td>
                    <Td className="text-right text-base font-semibold tabular-nums">{r.units}</Td>
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

export default function ExceptionsPage() {
  const { siteId, readOnly } = useWarehouse();
  const [tab, setTab] = useState<TabId>("OPEN");
  const [type, setType] = useState<string>("");
  const [items, setItems] = useState<ExceptionRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [openByType, setOpenByType] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [resolving, setResolving] = useState<ExceptionRow | null>(null);
  const [recon, setRecon] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    async (append: boolean, from: string | null) => {
      if (!siteId) return;
      const mine = ++seq.current;
      setLoading(true);
      try {
        const res = await whGet<ListResult>("exceptions", { siteId, status: tab, type: type || undefined, limit: 50, cursor: append ? from : undefined });
        if (mine !== seq.current) return;
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setCursor(res.nextCursor);
        setOpenByType(res.openByType ?? {});
        setError(null);
      } catch (err) {
        if (mine === seq.current) setError(err);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [siteId, tab, type]
  );

  useEffect(() => {
    void load(false, null);
  }, [load]);

  const totalOpen = Object.values(openByType).reduce((s, n) => s + n, 0);
  const types = Object.entries(openByType).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Écarts et contrôles"
        subtitle="Un écart est un fait à arbitrer. Il ne modifie jamais le stock tout seul."
        actions={<Btn onClick={() => setRecon(true)}>Contrôle de cohérence du stock</Btn>}
      />

      <Card flush>
        <div className="px-2">
          <Tabs<TabId>
            value={tab}
            onChange={(t) => {
              setTab(t);
              setType("");
            }}
            tabs={[
              { id: "OPEN", label: "Ouverts", count: totalOpen, tone: "amber" },
              { id: "RESOLVED", label: "Résolus" },
              { id: "DISMISSED", label: "Classés sans suite" },
            ]}
          />
        </div>

        {tab === "OPEN" && types.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setType("")}
              className={cx(
                "min-h-[40px] rounded-lg border px-3 text-sm font-medium",
                type === "" ? "border-[#02C73A] bg-[#E6F9EB] text-[#0A7A2C] dark:bg-emerald-950/60 dark:text-emerald-300" : "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              )}
            >
              Tous <span className="tabular-nums">{totalOpen}</span>
            </button>
            {types.map(([t, n]) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t === type ? "" : t)}
                className={cx(
                  "min-h-[40px] rounded-lg border px-3 text-sm font-medium",
                  type === t ? "border-[#02C73A] bg-[#E6F9EB] text-[#0A7A2C] dark:bg-emerald-950/60 dark:text-emerald-300" : "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                )}
              >
                {exceptionLabel(t)} <span className="tabular-nums">{n}</span>
              </button>
            ))}
          </div>
        ) : null}

        <ErrorNote error={error} className="m-3" onRetry={() => void load(false, null)} />

        {items.length === 0 ? (
          loading ? (
            <Loading />
          ) : (
            <EmptyState title={tab === "OPEN" ? "Aucun écart ouvert" : "Aucun écart dans cette liste"}>{tab === "OPEN" ? "Tout ce qui a été scanné correspond à ce qui est enregistré." : undefined}</EmptyState>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <Th>Type</Th>
                  <Th>Paire</Th>
                  <Th>Niveau</Th>
                  <Th>Lot</Th>
                  <Th>Code lu</Th>
                  <Th>{tab === "OPEN" ? "Ouvert" : "Traitement"}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {items.map((e) => {
                  const info = detailsText(e.details);
                  return (
                    <tr key={e.id} className={rowCls}>
                      <Td>
                        <Chip tone={tab === "OPEN" ? "amber" : "slate"}>{e.typeLabel || exceptionLabel(e.type)}</Chip>
                        {info ? <div className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">{info}</div> : null}
                      </Td>
                      <Td>
                        {e.unitId ? (
                          <Link href={`/warehouse/stock/${e.unitId}`} className="hover:underline">
                            <span className="font-medium text-slate-900 dark:text-slate-100">{e.itemName ?? "Paire"}</span>
                            {e.itemSizeLabel ? <span> · {e.itemSizeLabel}</span> : null}
                            <div className="font-mono text-xs text-[#0A7A2C] dark:text-emerald-400">{e.unitLabelCode ? `${e.unitLabelCode.slice(0, 4)}-${e.unitLabelCode.slice(4, 8)}`.toUpperCase() : ""}</div>
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </Td>
                      <Td className="font-mono text-xs">{e.locationCode ?? "—"}</Td>
                      <Td>
                        {e.batchId ? (
                          <Link href={`/warehouse/receiving/${e.batchId}`} className="font-mono text-xs text-[#0A7A2C] hover:underline dark:text-emerald-400">
                            {e.batchReference ?? "Lot"}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </Td>
                      <Td className="max-w-[180px] break-all font-mono text-xs">{e.rawCode ?? "—"}</Td>
                      <Td className="text-xs text-slate-600 dark:text-slate-300">
                        {tab === "OPEN" ? (
                          <>
                            <div className="whitespace-nowrap font-medium">{fmtAge(e.createdAt)}</div>
                            <div className="text-slate-500">{e.createdByOperatorName ?? ""}</div>
                          </>
                        ) : (
                          <>
                            <div>{e.resolution}</div>
                            <div className="text-slate-500">Motif : {e.resolutionReason ?? "—"}</div>
                            {e.proofRef ? <div className="text-slate-500">Preuve : {e.proofRef}</div> : null}
                            <div className="text-slate-500">
                              {fmtDateTime(e.resolvedAt)}
                              {e.resolvedByOperatorName ? ` · ${e.resolvedByOperatorName}` : ""}
                            </div>
                          </>
                        )}
                      </Td>
                      <Td className="text-right">
                        {tab === "OPEN" ? (
                          <Btn size="sm" variant="primary" disabled={readOnly} onClick={() => setResolving(e)}>
                            Traiter
                          </Btn>
                        ) : null}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {cursor ? (
          <div className="flex justify-center border-t border-slate-200 p-3 dark:border-slate-800">
            <Btn busy={loading} onClick={() => void load(true, cursor)}>
              Charger plus
            </Btn>
          </div>
        ) : null}
      </Card>

      <ResolveModal exception={resolving} onClose={() => setResolving(null)} onDone={() => void load(false, null)} />
      <ReconciliationModal open={recon} onClose={() => setRecon(false)} siteId={siteId} />
    </div>
  );
}
