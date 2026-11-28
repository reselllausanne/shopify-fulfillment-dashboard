"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { UnitDetail } from "@/lib/warehouse/units";
import { whGet } from "../../_lib/api";
import { useWarehouse } from "../../_lib/context";
import {
  BATCH_FLOW_LABELS,
  BOX_LABELS,
  CONDITION_LABELS,
  LOCATION_KIND_LABELS,
  MOVEMENT_LABELS,
  OUT_REASON_LABELS,
  PRESENCE,
  PRICE_STATUS,
  PRINT_STATUS,
  QC,
  SALE,
  exceptionLabel,
  fmtAge,
  fmtDateTime,
  fmtFactor,
  fmtMoney,
  itemTitle,
} from "../../_lib/format";
import { useLoad } from "../../_lib/hooks";
import UnitActionModal, { type UnitActionId } from "../../_components/UnitActions";
import { OwnerChip, UnitChips, unitLabelUrl } from "../../_components/units";
import { Btn, Card, Chip, CopyRef, DefList, EmptyState, ErrorNote, Loading, Notice, Td, Th, Thumb, rowCls, tableCls, theadCls } from "../../_components/ui";

const ORIGIN_LABELS: Record<string, string> = { STOCK_TAKE: "Reprise de stock", RECOVERED: "Récupérée", ...BATCH_FLOW_LABELS };
const CHANGE_KEYS: Record<string, string> = {
  qcState: "Contrôle",
  saleState: "Vente",
  condition: "État",
  boxCondition: "Boîte",
  ownerKind: "Propriétaire",
  itemId: "Variante",
  outReason: "Sortie",
  forced: "Forcé",
  overCapacity: "Capacité dépassée",
  print: "Impression",
  deviatedFrom: "Autre place que prévu",
};
const VALUE_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(QC).map(([k, v]) => [k, v.label])),
  ...Object.fromEntries(Object.entries(SALE).map(([k, v]) => [k, v.label])),
  ...CONDITION_LABELS,
  ...OUT_REASON_LABELS,
  QUEUED: "en file",
  NOT_QUEUED: "non envoyée",
  true: "oui",
  false: "non",
};

function describeChanges(changes: unknown): string | null {
  if (!changes || typeof changes !== "object") return null;
  const parts: string[] = [];
  const show = (v: unknown) => (v === null || v === undefined ? "—" : VALUE_LABELS[String(v)] ?? (typeof v === "object" ? "…" : String(v)));
  for (const [k, v] of Object.entries(changes as Record<string, unknown>)) {
    if (k === "jobId" || k === "sent" || k === "manual" || v === null) continue;
    const label = CHANGE_KEYS[k];
    if (!label) continue;
    if (k === "deviatedFrom") parts.push(label);
    else if (Array.isArray(v) && v.length === 2) {
      if (v[0] !== v[1]) parts.push(`${label} : ${k === "itemId" ? "modifiée" : `${show(v[0])} → ${show(v[1])}`}`);
    } else parts.push(`${label} : ${show(v)}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export default function UnitDetailPage() {
  const { unitId } = useParams<{ unitId: string }>();
  const { isAdmin, readOnly } = useWarehouse();
  const [action, setAction] = useState<UnitActionId | null>(null);
  const detail = useLoad<UnitDetail>(() => whGet<UnitDetail>(`units/${unitId}`), [unitId]);

  if (!detail.data) {
    return detail.loading ? (
      <Loading />
    ) : (
      <div className="space-y-3">
        <Link href="/warehouse/stock" className="text-sm text-slate-500 hover:underline">
          ← Stock
        </Link>
        <ErrorNote error={detail.error} onRetry={() => void detail.reload()} />
      </div>
    );
  }

  const d = detail.data;
  const u = d.unit;
  const present = u.presence === "PRESENT";
  const out = u.presence === "OUT";
  const validated = d.prices.find((p) => p.status === "VALIDATED");

  const actionBtn = (id: UnitActionId, label: string, opts: { show?: boolean; variant?: "primary" | "secondary" | "danger" } = {}) =>
    opts.show === false ? null : (
      <Btn key={id} variant={opts.variant ?? "secondary"} disabled={readOnly} onClick={() => setAction(id)}>
        {label}
      </Btn>
    );

  return (
    <div className="space-y-4">
      <Link href="/warehouse/stock" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
        ← Stock
      </Link>

      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <Thumb src={u.itemImageUrl} size={120} alt={u.itemName} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold leading-tight text-slate-900 dark:text-slate-100">{itemTitle(u.itemBrand, u.itemName)}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="text-lg font-semibold text-slate-900 dark:text-slate-100">Pointure {u.itemSizeLabel ?? "—"}</span>
              {u.itemStyleCode ? <span className="font-mono">{u.itemStyleCode}</span> : null}
              {u.itemGtin ? <span className="font-mono text-xs">GTIN {u.itemGtin}</span> : null}
              {u.itemStatus === "PROVISIONAL" ? <Chip tone="amber">Variante provisoire</Chip> : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <CopyRef shortRef={u.shortRef} labelCode={u.labelCode} large />
              <UnitChips unit={u} />
              <OwnerChip ownerKind={u.ownerKind} ownerName={u.ownerName} />
            </div>
          </div>
          <div className="shrink-0 text-left md:text-right">
            <div className="text-xs text-slate-500 dark:text-slate-400">Emplacement</div>
            <div className="font-mono text-4xl font-bold leading-none tracking-tight text-slate-900 dark:text-slate-100">{u.currentLocationShortCode ?? "—"}</div>
            <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
              {u.currentLocationCode ?? (out ? "Sortie du stock" : u.presence === "MISSING" ? "Introuvable" : "Sans emplacement")}
              {u.currentLocationKind ? ` · ${LOCATION_KIND_LABELS[u.currentLocationKind] ?? u.currentLocationKind}` : ""}
            </div>
          </div>
        </div>
      </div>

      <ErrorNote error={detail.error} onRetry={() => void detail.reload()} />
      {d.activeTask ? (
        <Notice tone="amber">
          Rangement en attente
          {d.activeTask.proposedLocationShortCode ? (
            <>
              {" "}
              : place proposée <span className="font-mono font-semibold">{d.activeTask.proposedLocationShortCode}</span>
            </>
          ) : (
            " : aucune place proposée"
          )}
          {d.activeTask.holdReason ? ` (${d.activeTask.holdReason})` : ""}.{" "}
          <Link href="/warehouse/putaway" className="font-semibold underline">
            Ouvrir le rangement
          </Link>
        </Notice>
      ) : null}

      <Card title="Actions" subtitle={readOnly ? "Lecture seule : aucune action possible." : "Chaque action est tracée dans l'historique de la paire."}>
        <div className="flex flex-wrap gap-2">
          {actionBtn("qc-pass", "Valider le contrôle", { show: !out && u.qcState !== "PASSED", variant: "primary" })}
          {actionBtn("qc-quarantine", "Quarantaine", { show: !out && u.qcState !== "QUARANTINE" })}
          {actionBtn("qc-pending", "Remettre à contrôler", { show: !out && u.qcState !== "PENDING" })}
          {actionBtn("sale-authorize", "Autoriser la vente", { show: isAdmin && !out && u.saleState !== "SALE_AUTHORIZED" })}
          {actionBtn("sale-block", "Bloquer la vente", { show: isAdmin && !out && u.saleState !== "BLOCKED" })}
          {actionBtn("sale-storage", "Stockage seul", { show: isAdmin && !out && u.saleState !== "STORAGE_ONLY" })}
          {actionBtn("condition", "État", { show: !out })}
          {actionBtn("relocate", u.presence === "MISSING" ? "Paire retrouvée" : "Déplacer", { show: present || u.presence === "MISSING", variant: u.presence === "MISSING" ? "primary" : "secondary" })}
          {actionBtn("item", "Corriger la variante", { show: !out })}
          {actionBtn("owner", "Changer de propriétaire", { show: isAdmin && !out })}
          {actionBtn("reprint", "Réimprimer l'étiquette", { show: !out })}
          <a
            href={unitLabelUrl(u.id)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Ouvrir le PDF
          </a>
          {actionBtn("external-ref", "Ajouter une référence externe")}
          {actionBtn("confirm-item", "Confirmer l'article", { show: isAdmin && u.itemStatus === "PROVISIONAL", variant: "primary" })}
          {actionBtn("duplicate-label", "Étiquette en double", { show: !out })}
          {actionBtn("missing", "Déclarer introuvable", { show: present, variant: "danger" })}
          {actionBtn("out", "Sortie", { show: isAdmin && !out, variant: "danger" })}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Identité" subtitle="L'identifiant et le code de l'étiquette ne changent jamais.">
          <DefList
            rows={[
              ["Identifiant (UUID)", <span key="id" className="break-all font-mono text-xs">{u.id}</span>],
              ["Code de l'étiquette", <span key="lc" className="break-all font-mono text-xs">{u.labelCode}</span>],
              ["Site d'émission", <span key="is" className="font-mono">{u.issuingSiteCode}</span>],
              ["Site actuel", <span key="cs" className="font-mono">{u.currentSiteCode ?? "—"}</span>],
              ["Origine", ORIGIN_LABELS[u.originType] ?? u.originType],
              [
                "Lot d'origine",
                u.originBatchId ? (
                  <Link key="b" href={`/warehouse/receiving/${u.originBatchId}`} className="text-[#0A7A2C] underline dark:text-emerald-400">
                    Ouvrir le lot
                  </Link>
                ) : (
                  "—"
                ),
              ],
              ["Reçue le", fmtDateTime(u.receivedAt)],
              ["Version", <span key="v" className="tabular-nums">{u.version}</span>],
            ]}
          />
        </Card>
        <Card title="État courant">
          <DefList
            rows={[
              ["Présence", <Chip key="p" tone={PRESENCE[u.presence]?.tone}>{PRESENCE[u.presence]?.label ?? u.presence}</Chip>],
              ["Contrôle", <Chip key="q" tone={QC[u.qcState]?.tone}>{QC[u.qcState]?.label ?? u.qcState}</Chip>],
              ["Droit de vente", <Chip key="s" tone={SALE[u.saleState]?.tone}>{SALE[u.saleState]?.label ?? u.saleState}</Chip>],
              ["État de la paire", CONDITION_LABELS[u.condition] ?? u.condition],
              ["Boîte", BOX_LABELS[u.boxCondition] ?? u.boxCondition],
              ["Précision", u.conditionNote ?? "—"],
              ["Motif de sortie", u.outReason ? OUT_REASON_LABELS[u.outReason] ?? u.outReason : "—"],
              ["Dernier constat", fmtDateTime(u.observedAt)],
              [
                "Étiquette",
                <span key="l">
                  imprimée {u.labelPrintCount} fois ·{" "}
                  {u.labelVerifiedAt ? <span className="text-[#0A7A2C] dark:text-emerald-400">vérifiée par scan le {fmtDateTime(u.labelVerifiedAt)}</span> : <span className="text-amber-700 dark:text-amber-400">pas encore vérifiée par scan</span>}
                </span>,
              ],
              ["Prix public validé", validated ? fmtMoney(validated.publicPrice, validated.currency) : "—"],
            ]}
          />
          {u.historyArchivedAt ? <p className="mt-3 text-xs text-slate-500">Historique ancien archivé le {fmtDateTime(u.historyArchivedAt)}{u.historyArchiveRef ? ` (${u.historyArchiveRef})` : ""}.</p> : null}
        </Card>
      </div>

      <Card title="Historique des mouvements" subtitle={`${d.movements.length} mouvement(s), du plus récent au plus ancien`} flush>
        {d.movements.length === 0 ? (
          <EmptyState title="Aucun mouvement" />
        ) : (
          <ol className="divide-y divide-slate-100 dark:divide-slate-800">
            {d.movements.map((m) => {
              const changes = describeChanges(m.changes);
              const moved = m.fromLocationCode !== m.toLocationCode;
              return (
                <li key={m.id} className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[170px_1fr]">
                  <div>
                    <div className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">{fmtDateTime(m.observedAt)}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {m.operatorName ?? (m.actorRole === "system" ? "Système" : m.actorRole === "admin" ? "Gestionnaire" : m.actorRole === "logistics" ? "Logistique" : "—")}
                      {m.stationCode ? ` · ${m.stationCode}` : ""}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip>{MOVEMENT_LABELS[m.type] ?? m.type}</Chip>
                      {moved ? (
                        <span className="font-mono text-sm text-slate-800 dark:text-slate-100">
                          {m.fromLocationCode ?? (m.fromSiteCode ? `(${m.fromSiteCode})` : "—")} → {m.toLocationCode ?? (m.toSiteCode && m.toSiteCode !== m.fromSiteCode ? `(${m.toSiteCode})` : "—")}
                        </span>
                      ) : null}
                    </div>
                    {changes ? <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">{changes}</div> : null}
                    {m.reason ? <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">Motif : {m.reason}</div> : null}
                    {m.note ? <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">Note : {m.note}</div> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Prix" flush>
          {d.prices.length === 0 ? (
            <EmptyState title="Aucun prix" />
          ) : (
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <Th>Statut</Th>
                    <Th className="text-right">Prix public</Th>
                    <Th className="text-right">Net déposant</Th>
                    <Th className="text-right">Frais</Th>
                    <Th>Source</Th>
                    <Th>Date</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.prices.map((p) => (
                    <tr key={p.id} className={rowCls}>
                      <Td>
                        <Chip tone={PRICE_STATUS[p.status]?.tone}>{PRICE_STATUS[p.status]?.label ?? p.status}</Chip>
                      </Td>
                      <Td className="text-right font-semibold tabular-nums">{fmtMoney(p.publicPrice, p.currency)}</Td>
                      <Td className="text-right tabular-nums">{fmtMoney(p.sellerNet, p.currency)}</Td>
                      <Td className="text-right tabular-nums">{fmtMoney(p.fees, p.currency)}</Td>
                      <Td className="text-xs">
                        {p.source === "STOCKX_BUYNOW_FACTOR" ? `StockX ${fmtMoney(p.basisAmount, "")} × ${fmtFactor(p.factor)}` : "Saisie"}
                        {p.note ? <div className="text-slate-500">{p.note}</div> : null}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDateTime(p.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Impressions de l'étiquette" flush>
          {d.printJobs.length === 0 ? (
            <EmptyState title="Aucune impression demandée" />
          ) : (
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <Th>État</Th>
                    <Th>Poste · Imprimante</Th>
                    <Th>Motif</Th>
                    <Th>Date</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.printJobs.map((j) => (
                    <tr key={j.id} className={rowCls}>
                      <Td>
                        <Chip tone={PRINT_STATUS[j.status]?.tone}>{PRINT_STATUS[j.status]?.label ?? j.status}</Chip>
                        {j.isReprint ? <Chip className="ml-1">Réimpression</Chip> : null}
                      </Td>
                      <Td className="text-xs">
                        {j.stationCode ?? "—"} · {j.printerName ?? "—"}
                        {j.lastError ? <div className="text-red-700 dark:text-red-400">{j.lastError}</div> : null}
                      </Td>
                      <Td className="text-xs">{j.reason ?? "—"}</Td>
                      <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDateTime(j.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Codes de l'étiquette">
          <ul className="space-y-2">
            {d.labelCodes.map((c) => (
              <li key={c.code} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="break-all font-mono text-xs">{c.code}</span>
                {c.isOriginal ? <Chip tone="green">Code d'origine</Chip> : <Chip>Alias</Chip>}
                <span className="text-xs text-slate-500">émis le {fmtDateTime(c.issuedAt)}</span>
                {c.note ? <span className="text-xs text-slate-500">· {c.note}</span> : null}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Références externes">
          {d.externalRefs.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Aucune référence externe.</p>
          ) : (
            <ul className="space-y-2">
              {d.externalRefs.map((r) => (
                <li key={`${r.namespace}-${r.value}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <Chip>{r.namespace}</Chip>
                  <span className="break-all font-mono text-xs">{r.value}</span>
                  {r.note ? <span className="text-xs text-slate-500">· {r.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Écarts ouverts">
          {d.openExceptions.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Aucun écart ouvert sur cette paire.</p>
          ) : (
            <ul className="space-y-2">
              {d.openExceptions.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Chip tone="amber">{exceptionLabel(e.type)}</Chip>
                  <span className="text-xs text-slate-500">{fmtAge(e.createdAt)}</span>
                  <Link href="/warehouse/exceptions" className="text-sm font-medium text-[#0A7A2C] underline dark:text-emerald-400">
                    Traiter
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {d.allocations.length > 0 ? (
          <Card title="Réservations pour une vente">
            <ul className="space-y-2">
              {d.allocations.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Chip tone={a.status === "ACTIVE" ? "amber" : "slate"}>{a.status}</Chip>
                  <span>{a.channel}</span>
                  <span className="font-mono text-xs">{a.orderRef}</span>
                  <span className="text-xs text-slate-500">{fmtDateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      <UnitActionModal action={action} detail={d} onClose={() => setAction(null)} onDone={() => void detail.reload()} />
    </div>
  );
}
