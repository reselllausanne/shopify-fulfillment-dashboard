"use client";

import { useEffect, useRef, useState } from "react";
import type { GtinResolution } from "@/lib/warehouse/items";
import type { BoxCondition, CatalogCandidate, ItemSummary, UnitCondition } from "@/lib/warehouse/types";
import { errorMessage, whGet, whPost } from "../_lib/api";
import { itemTitle } from "../_lib/format";
import { ItemHero } from "./units";
import { Btn, Chip, ErrorNote, Field, Notice, Segmented, Spinner, Thumb, Toggle, inputCls } from "./ui";

/**
 * Identification of ONE box before the single explicit confirmation.
 * A GTIN identifies a variant, never a pair: nothing is created here except, at confirmation
 * time, the warehouse variant of a chosen catalogue candidate.
 */
export type Ident =
  | { step: "none" }
  | { step: "candidates"; gtin: string; checksumValid: boolean; candidates: CatalogCandidate[]; agree: boolean }
  | { step: "items"; gtin: string; checksumValid: boolean; items: ItemSummary[] }
  | { step: "unknown"; gtin: string | null; checksumValid: boolean }
  | { step: "ready"; gtin: string | null; item: ItemSummary | null; candidate: CatalogCandidate | null };

export const NO_IDENT: Ident = { step: "none" };

export function identFromGtin(res: GtinResolution): Ident {
  switch (res.status) {
    case "ITEM":
      return { step: "ready", gtin: res.gtin, item: res.item, candidate: null };
    case "AMBIGUOUS_ITEMS":
      return { step: "items", gtin: res.gtin, checksumValid: res.checksumValid, items: res.items };
    case "CANDIDATES":
      // All sources agree: the candidate is preselected, the variant is created at confirmation.
      if (res.agree && res.candidates.length > 0) return { step: "ready", gtin: res.gtin, item: null, candidate: res.candidates[0] };
      return { step: "candidates", gtin: res.gtin, checksumValid: res.checksumValid, candidates: res.candidates, agree: res.agree };
    default:
      return { step: "unknown", gtin: res.gtin, checksumValid: res.checksumValid };
  }
}

export function identGtin(ident: Ident): string | null {
  return ident.step === "none" ? null : ident.gtin;
}

export function identLabel(ident: Ident): string {
  if (ident.step !== "ready") return "Boîte";
  const src = ident.item ?? ident.candidate;
  return src ? `${itemTitle(src.brand, src.name)} · ${src.sizeLabel ?? "pointure ?"}` : "Boîte";
}

/** Turn a ready identification into a warehouse variant (creates it from the candidate if needed). */
export async function materializeItem(ident: Ident): Promise<ItemSummary> {
  if (ident.step !== "ready") throw new Error("Aucune variante identifiée.");
  if (ident.item) return ident.item;
  if (!ident.candidate) throw new Error("Aucune variante identifiée.");
  const res = await whPost<{ item: ItemSummary; created: boolean }>("items/from-candidate", { candidate: ident.candidate });
  return res.item;
}

function candidateAsItem(c: CatalogCandidate): Pick<ItemSummary, "brand" | "name" | "sizeLabel" | "styleCode" | "colorway" | "imageUrl" | "status"> {
  return { brand: c.brand, name: c.name, sizeLabel: c.sizeLabel, styleCode: c.styleCode, colorway: c.colorway, imageUrl: c.imageUrl, status: "ACTIVE" };
}

function ChoiceRow({
  image,
  brand,
  name,
  size,
  styleCode,
  colorway,
  badge,
  onPick,
  disabled,
}: {
  image: string | null;
  brand: string | null;
  name: string;
  size: string | null;
  styleCode: string | null;
  colorway?: string | null;
  badge?: string;
  onPick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className="flex min-h-[72px] w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-[#02C73A] hover:bg-[#E6F9EB]/40 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-emerald-950/30"
    >
      <Thumb src={image} size={56} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-slate-900 dark:text-slate-100">{itemTitle(brand, name)}</span>
        <span className="flex flex-wrap items-center gap-x-3 text-sm text-slate-600 dark:text-slate-300">
          <span className="font-semibold">Pointure {size ?? "—"}</span>
          {styleCode ? <span className="font-mono text-xs">{styleCode}</span> : null}
          {colorway ? <span className="truncate text-xs">{colorway}</span> : null}
        </span>
      </span>
      {badge ? <Chip>{badge}</Chip> : null}
      <span className="shrink-0 text-sm font-semibold text-[#0A7A2C] dark:text-emerald-400">Choisir</span>
    </button>
  );
}

const SOURCE_LABEL: Record<string, string> = { KICKDB: "Catalogue", SUPPLIER_VARIANT: "Fournisseur", MANUAL: "Saisie" };

/** Manual search in known variants and in the catalogue, or a provisional variant. */
function ManualIdentify({ gtin, onPick, busy }: { gtin: string | null; onPick: (ident: Ident) => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [candidates, setCandidates] = useState<CatalogCandidate[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", brand: "", sizeLabel: "", styleCode: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) {
      setItems([]);
      setCandidates([]);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const [a, b] = await Promise.all([whGet<ItemSummary[]>("items/search", { q: query }), whGet<CatalogCandidate[]>("items/catalog", { q: query })]);
        if (mine !== seq.current) return;
        setItems(a);
        setCandidates(b);
        setError(null);
      } catch (err) {
        if (mine === seq.current) setError(err);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const create = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await whPost<{ item: ItemSummary; created: boolean }>("items", {
        gtin: gtin ?? undefined,
        name: form.name,
        brand: form.brand || undefined,
        sizeLabel: form.sizeLabel || undefined,
        styleCode: form.styleCode || undefined,
        provisional: true,
      });
      onPick({ step: "ready", gtin, item: res.item, candidate: null });
    } catch (err) {
      // The typed values stay in the form.
      setCreateError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-3">
      <Field label="Chercher la variante (modèle, référence, pointure)">
        <div className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ex. dunk low panda 42" className={inputCls} autoComplete="off" />
          {loading ? (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Spinner small />
            </span>
          ) : null}
        </div>
      </Field>
      <ErrorNote error={error} />
      {items.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Variantes déjà connues de l'entrepôt</div>
          {items.slice(0, 12).map((it) => (
            <ChoiceRow
              key={it.id}
              image={it.imageUrl}
              brand={it.brand}
              name={it.name}
              size={it.sizeLabel}
              styleCode={it.styleCode}
              colorway={it.colorway}
              badge={it.status === "PROVISIONAL" ? "Provisoire" : undefined}
              disabled={busy}
              onPick={() => onPick({ step: "ready", gtin, item: it, candidate: null })}
            />
          ))}
        </div>
      ) : null}
      {candidates.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Catalogue</div>
          {candidates.slice(0, 20).map((c, i) => (
            <ChoiceRow
              key={`${c.source}-${c.kickdbVariantId ?? c.supplierVariantId ?? i}`}
              image={c.imageUrl}
              brand={c.brand}
              name={c.name}
              size={c.sizeLabel}
              styleCode={c.styleCode}
              colorway={c.colorway}
              badge={SOURCE_LABEL[c.source]}
              disabled={busy}
              onPick={() => onPick({ step: "ready", gtin: gtin ?? c.gtin ?? null, item: null, candidate: c })}
            />
          ))}
        </div>
      ) : null}
      {q.trim().length >= 3 && !loading && items.length === 0 && candidates.length === 0 && !error ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Aucun résultat pour cette recherche.</p>
      ) : null}

      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        {!showCreate ? (
          <Btn onClick={() => setShowCreate(true)}>Créer une variante provisoire</Btn>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
            className="space-y-3"
          >
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Variante provisoire</div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              La paire sera enregistrée, mais non vendable tant que la variante n'est pas confirmée.
              {gtin ? ` Le GTIN ${gtin} lui sera rattaché.` : ""}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Modèle (obligatoire)">
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Pointure (obligatoire)">
                <input required value={form.sizeLabel} onChange={(e) => setForm({ ...form, sizeLabel: e.target.value })} className={inputCls} placeholder="ex. 42.5" />
              </Field>
              <Field label="Marque">
                <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Référence du modèle">
                <input value={form.styleCode} onChange={(e) => setForm({ ...form, styleCode: e.target.value })} className={inputCls} />
              </Field>
            </div>
            {createError ? <Notice tone="red">{createError}</Notice> : null}
            <div className="flex gap-2">
              <Btn type="submit" variant="primary" busy={creating} disabled={!form.name.trim() || !form.sizeLabel.trim()}>
                Utiliser cette variante
              </Btn>
              <Btn onClick={() => setShowCreate(false)}>Fermer</Btn>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Choice screens between the scan and the confirmation. Renders nothing for `none` / `ready`. */
export function IdentifyPanel({ ident, onPick, onCancel, busy }: { ident: Ident; onPick: (next: Ident) => void; onCancel: () => void; busy: boolean }) {
  if (ident.step === "none" || ident.step === "ready") return null;
  return (
    <div className="rounded-lg border border-[#FBEBC8] bg-white p-4 dark:border-amber-800 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {ident.step === "candidates" ? "Plusieurs fiches pour ce code-barres : choisissez la bonne" : ident.step === "items" ? "Ce code-barres désigne plusieurs variantes : choisissez" : "Variante inconnue : identifiez la boîte"}
          </div>
          <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {ident.gtin ? <span className="font-mono">GTIN {ident.gtin}</span> : "Sans code-barres"}
            {ident.gtin && !ident.checksumValid ? <span className="ml-2 text-amber-700 dark:text-amber-400">Clé de contrôle invalide : vérifiez la lecture.</span> : null}
          </div>
        </div>
        <Btn onClick={onCancel}>Annuler cette boîte</Btn>
      </div>

      {ident.step === "candidates" ? (
        <div className="space-y-2">
          {ident.candidates.map((c, i) => (
            <ChoiceRow
              key={`${c.source}-${c.kickdbVariantId ?? c.supplierVariantId ?? i}`}
              image={c.imageUrl}
              brand={c.brand}
              name={c.name}
              size={c.sizeLabel}
              styleCode={c.styleCode}
              colorway={c.colorway}
              badge={SOURCE_LABEL[c.source]}
              disabled={busy}
              onPick={() => onPick({ step: "ready", gtin: ident.gtin, item: null, candidate: c })}
            />
          ))}
          <div className="pt-2">
            <Btn variant="ghost" onClick={() => onPick({ step: "unknown", gtin: ident.gtin, checksumValid: ident.checksumValid })}>
              Aucune ne correspond
            </Btn>
          </div>
        </div>
      ) : null}

      {ident.step === "items" ? (
        <div className="space-y-2">
          {ident.items.map((it) => (
            <ChoiceRow
              key={it.id}
              image={it.imageUrl}
              brand={it.brand}
              name={it.name}
              size={it.sizeLabel}
              styleCode={it.styleCode}
              colorway={it.colorway}
              badge={it.status === "PROVISIONAL" ? "Provisoire" : undefined}
              disabled={busy}
              onPick={() => onPick({ step: "ready", gtin: ident.gtin, item: it, candidate: null })}
            />
          ))}
        </div>
      ) : null}

      {ident.step === "unknown" ? <ManualIdentify gtin={ident.gtin} onPick={onPick} busy={busy} /> : null}
    </div>
  );
}

/** `boxProfile`: STANDARD shoe box, or LARGE (boots, double box) — only levels of that format are proposed. */
export type BoxOptions = { condition: UnitCondition; boxCondition: BoxCondition; boxProfile: "STANDARD" | "LARGE"; flag: boolean };
export const DEFAULT_BOX_OPTIONS: BoxOptions = { condition: "NEW", boxCondition: "GOOD", boxProfile: "STANDARD", flag: false };

/** The single explicit confirmation of a box: large variant, state toggles, one big button. */
export function ConfirmBoxCard({
  ident,
  options,
  onOptions,
  flagLabel,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
  disabled,
  disabledReason,
}: {
  ident: Ident;
  options: BoxOptions;
  onOptions: (next: BoxOptions) => void;
  flagLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  if (ident.step !== "ready") return null;
  const view = ident.item ?? (ident.candidate ? candidateAsItem(ident.candidate) : null);
  if (!view) return null;
  return (
    <div className="rounded-lg border-2 border-amber-400 bg-white p-4 dark:bg-slate-900">
      <ItemHero item={view} gtin={ident.gtin} />
      {!ident.item && ident.candidate ? <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Fiche du catalogue : la variante sera ajoutée à l'entrepôt à la confirmation.</p> : null}

      <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3">
        <div>
          <div className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">État de la paire</div>
          <Segmented<UnitCondition>
            size="lg"
            value={options.condition}
            onChange={(condition) => onOptions({ ...options, condition })}
            options={[
              { value: "NEW", label: "Neuf" },
              { value: "USED", label: "Utilisé" },
              { value: "DAMAGED", label: "Abîmé" },
            ]}
          />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Boîte</div>
          <Segmented<BoxCondition>
            size="lg"
            value={options.boxCondition}
            onChange={(boxCondition) => onOptions({ ...options, boxCondition })}
            options={[
              { value: "GOOD", label: "Bonne" },
              { value: "DAMAGED", label: "Abîmée" },
              { value: "MISSING", label: "Sans boîte" },
            ]}
          />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Format</div>
          <Segmented<BoxOptions["boxProfile"]>
            size="lg"
            value={options.boxProfile}
            onChange={(boxProfile) => onOptions({ ...options, boxProfile })}
            options={[
              { value: "STANDARD", label: "Standard" },
              { value: "LARGE", label: "Grande" },
            ]}
          />
        </div>
        <div>
          <Toggle checked={options.flag} onChange={(flag) => onOptions({ ...options, flag })} label={flagLabel} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Btn variant="primary" size="xl" className="min-w-[260px] flex-1 sm:flex-none" busy={busy} disabled={disabled} onClick={onConfirm}>
          {confirmLabel}
          <kbd className="ml-1 hidden rounded border border-slate-900/30 px-1.5 py-0.5 text-xs font-medium sm:inline">Entrée</kbd>
        </Btn>
        <Btn size="xl" disabled={busy} onClick={onCancel}>
          Annuler
          <kbd className="ml-1 hidden rounded border border-slate-300 px-1.5 py-0.5 text-xs font-medium dark:border-slate-600 sm:inline">Échap</kbd>
        </Btn>
        {disabled && disabledReason ? <span className="text-sm text-amber-700 dark:text-amber-400">{disabledReason}</span> : null}
      </div>
    </div>
  );
}
