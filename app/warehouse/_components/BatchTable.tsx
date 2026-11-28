"use client";

import Link from "next/link";
import type { BatchRow } from "@/lib/warehouse/batches";
import { BATCH_FLOW_LABELS, BATCH_KIND_LABELS, BATCH_STATUS, fmtDateTime, ownerLabel } from "../_lib/format";
import { Chip, EmptyState, Td, Th, rowCls, tableCls, theadCls } from "./ui";

export function BatchTable({ batches, emptyLabel }: { batches: BatchRow[]; emptyLabel: string }) {
  if (batches.length === 0) return <EmptyState title={emptyLabel} />;
  return (
    <div className="overflow-x-auto">
      <table className={tableCls}>
        <thead className={theadCls}>
          <tr>
            <Th>Lot</Th>
            <Th>Type</Th>
            <Th>Propriétaire</Th>
            <Th className="text-right">Paires</Th>
            <Th className="text-right">À ranger</Th>
            <Th className="text-right">Écarts</Th>
            <Th>Statut</Th>
            <Th>Créé le</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => {
            const st = BATCH_STATUS[b.status] ?? { label: b.status, tone: "slate" as const };
            const live = b.status === "OPEN" || b.status === "PAUSED";
            return (
              <tr key={b.id} className={rowCls}>
                <Td>
                  <Link href={`/warehouse/receiving/${b.id}`} className="font-mono text-sm font-medium text-[#0A7A2C] hover:underline dark:text-emerald-400">
                    {b.reference}
                  </Link>
                  {b.title ? <div className="text-xs text-slate-500 dark:text-slate-400">{b.title}</div> : null}
                </Td>
                <Td>
                  <div>{BATCH_KIND_LABELS[b.kind] ?? b.kind}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{BATCH_FLOW_LABELS[b.flow] ?? b.flow}</div>
                </Td>
                <Td>{ownerLabel(b.ownerKind, b.ownerName)}</Td>
                <Td className="text-right font-semibold tabular-nums">{b.unitCount}</Td>
                <Td className="text-right tabular-nums">{b.toPutAwayCount}</Td>
                <Td className="text-right tabular-nums">{b.openExceptionCount > 0 ? <Chip tone="amber">{b.openExceptionCount}</Chip> : "0"}</Td>
                <Td>
                  <Chip tone={st.tone}>{st.label}</Chip>
                  {b.activeLocationCode ? <div className="mt-1 font-mono text-xs text-slate-500">Niveau en cours : {b.activeLocationCode}</div> : null}
                </Td>
                <Td className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">{fmtDateTime(b.createdAt)}</Td>
                <Td className="text-right">
                  <Link
                    href={`/warehouse/receiving/${b.id}`}
                    className={
                      "inline-flex min-h-[44px] items-center rounded-lg px-4 text-sm font-semibold " +
                      (live
                        ? "border border-[#02B334] bg-[#02C73A] text-slate-950 hover:bg-[#02B334]"
                        : "border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800")
                    }
                  >
                    {live ? "Reprendre" : "Ouvrir"}
                  </Link>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
