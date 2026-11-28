"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { PrintOutcome } from "@/lib/warehouse/printing";
import type { ItemSummary, UnitSummary } from "@/lib/warehouse/types";
import { whUrl } from "../_lib/api";
import { PRESENCE, QC, SALE, itemTitle, ownerLabel, ownerTone } from "../_lib/format";
import { Chip, CopyRef, Thumb, cx } from "./ui";

/** Three separate dimensions, never merged into one status. */
export function UnitChips({ unit }: { unit: Pick<UnitSummary, "presence" | "qcState" | "saleState"> }) {
  const p = PRESENCE[unit.presence] ?? { label: unit.presence, tone: "slate" as const };
  const q = QC[unit.qcState] ?? { label: unit.qcState, tone: "slate" as const };
  const s = SALE[unit.saleState] ?? { label: unit.saleState, tone: "slate" as const };
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Chip tone={p.tone} title="Présence">
        {p.label}
      </Chip>
      <Chip tone={q.tone} title="Contrôle">
        {q.label}
      </Chip>
      <Chip tone={s.tone} title="Vente">
        {s.label}
      </Chip>
    </span>
  );
}

export function OwnerChip({ ownerKind, ownerName }: { ownerKind: string; ownerName: string | null | undefined }) {
  return <Chip tone={ownerTone(ownerKind)}>{ownerLabel(ownerKind, ownerName)}</Chip>;
}

export function unitLabelUrl(unitId: string): string {
  return whUrl(`units/${unitId}/label`, { format: "pdf" });
}

/** Compact line for lists inside flows (session scans, level content, putaway). */
export function UnitLine({
  unit,
  right,
  link = true,
}: {
  unit: Pick<UnitSummary, "id" | "labelCode" | "shortRef" | "itemName" | "itemBrand" | "itemSizeLabel" | "itemStyleCode" | "itemImageUrl">;
  right?: ReactNode;
  link?: boolean;
}) {
  const title = itemTitle(unit.itemBrand, unit.itemName);
  return (
    <div className="flex items-center gap-3 py-2">
      <Thumb src={unit.itemImageUrl} size={44} />
      <div className="min-w-0 flex-1">
        {link ? (
          <Link href={`/warehouse/stock/${unit.id}`} className="block truncate text-sm font-medium text-slate-900 hover:underline dark:text-slate-100">
            {title}
          </Link>
        ) : (
          <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{title}</div>
        )}
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-200">Pointure {unit.itemSizeLabel ?? "—"}</span>
          {unit.itemStyleCode ? <span className="font-mono">{unit.itemStyleCode}</span> : null}
          <CopyRef shortRef={unit.shortRef} labelCode={unit.labelCode} />
        </div>
      </div>
      {right ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{right}</div> : null}
    </div>
  );
}

/** The identified variant, readable at arm's length. */
export function ItemHero({ item, gtin, children }: { item: Pick<ItemSummary, "brand" | "name" | "sizeLabel" | "styleCode" | "colorway" | "imageUrl" | "status">; gtin?: string | null; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <Thumb src={item.imageUrl} size={148} alt={item.name} />
      <div className="min-w-0 flex-1">
        {item.brand ? <div className="text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{item.brand}</div> : null}
        <div className="text-2xl font-semibold leading-tight text-slate-900 dark:text-slate-100 md:text-3xl">{item.name}</div>
        <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-1">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Pointure</div>
            <div className="text-4xl font-bold tabular-nums leading-none text-slate-900 dark:text-slate-100 md:text-5xl">{item.sizeLabel ?? "—"}</div>
          </div>
          <div className="space-y-0.5 text-sm text-slate-600 dark:text-slate-300">
            {item.styleCode ? <div className="font-mono">{item.styleCode}</div> : null}
            {item.colorway ? <div>{item.colorway}</div> : null}
            {gtin ? <div className="font-mono text-xs text-slate-500 dark:text-slate-400">GTIN {gtin}</div> : null}
          </div>
          {item.status === "PROVISIONAL" ? <Chip tone="amber">Variante provisoire</Chip> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Where the label went. The PDF stays available in every case. */
export function PrintOutcomeNote({ print, unitId, className }: { print: PrintOutcome | null | undefined; unitId: string; className?: string }) {
  const pdf = (
    <a
      href={unitLabelUrl(unitId)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-900/30 bg-white/70 px-3 text-sm font-semibold text-slate-900 underline-offset-2 hover:underline"
    >
      Ouvrir le PDF
    </a>
  );
  if (!print) return <div className={cx("flex flex-wrap items-center gap-3", className)}>{pdf}</div>;
  if (print.status === "QUEUED") {
    return (
      <div className={cx("flex flex-wrap items-center gap-3", className)}>
        <span>
          Étiquette envoyée{print.deduplicated ? " (déjà en file)" : ""} sur <strong>{print.printerName ?? "l'imprimante du poste"}</strong> · poste {print.stationCode}
        </span>
        {pdf}
      </div>
    );
  }
  return (
    <div className={cx("flex flex-wrap items-center gap-3", className)}>
      <span>
        <strong>Étiquette non envoyée à l'imprimante.</strong> {print.message}
      </span>
      {pdf}
    </div>
  );
}
