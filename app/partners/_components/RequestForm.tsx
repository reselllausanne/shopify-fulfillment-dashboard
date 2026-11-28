"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import {
  errorMessage,
  partnerApi,
  type PartnerItemGroup,
  type PartnerRequestType,
  type PartnerUnitRow,
} from "../_lib/api";
import { formatMoney, pairs, productTitle } from "../_lib/format";
import { NO_PRICE_LABEL, REQUEST_TYPE_LABELS } from "../_lib/labels";
import { usePartnerPortal } from "../_lib/portal";
import { useApi, useDebounced } from "../_lib/useApi";
import { Button } from "./Button";
import { CloseIcon, SearchIcon } from "./icons";
import { Notice } from "./Notice";
import { ProductThumb } from "./ProductThumb";
import { Skeleton } from "./Skeleton";
import { FOCUS, HAIRLINE, HINT, INPUT, LABEL, LINK, TEXT, TEXT_FAINT, TEXT_MUTED, cx } from "./ui";

/** The fields of a pair that the form shows. */
export type RequestUnit = Pick<
  PartnerUnitRow,
  "id" | "shortRef" | "itemName" | "itemBrand" | "itemSizeLabel" | "itemStyleCode" | "itemImageUrl" | "currency" | "publicPrice"
>;

const ALL_TYPES: PartnerRequestType[] = ["PRICE_CHANGE", "DISCREPANCY", "OTHER"];
const MESSAGE_MAX = 1800;
const PRICE_PATTERN = /^\d{1,7}(?:[.,]\d{1,2})?$/;
// Currency recorded by default on a request when the pair has no price yet.
const DEFAULT_CURRENCY = "CHF";

const PLACEHOLDERS: Record<PartnerRequestType, string> = {
  PRICE_CHANGE: "Expliquez votre demande (par exemple : prix constaté sur le marché, à quelle date).",
  DISCREPANCY: "Décrivez l'écart constaté (par exemple : pointure, état de la paire ou de la boîte, paire manquante).",
  OTHER: "Votre message.",
};

type RequestFormProps = {
  /** The request is about this pair (pair detail). */
  unit?: RequestUnit | null;
  /** The request is about this model and size (prices screen): one pair or all of them. */
  group?: PartnerItemGroup | null;
  /** Pair to preselect in the picker (ignored when `unit` or `group` is given). */
  initialUnitId?: string | null;
  types?: PartnerRequestType[];
  defaultType?: PartnerRequestType;
  onCreated?: () => void;
  onCancel?: () => void;
  /** Hide the link to the requests screen in the confirmation (already on that screen). */
  hideRequestsLink?: boolean;
};

function unitLine(unit: RequestUnit): string {
  const size = unit.itemSizeLabel ? ` — pointure ${unit.itemSizeLabel}` : "";
  return `${productTitle(unit.itemBrand, unit.itemName)}${size}`;
}

function SelectedUnit({ unit, onRemove }: { unit: RequestUnit; onRemove?: () => void }) {
  const price = formatMoney(unit.publicPrice, unit.currency);
  return (
    <div className={cx("flex items-center gap-3 rounded-lg border p-2.5", HAIRLINE, "bg-[#FAFBFA] dark:bg-slate-800/40")}>
      <ProductThumb src={unit.itemImageUrl} />
      <div className="min-w-0 flex-1">
        <div className={cx("truncate text-sm font-medium", TEXT)}>{unitLine(unit)}</div>
        <div className={cx("flex flex-wrap gap-x-2 text-xs", TEXT_FAINT)}>
          <span className="font-mono">{unit.shortRef}</span>
          <span>Prix public actuel : {price ?? NO_PRICE_LABEL.toLowerCase()}</span>
        </div>
      </div>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Retirer cette paire de la demande"
          className={cx("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-[#F2F4F2] dark:hover:bg-slate-800", TEXT_MUTED, FOCUS)}
        >
          <CloseIcon size={16} />
        </button>
      ) : null}
    </div>
  );
}

/** Optional pair of the request: search in the partner's own stock. */
function PairPicker({ value, onChange }: { value: RequestUnit | null; onChange: (unit: RequestUnit | null) => void }) {
  const inputId = useId();
  const [term, setTerm] = useState("");
  const search = useDebounced(term.trim(), 300);
  const active = search.length >= 2 && !value;
  const results = useApi(() => partnerApi.units({ search, limit: 8 }), [search], active);

  if (value) {
    return (
      <div className="space-y-1.5">
        <div className={LABEL}>Paire concernée</div>
        <SelectedUnit unit={value} onRemove={() => onChange(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className={LABEL}>
        Paire concernée <span className={cx("font-normal", TEXT_FAINT)}>(facultatif)</span>
      </label>
      <div className="relative">
        <SearchIcon size={16} className={cx("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2", TEXT_FAINT)} />
        <input
          id={inputId}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Modèle, référence fabricant, GTIN ou référence de paire"
          autoComplete="off"
          className={cx(INPUT, "pl-9")}
        />
      </div>
      {active ? (
        <div className={cx("overflow-hidden rounded-lg border", HAIRLINE)} aria-live="polite">
          {results.loading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : results.error ? (
            <p className="p-3 text-sm text-[#B80000] dark:text-red-300">{results.error.message}</p>
          ) : results.data && results.data.items.length > 0 ? (
            <ul className="max-h-64 divide-y divide-[#EEF0EE] overflow-y-auto dark:divide-slate-800">
              {results.data.items.map((unit) => (
                <li key={unit.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(unit);
                      setTerm("");
                    }}
                    className={cx("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#F7F8F7] dark:hover:bg-slate-800", FOCUS, "focus-visible:-outline-offset-2")}
                  >
                    <ProductThumb src={unit.itemImageUrl} />
                    <span className="min-w-0 flex-1">
                      <span className={cx("block truncate text-sm font-medium", TEXT)}>{unitLine(unit)}</span>
                      <span className={cx("block text-xs", TEXT_FAINT)}>
                        <span className="font-mono">{unit.shortRef}</span>
                        {unit.itemStyleCode ? ` · ${unit.itemStyleCode}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={cx("p-3 text-sm", TEXT_MUTED)}>Aucune paire de votre stock ne correspond à « {search} ».</p>
          )}
        </div>
      ) : (
        <p className={HINT}>Sans paire sélectionnée, la demande porte sur votre stock en général.</p>
      )}
    </div>
  );
}

/** One pair or all pairs of a model and size. */
function GroupScope({
  group,
  units,
  loading,
  error,
  value,
  onChange,
}: {
  group: PartnerItemGroup;
  units: RequestUnit[];
  loading: boolean;
  error: string | null;
  value: string;
  onChange: (value: string) => void;
}) {
  const name = useId();
  const option = "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm has-[:checked]:border-[#02C73A] has-[:checked]:bg-[#F3FCF5] dark:has-[:checked]:bg-[#02C73A]/10";
  return (
    <fieldset className="space-y-1.5">
      <legend className={LABEL}>Paires concernées</legend>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <p className="text-sm text-[#B80000] dark:text-red-300">{error}</p>
      ) : (
        <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          {units.length !== 1 ? (
            <label className={cx(option, HAIRLINE)}>
              <input type="radio" name={name} value="ALL" checked={value === "ALL"} onChange={() => onChange("ALL")} className="accent-[#02C73A]" />
              <span className={TEXT}>
                Toutes les paires de cette pointure <span className={TEXT_FAINT}>({pairs(group.quantity)})</span>
              </span>
            </label>
          ) : null}
          {units.map((unit) => (
            <label key={unit.id} className={cx(option, HAIRLINE)}>
              <input type="radio" name={name} value={unit.id} checked={value === unit.id} onChange={() => onChange(unit.id)} className="accent-[#02C73A]" />
              <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3">
                <span className={cx("font-mono text-[13px]", TEXT)}>{unit.shortRef}</span>
                <span className={cx("text-xs", TEXT_FAINT)}>
                  Prix public actuel : {formatMoney(unit.publicPrice, unit.currency) ?? NO_PRICE_LABEL.toLowerCase()}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/**
 * "Nouvelle demande": price change, discrepancy or other. The request is only a message to the
 * team — nothing is applied automatically, and the partner is always the one of the session.
 */
export function RequestForm({ unit, group, initialUnitId, types = ALL_TYPES, defaultType, onCreated, onCancel, hideRequestsLink }: RequestFormProps) {
  const { refreshSummary } = usePartnerPortal();
  const typeName = useId();
  const messageId = useId();
  const priceId = useId();
  const priceHintId = useId();

  const [type, setType] = useState<PartnerRequestType>(defaultType && types.includes(defaultType) ? defaultType : types[0]);
  const [picked, setPicked] = useState<RequestUnit | null>(null);
  const [scope, setScope] = useState<string>("ALL");
  const [message, setMessage] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ message?: string; price?: string }>({});
  const [sent, setSent] = useState(false);

  // Pairs of the model/size (prices screen).
  const groupUnits = useApi(() => partnerApi.units({ itemId: group?.itemId ?? "", limit: 200 }), [group?.itemId], Boolean(group));
  const unitsOfGroup = useMemo(() => groupUnits.data?.items ?? [], [groupUnits.data]);
  useEffect(() => {
    if (unitsOfGroup.length === 1) setScope(unitsOfGroup[0].id);
  }, [unitsOfGroup]);

  // Preselected pair (link "Faire une demande" from elsewhere).
  useEffect(() => {
    if (!initialUnitId || unit || group) return;
    let active = true;
    partnerApi
      .unit(initialUnitId)
      .then((found) => {
        if (active) setPicked(found);
      })
      .catch(() => {
        // Unknown or foreign pair: the picker simply stays empty.
      });
    return () => {
      active = false;
    };
  }, [initialUnitId, unit, group]);

  const scopedUnit = group ? unitsOfGroup.find((u) => u.id === scope) ?? null : null;
  const targetUnit: RequestUnit | null = unit ?? scopedUnit ?? (group ? null : picked);
  const currency = targetUnit?.currency ?? group?.currency ?? DEFAULT_CURRENCY;
  const isPrice = type === "PRICE_CHANGE";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const text = message.trim();
    const nextErrors: { message?: string; price?: string } = {};
    if (text.length < 3) nextErrors.message = "Écrivez votre message (3 caractères au minimum).";
    const cleanPrice = price.trim().replace(/\s/g, "");
    if (isPrice) {
      if (!cleanPrice) nextErrors.price = "Indiquez le prix public souhaité.";
      else if (!PRICE_PATTERN.test(cleanPrice)) nextErrors.price = "Montant attendu, par exemple 189 ou 189.90.";
    }
    setFieldErrors(nextErrors);
    if (nextErrors.price || nextErrors.message) {
      // Bring the keyboard to the first field to correct.
      document.getElementById(nextErrors.price ? priceId : messageId)?.focus();
      return;
    }

    // A request about all pairs of a model and size is one message that names them.
    let body = text;
    if (group && !targetUnit) {
      const size = group.itemSizeLabel ? ` — pointure ${group.itemSizeLabel}` : "";
      const style = group.itemStyleCode ? ` (${group.itemStyleCode})` : "";
      body = `Concerne : ${productTitle(group.itemBrand, group.itemName)}${size}${style}, ${pairs(group.quantity)}.\n${text}`;
    }

    setBusy(true);
    setError(null);
    try {
      await partnerApi.createRequest({
        unitId: targetUnit?.id ?? null,
        type,
        message: body,
        requestedPublicPrice: isPrice ? cleanPrice.replace(",", ".") : null,
      });
      setSent(true);
      setMessage("");
      setPrice("");
      refreshSummary();
      onCreated?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-3">
        <Notice tone="success" title="Demande envoyée">
          Notre équipe vous répondra dans la rubrique « Demandes et retraits ». Rien n'est modifié automatiquement.
        </Notice>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setSent(false)}>Envoyer une autre demande</Button>
          {!hideRequestsLink ? (
            <Link href="/partners/requests" className={cx("text-sm", LINK)}>
              Voir mes demandes
            </Link>
          ) : null}
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              Fermer
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {types.length > 1 ? (
        <fieldset>
          <legend className={LABEL}>Type de demande</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {types.map((value) => (
              <label
                key={value}
                className={cx(
                  "cursor-pointer rounded-full border px-3 py-1.5 text-[13px] transition-colors",
                  "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#017723]",
                  type === value
                    ? "border-[#BDEFCB] bg-[#E6F9EB] font-medium text-[#017723] dark:border-[#02C73A]/40 dark:bg-[#02C73A]/10 dark:text-[#5BE584]"
                    : cx("border-[#E7E9E7] bg-white hover:border-[#BFC6C0] dark:border-slate-700 dark:bg-slate-900", TEXT_MUTED)
                )}
              >
                <input type="radio" name={typeName} value={value} checked={type === value} onChange={() => setType(value)} className="sr-only" />
                {REQUEST_TYPE_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {unit ? (
        <div className="space-y-1.5">
          <div className={LABEL}>Paire concernée</div>
          <SelectedUnit unit={unit} />
        </div>
      ) : group ? (
        <GroupScope
          group={group}
          units={unitsOfGroup}
          loading={groupUnits.loading}
          error={groupUnits.error?.message ?? null}
          value={scope}
          onChange={setScope}
        />
      ) : (
        <PairPicker value={picked} onChange={setPicked} />
      )}

      {isPrice ? (
        <div className="space-y-1.5">
          <label htmlFor={priceId} className={LABEL}>
            Prix public souhaité
          </label>
          <div className="relative max-w-[220px]">
            <input
              id={priceId}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              aria-invalid={fieldErrors.price ? true : undefined}
              aria-describedby={priceHintId}
              placeholder="0.00"
              className={cx(INPUT, "pr-14 tabular-nums", fieldErrors.price && "border-[#EB0000] focus:border-[#EB0000] focus:ring-[#EB0000]/20")}
            />
            <span className={cx("pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm", TEXT_FAINT)}>{currency}</span>
          </div>
          <p id={priceHintId} className={fieldErrors.price ? "text-xs text-[#B80000] dark:text-red-300" : HINT}>
            {fieldErrors.price ?? "Prix affiché au client. Si la modification est acceptée, le net pour vous est recalculé selon votre accord de dépôt."}
          </p>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor={messageId} className={LABEL}>
          Message
        </label>
        <textarea
          id={messageId}
          rows={4}
          value={message}
          maxLength={MESSAGE_MAX}
          onChange={(event) => setMessage(event.target.value)}
          aria-invalid={fieldErrors.message ? true : undefined}
          aria-describedby={`${messageId}-hint`}
          placeholder={PLACEHOLDERS[type]}
          className={cx(INPUT, "resize-y", fieldErrors.message && "border-[#EB0000] focus:border-[#EB0000] focus:ring-[#EB0000]/20")}
        />
        <div id={`${messageId}-hint`} className="flex justify-between gap-3">
          <p className={fieldErrors.message ? "text-xs text-[#B80000] dark:text-red-300" : HINT}>
            {fieldErrors.message ?? "Votre demande est transmise à l'équipe Resell Lausanne, qui vous répond ici."}
          </p>
          <span className={cx("shrink-0 tabular-nums", HINT)}>
            {message.length}/{MESSAGE_MAX}
          </span>
        </div>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" busy={busy}>
          {busy ? "Envoi…" : "Envoyer la demande"}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Annuler
          </Button>
        ) : null}
      </div>
    </form>
  );
}
