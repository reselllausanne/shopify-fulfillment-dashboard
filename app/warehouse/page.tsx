"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Overview } from "@/lib/warehouse/overview";
import { whGet, whPost, errorMessage } from "./_lib/api";
import { useWarehouse } from "./_lib/context";
import { exceptionLabel, fmtAge, fmtTime } from "./_lib/format";
import { useLoad } from "./_lib/hooks";
import { BatchTable } from "./_components/BatchTable";
import { Btn, Card, Chip, ErrorNote, KpiTile, Loading, Notice, OccupancyBar, PageHeader } from "./_components/ui";

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "amber" | "red" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2 last:border-0 dark:border-slate-800">
      <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
      <span className={"text-base font-semibold tabular-nums " + (tone === "red" ? "text-red-600 dark:text-red-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-slate-100")}>
        {value}
      </span>
    </div>
  );
}

export default function WarehouseOverviewPage() {
  const { site, readOnly } = useWarehouse();
  const siteCode = site?.code ?? null;
  const overview = useLoad<Overview>(() => whGet<Overview>("overview", { site: siteCode }), [siteCode], { enabled: Boolean(siteCode), intervalMs: 30_000 });
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [journalBusy, setJournalBusy] = useState(false);
  const [journalNote, setJournalNote] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  useEffect(() => {
    if (overview.data) setRefreshedAt(Date.now());
  }, [overview.data]);

  const exportJournal = async () => {
    setJournalBusy(true);
    setJournalNote(null);
    try {
      const r = await whPost<{ exported: number; pending: number; sink: string | null }>("journal/export", {});
      setJournalNote({ tone: "green", text: `${r.exported} entrée(s) exportée(s), ${r.pending} restante(s).` });
      await overview.reload();
    } catch (err) {
      setJournalNote({ tone: "red", text: errorMessage(err) });
    } finally {
      setJournalBusy(false);
    }
  };

  const o = overview.data;
  if (!o) {
    return (
      <div>
        <PageHeader title="Vue d'ensemble" />
        {overview.loading ? <Loading /> : <ErrorNote error={overview.error} onRetry={() => void overview.reload()} />}
      </div>
    );
  }

  const cap = o.capacity;
  const used = cap.occupied + cap.reserved;
  const pct = cap.capacity > 0 ? Math.round((used / cap.capacity) * 100) : 0;
  const byType = Object.entries(o.exceptions.byType).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vue d'ensemble"
        subtitle={`${o.site.code} · ${o.site.name}${o.site.isTest ? " · site de test" : ""} · journée du ${o.today.day.split("-").reverse().join(".")} (${o.today.timezone}) : ${o.today.pairsEntered.toLocaleString("fr-CH")} entrée(s), ${o.today.pairsShelved.toLocaleString("fr-CH")} rangée(s)`}
        actions={
          <>
            <span className="text-xs text-slate-500 dark:text-slate-400">{refreshedAt ? `Mis à jour à ${fmtTime(refreshedAt)} · actualisation toutes les 30 s` : ""}</span>
            <Btn size="sm" busy={overview.loading} onClick={() => void overview.reload()}>
              Actualiser
            </Btn>
          </>
        }
      />
      <ErrorNote error={overview.error} onRetry={() => void overview.reload()} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Paires présentes" value={o.stock.present.toLocaleString("fr-CH")} href="/warehouse/stock" />
        <KpiTile label="Rangées en rayon" value={o.stock.shelved.toLocaleString("fr-CH")} tone="green" />
        <KpiTile label="En zone temporaire" value={o.stock.atTemporary.toLocaleString("fr-CH")} tone={o.stock.atTemporary > 0 ? "amber" : undefined} href="/warehouse/putaway" sub="Réception et chariots" />
        <KpiTile label="Quarantaine" value={o.stock.quarantine.toLocaleString("fr-CH")} tone={o.stock.quarantine > 0 ? "red" : undefined} href="/warehouse/stock?qcState=QUARANTINE" />
        <KpiTile label="Introuvables" value={o.stock.missing.toLocaleString("fr-CH")} tone={o.stock.missing > 0 ? "red" : undefined} href="/warehouse/stock?tab=missing" />
        <KpiTile label="En transit" value={o.stock.inTransit.toLocaleString("fr-CH")} href="/warehouse/stock?tab=transit" sub={o.stock.ownerUnknown > 0 ? `${o.stock.ownerUnknown} sans propriétaire sûr` : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Capacité des rayonnages" subtitle={`${cap.levels.toLocaleString("fr-CH")} niveaux${cap.blockedLevels > 0 ? ` · ${cap.blockedLevels} bloqué(s)` : ""}`} className="xl:col-span-1">
          <div className="flex items-end justify-between gap-3">
            <div className="text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{pct} %</div>
            <div className="text-right text-sm tabular-nums text-slate-600 dark:text-slate-300">
              {used.toLocaleString("fr-CH")} / {cap.capacity.toLocaleString("fr-CH")} places
            </div>
          </div>
          <OccupancyBar className="mt-3 h-3" occupied={cap.occupied} reserved={cap.reserved} capacity={cap.capacity} />
          <div className="mt-3">
            <Stat label="Occupées" value={cap.occupied.toLocaleString("fr-CH")} />
            <Stat label="Réservées (rangement proposé)" value={cap.reserved.toLocaleString("fr-CH")} />
            <Stat label="Libres" value={Math.max(0, cap.capacity - used).toLocaleString("fr-CH")} />
            <Stat label="Capacité totale" value={cap.capacity.toLocaleString("fr-CH")} />
          </div>
          <Link href="/warehouse/locations" className="mt-3 inline-block text-sm font-medium text-[#0A7A2C] underline dark:text-emerald-400">
            Voir les emplacements
          </Link>
        </Card>

        <Card title="Alertes" subtitle={o.alerts.length === 0 ? "Rien à signaler" : `${o.alerts.length} point(s) à traiter`} className="xl:col-span-2" flush>
          {o.alerts.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-6 text-sm text-slate-600 dark:text-slate-300">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E6F9EB] text-[#0A7A2C] dark:bg-emerald-950 dark:text-emerald-300">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5 9-10" />
                </svg>
              </span>
              Aucune alerte sur ce site.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {o.alerts.map((a) => (
                <li key={a.code}>
                  <Link href={a.href} className="flex min-h-[52px] items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <Chip tone={a.level === "critical" ? "red" : "amber"}>{a.level === "critical" ? "Critique" : "Attention"}</Chip>
                    <span className="min-w-0 flex-1 text-sm text-slate-800 dark:text-slate-100">{a.message}</span>
                    <span className="text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">{a.count}</span>
                    <span className="text-slate-400" aria-hidden>
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Lots en cours"
        actions={
          <Link href="/warehouse/receiving" className="text-sm font-medium text-[#0A7A2C] underline dark:text-emerald-400">
            Tous les lots
          </Link>
        }
        flush
      >
        <BatchTable batches={o.openBatches} emptyLabel="Aucun lot en cours." />
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card
          title="Rangement"
          actions={
            <Link href="/warehouse/putaway" className="text-sm font-medium text-[#0A7A2C] underline dark:text-emerald-400">
              Ranger
            </Link>
          }
        >
          <Stat label="Paires à ranger" value={o.putaway.active} tone={o.putaway.active > 0 ? "amber" : undefined} />
          <Stat label="Place proposée" value={o.putaway.reserved} />
          <Stat label="Sans place proposée" value={o.putaway.pending} />
          <Stat label="Bloquées" value={o.putaway.blocked} tone={o.putaway.blocked > 0 ? "red" : undefined} />
          <Stat label="En attente depuis trop longtemps" value={o.putaway.stale} tone={o.putaway.stale > 0 ? "red" : undefined} />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Plus ancienne : {o.putaway.oldestCreatedAt ? fmtAge(o.putaway.oldestCreatedAt) : "—"}</p>
        </Card>

        <Card
          title="Écarts ouverts"
          subtitle={`${o.exceptions.open} au total`}
          actions={
            <Link href="/warehouse/exceptions" className="text-sm font-medium text-[#0A7A2C] underline dark:text-emerald-400">
              Traiter
            </Link>
          }
        >
          {byType.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Aucun écart ouvert.</p>
          ) : (
            byType.map(([type, n]) => <Stat key={type} label={exceptionLabel(type)} value={n} tone="amber" />)
          )}
          {o.partnerRequestsOpen > 0 ? (
            <Link href="/warehouse/partners" className="mt-3 block text-sm font-medium text-[#0A7A2C] underline dark:text-emerald-400">
              {o.partnerRequestsOpen} demande(s) de partenaire en attente
            </Link>
          ) : null}
        </Card>

        <Card
          title="File d'impression"
          actions={
            <Link href="/warehouse/stations" className="text-sm font-medium text-[#0A7A2C] underline dark:text-emerald-400">
              Ouvrir
            </Link>
          }
        >
          <Stat label="En attente" value={o.printing.queued} tone={o.printing.queued > 0 ? "amber" : undefined} />
          <Stat label="En échec" value={o.printing.failed} tone={o.printing.failed > 0 ? "red" : undefined} />
          <Stat label="Incertaines" value={o.printing.uncertain} tone={o.printing.uncertain > 0 ? "red" : undefined} />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Plus ancienne en attente : {o.printing.oldestQueuedAt ? fmtAge(o.printing.oldestQueuedAt) : "—"}</p>
        </Card>

        <Card title="Journal des étiquettes" subtitle="Registre des QR émis, hors base">
          <Stat label="Entrées à exporter" value={o.labelJournal.pendingExport} tone={o.labelJournal.pendingExport > 0 ? "amber" : undefined} />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Plus ancienne : {o.labelJournal.oldestPendingAt ? fmtAge(o.labelJournal.oldestPendingAt) : "—"}</p>
          <p className="mt-1 break-all text-xs text-slate-500 dark:text-slate-400">
            {o.flags.labelJournalDir ? `Dossier : ${o.flags.labelJournalDir}` : "Aucun dossier de journal configuré."}
            {o.flags.labelJournalEnforced ? " · Impression bloquée tant que l'entrée n'est pas exportée." : ""}
          </p>
          <Btn size="sm" className="mt-3" busy={journalBusy} disabled={readOnly || o.labelJournal.pendingExport === 0} onClick={() => void exportJournal()}>
            Exporter maintenant
          </Btn>
          {journalNote ? (
            <Notice tone={journalNote.tone} className="mt-2">
              {journalNote.text}
            </Notice>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
