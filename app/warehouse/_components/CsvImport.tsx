"use client";

import { useEffect, useRef, useState } from "react";
import type { ImportKind, ImportView } from "@/lib/warehouse/imports";
import { errorMessage, whGet, whPost } from "../_lib/api";
import { Btn, Chip, Notice, Td, Th, inputCls, rowCls, tableCls, theadCls } from "./ui";

const ROW_STATUS: Record<string, { label: string; tone: "green" | "amber" | "red" | "slate" }> = {
  PENDING: { label: "À importer", tone: "amber" },
  APPLIED: { label: "Importée", tone: "green" },
  ERROR: { label: "Erreur", tone: "red" },
  SKIPPED: { label: "Ignorée", tone: "slate" },
};

/**
 * Assisted CSV import in two steps: preview (every line validated, nothing written), then apply.
 * The import id is kept in sessionStorage: after a reload or a cut, "Reprendre" applies only the
 * lines that are still pending (the server never imports a line twice).
 */
export default function CsvImport({
  kind,
  targetId,
  columns,
  example,
  onApplied,
  disabled,
}: {
  kind: ImportKind;
  targetId: string;
  /** Human description of the expected columns. */
  columns: string;
  example: string;
  onApplied?: (view: ImportView) => void;
  disabled?: boolean;
}) {
  const storageKey = `warehouse.import.${kind}.${targetId}`;
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("import.csv");
  const [view, setView] = useState<ImportView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    let id: string | null = null;
    try {
      id = window.sessionStorage.getItem(storageKey);
    } catch {
      id = null;
    }
    if (!id) return;
    whGet<ImportView>(`imports/${id}`)
      .then((v) => {
        if (!cancelled && v.status !== "APPLIED") setView(v);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const remember = (v: ImportView | null) => {
    setView(v);
    try {
      if (v && v.status !== "APPLIED") window.sessionStorage.setItem(storageKey, v.id);
      else window.sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  };

  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      remember(await whPost<ImportView>("imports/preview", { kind, targetId, filename, csv }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const next = await whPost<ImportView>(`imports/${view.id}/apply`, {}, { timeoutMs: 120_000 });
      remember(next);
      onApplied?.(next);
    } catch (err) {
      setError(`${errorMessage(err)} Les lignes déjà importées le restent : utilisez « Reprendre ».`);
      // Refresh what the server knows about this import.
      whGet<ImportView>(`imports/${view.id}`)
        .then(setView)
        .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const rows = view ? (onlyErrors ? view.rows.filter((r) => r.error) : view.rows) : [];
  const headers = view && view.rows[0] ? Object.keys(view.rows[0].raw) : [];

  return (
    <div className="space-y-3">
      {!view ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Colonnes attendues : <span className="font-medium">{columns}</span>. Séparateur virgule ou point-virgule. Les GTIN doivent rester au format texte.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFilename(f.name);
                setCsv(await f.text());
                e.target.value = "";
              }}
            />
            <Btn onClick={() => fileRef.current?.click()} disabled={disabled}>
              Choisir un fichier CSV
            </Btn>
            <span className="text-xs text-slate-500 dark:text-slate-400">{csv ? `${filename} · ${csv.split(/\r?\n/).filter((l) => l.trim()).length} ligne(s)` : "ou collez le contenu ci-dessous"}</span>
          </div>
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={6} placeholder={example} spellCheck={false} className={inputCls + " py-2 font-mono text-xs"} />
          <div className="flex gap-2">
            <Btn variant="primary" busy={busy} disabled={disabled || !csv.trim()} onClick={() => void preview()}>
              Vérifier le fichier
            </Btn>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{view.filename}</span>
            <Chip>{view.totalRows} ligne(s)</Chip>
            <Chip tone="green">{view.appliedRows} importée(s)</Chip>
            {view.pendingRows > 0 ? <Chip tone="amber">{view.pendingRows} à importer</Chip> : null}
            {view.errorRows > 0 ? <Chip tone="red">{view.errorRows} en erreur</Chip> : null}
          </div>
          {view.alreadyImported ? <Notice tone="amber">Ce fichier a déjà été chargé : seules les lignes restantes seront importées, sans doublon.</Notice> : null}
          {view.status === "APPLIED" ? <Notice tone="green">Import terminé.</Notice> : null}
          {view.errorRows > 0 ? (
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} className="h-5 w-5" />
              N'afficher que les lignes en erreur
            </label>
          ) : null}
          <div className="max-h-[360px] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className={tableCls}>
              <thead className={theadCls + " sticky top-0"}>
                <tr>
                  <Th>Ligne</Th>
                  {headers.map((h) => (
                    <Th key={h}>{h}</Th>
                  ))}
                  <Th>Statut</Th>
                  <Th>Message</Th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r) => {
                  const st = ROW_STATUS[r.status] ?? { label: r.status, tone: "slate" as const };
                  return (
                    <tr key={r.rowNumber} className={rowCls}>
                      <Td className="tabular-nums text-slate-500">{r.rowNumber}</Td>
                      {headers.map((h) => (
                        <Td key={h} className="font-mono text-xs">
                          {r.raw[h] ?? ""}
                        </Td>
                      ))}
                      <Td>
                        <Chip tone={st.tone}>{st.label}</Chip>
                      </Td>
                      <Td className="text-xs text-red-700 dark:text-red-400">{r.error ?? ""}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length > 500 ? <p className="text-xs text-slate-500">500 premières lignes affichées sur {rows.length}.</p> : null}
          <div className="flex flex-wrap gap-2">
            {view.pendingRows > 0 ? (
              <Btn variant="primary" busy={busy} disabled={disabled} onClick={() => void apply()}>
                {view.appliedRows > 0 ? "Reprendre l'import" : `Importer ${view.pendingRows} ligne(s)`}
              </Btn>
            ) : null}
            <Btn
              disabled={busy}
              onClick={() => {
                remember(null);
                setCsv("");
                setError(null);
              }}
            >
              {view.status === "APPLIED" ? "Nouvel import" : "Changer de fichier"}
            </Btn>
          </div>
          {view.errorRows > 0 && view.pendingRows > 0 ? <p className="text-xs text-slate-500 dark:text-slate-400">Les lignes en erreur ne sont pas importées ; corrigez-les dans le fichier puis rechargez-le.</p> : null}
        </>
      )}
      {error ? <Notice tone="red">{error}</Notice> : null}
    </div>
  );
}
