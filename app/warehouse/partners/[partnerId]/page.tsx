"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgreementRow, PartnerPriceRow, PartnerRequestRow, PriceBreakdown } from "@/lib/warehouse/pricing";
import type { ItemAggregate } from "@/lib/warehouse/units";
import { errorMessage, newOpKey, whGet, whPost } from "../../_lib/api";
import { useWarehouse } from "../../_lib/context";
import { PRESENCE, QC, SALE, fmtDateTime, fmtFactor, fmtMoney, itemTitle, shortRefOf } from "../../_lib/format";
import { useLoad } from "../../_lib/hooks";
import { agreementSummary, type WarehousePartnerRow } from "../../_lib/partners";
import { Btn, Card, Chip, EmptyState, ErrorNote, Field, KpiTile, Loading, Modal, Notice, Segmented, Tabs, Td, Th, inputCls, rowCls, tableCls, theadCls } from "../../_components/ui";

type TabId = "prices" | "agreement" | "requests";
type Only = "" | "UNPRICED" | "PROPOSED" | "PRICED";
type Terms = { commissionRate: number | null; fixedFee: number | null };

const BASIS_LABELS: Record<string, string> = {
  PUBLIC_PRICE: "Le résultat est le prix public",
  SELLER_NET: "Le résultat est le net versé au partenaire",
  UNCONFIRMED: "À confirmer avec le partenaire",
};
const REQUEST_TYPE: Record<string, string> = { PRICE_CHANGE: "Changement de prix", DISCREPANCY: "Écart signalé", OTHER: "Autre" };
const REQUEST_STATUS: Record<string, { label: string; tone: "amber" | "green" | "slate" }> = {
  OPEN: { label: "Ouverte", tone: "amber" },
  ANSWERED: { label: "Répondue", tone: "green" },
  CLOSED: { label: "Close", tone: "slate" },
};

const num = (v: string): number | null => {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Same rule as the server (net = public − commission − fixed fee); shown as an estimate before saving. */
function estimate(publicPrice: number | null, terms: Terms | null): PriceBreakdown {
  if (publicPrice === null) return { publicPrice: null, fees: null, sellerNet: null, margin: null };
  if (!terms || (terms.commissionRate === null && terms.fixedFee === null)) return { publicPrice, fees: null, sellerNet: null, margin: null };
  const fees = round2(publicPrice * (terms.commissionRate ?? 0) + (terms.fixedFee ?? 0));
  return { publicPrice, fees, sellerNet: round2(Math.max(0, publicPrice - fees)), margin: fees };
}

/** Prix public and Net pour vous, always side by side, with the fees between them. */
function PricePair({ publicPrice, sellerNet, fees, currency, muted }: { publicPrice: string | number | null; sellerNet: string | number | null; fees: string | number | null; currency: string | null; muted?: boolean }) {
  return (
    <div className={"grid grid-cols-2 gap-3 " + (muted ? "opacity-80" : "")}>
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Prix public</div>
        <div className="text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">{fmtMoney(publicPrice, currency)}</div>
      </div>
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Net pour vous</div>
        <div className="text-base font-semibold tabular-nums text-[#0A7A2C] dark:text-emerald-400">{fmtMoney(sellerNet, currency)}</div>
      </div>
      <div className="col-span-2 -mt-2 text-xs tabular-nums text-slate-500 dark:text-slate-400">
        {fees === null || fees === undefined || fees === "" ? "Frais non calculés (accord sans commission ni frais fixes)" : `Frais retenus : ${fmtMoney(fees, currency)}`}
      </div>
    </div>
  );
}

// ───────────── agreement ─────────────

function AgreementTab({ partnerId, agreements, canEdit, onSaved }: { partnerId: string; agreements: AgreementRow[]; canEdit: boolean; onSaved: () => void }) {
  const active = agreements.find((a) => a.status === "ACTIVE") ?? null;
  const [f, setF] = useState({ saleAllowed: false, pricingMode: "MANUAL", pricingFactor: "0.7", pricingBasisIs: "UNCONFIRMED", commissionPct: "", fixedFee: "", currency: "CHF", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!active) return;
    setF({
      saleAllowed: active.saleAllowed,
      pricingMode: active.pricingMode,
      pricingFactor: active.pricingFactor === null ? "0.7" : fmtFactor(active.pricingFactor),
      pricingBasisIs: active.pricingBasisIs,
      commissionPct: active.commissionRate === null ? "" : String(round2(Number(active.commissionRate) * 100)),
      fixedFee: active.fixedFee === null ? "" : String(Number(active.fixedFee)),
      currency: active.currency,
      notes: active.notes ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const save = async () => {
    if (!window.confirm("Enregistrer une nouvelle version de l'accord ? La version actuelle sera close et conservée dans l'historique.")) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const pct = num(f.commissionPct);
      await whPost(`partners/${partnerId}/agreements`, {
        saleAllowed: f.saleAllowed,
        pricingMode: f.pricingMode,
        pricingFactor: f.pricingMode === "STOCKX_BUYNOW_FACTOR" ? num(f.pricingFactor) : null,
        pricingBasisIs: f.pricingBasisIs,
        commissionRate: pct === null ? null : round2(pct) / 100,
        fixedFee: num(f.fixedFee),
        currency: f.currency.trim().toUpperCase() || "CHF",
        notes: f.notes.trim() || null,
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const example = estimate(100, { commissionRate: num(f.commissionPct) === null ? null : (num(f.commissionPct) as number) / 100, fixedFee: num(f.fixedFee) });

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        {f.pricingBasisIs === "UNCONFIRMED" ? (
          <Notice tone="amber">
            <strong>Base de prix à confirmer.</strong> Tant que le partenaire n'a pas dit si « StockX × coefficient » désigne le prix public ou son net, chaque proposition est lue comme un prix public et marquée « base à confirmer ».
          </Notice>
        ) : null}
        {!active ? <Notice tone="amber">Aucun accord de dépôt actif : la vente ne peut pas être autorisée et les frais ne sont pas calculés.</Notice> : null}

        <fieldset disabled={!canEdit || busy} className="space-y-4">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Vente des paires en dépôt</div>
            <Segmented<"yes" | "no">
              value={f.saleAllowed ? "yes" : "no"}
              onChange={(v) => setF({ ...f, saleAllowed: v === "yes" })}
              options={[
                { value: "no", label: "Stockage seul" },
                { value: "yes", label: "Vente autorisée" },
              ]}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mode de prix">
              <select value={f.pricingMode} onChange={(e) => setF({ ...f, pricingMode: e.target.value })} className={inputCls}>
                <option value="MANUAL">Prix saisis à la main</option>
                <option value="STOCKX_BUYNOW_FACTOR">StockX (achat immédiat) × coefficient</option>
              </select>
            </Field>
            {f.pricingMode === "STOCKX_BUYNOW_FACTOR" ? (
              <Field label="Coefficient" hint="0.7 : un relevé de CHF 200 donne CHF 140.">
                <input inputMode="decimal" value={f.pricingFactor} onChange={(e) => setF({ ...f, pricingFactor: e.target.value })} className={inputCls + " tabular-nums"} />
              </Field>
            ) : (
              <div />
            )}
            <Field label="Ce que désigne le prix calculé" className="sm:col-span-2">
              <select value={f.pricingBasisIs} onChange={(e) => setF({ ...f, pricingBasisIs: e.target.value })} className={inputCls}>
                {Object.entries(BASIS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Commission (% du prix public)" hint="Vide = pas de commission définie.">
              <input inputMode="decimal" value={f.commissionPct} onChange={(e) => setF({ ...f, commissionPct: e.target.value })} className={inputCls + " tabular-nums"} placeholder="ex. 10" />
            </Field>
            <Field label="Frais fixes par paire">
              <input inputMode="decimal" value={f.fixedFee} onChange={(e) => setF({ ...f, fixedFee: e.target.value })} className={inputCls + " tabular-nums"} placeholder="ex. 5.00" />
            </Field>
            <Field label="Devise">
              <input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} maxLength={3} className={inputCls + " font-mono"} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} className={inputCls + " py-2"} />
            </Field>
          </div>
        </fieldset>

        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Exemple pour un prix public de {f.currency || "CHF"} 100.00</div>
          <PricePair publicPrice={example.publicPrice} sellerNet={example.sellerNet} fees={example.fees} currency={f.currency || "CHF"} />
        </div>

        {error ? <Notice tone="red">{error}</Notice> : null}
        {saved ? <Notice tone="green">Nouvelle version de l'accord enregistrée.</Notice> : null}
        {canEdit ? (
          <Btn variant="primary" busy={busy} onClick={() => void save()}>
            Enregistrer une nouvelle version
          </Btn>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">Lecture seule : la modification de l'accord est réservée à l'administration.</p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Historique des versions</h3>
        {agreements.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Aucune version.</p>
        ) : (
          <ol className="space-y-2">
            {agreements.map((a) => (
              <li key={a.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">Version {a.version}</span>
                  <Chip tone={a.status === "ACTIVE" ? "green" : "slate"}>{a.status === "ACTIVE" ? "En vigueur" : a.status === "ENDED" ? "Close" : "Brouillon"}</Chip>
                  {a.pricingBasisIs === "UNCONFIRMED" ? <Chip tone="amber">Base à confirmer</Chip> : null}
                </div>
                <div className="mt-1 text-slate-700 dark:text-slate-200">{agreementSummary({ agreementId: a.id, ...a })}</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  du {fmtDateTime(a.validFrom ?? a.createdAt)}
                  {a.validTo ? ` au ${fmtDateTime(a.validTo)}` : ""}
                </div>
                {a.notes ? <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{a.notes}</div> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ───────────── prices ─────────────

function SetPriceModal({ row, terms, currency, onClose, onDone }: { row: PartnerPriceRow | null; terms: Terms | null; currency: string; onClose: () => void; onDone: () => void }) {
  const [publicPrice, setPublicPrice] = useState("");
  const [explicitNet, setExplicitNet] = useState("");
  const [note, setNote] = useState("");
  const [opKey, setOpKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!row) return;
    setPublicPrice(row.publicPrice ? String(Number(row.publicPrice)) : row.proposalPublicPrice ? String(Number(row.proposalPublicPrice)) : "");
    setExplicitNet("");
    setNote("");
    setError(null);
    setOpKey(newOpKey("prc"));
  }, [row]);

  if (!row) return null;
  const pub = num(publicPrice);
  const net = num(explicitNet);
  const preview = net !== null && pub !== null ? { publicPrice: pub, sellerNet: net, fees: round2(pub - net), margin: round2(pub - net) } : estimate(pub, terms);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await whPost("prices/unit", { opKey, unitId: row.unitId, publicPrice: String(pub), sellerNet: net === null ? null : String(net), currency, note: note.trim() || null });
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
      title="Fixer le prix de cette paire"
      footer={
        <>
          <Btn onClick={onClose}>Annuler</Btn>
          <Btn variant="primary" busy={busy} disabled={pub === null || pub <= 0} onClick={() => void submit()}>
            Valider ce prix
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
          <span className="font-medium text-slate-900 dark:text-slate-100">{itemTitle(row.itemBrand, row.itemName)}</span> · pointure {row.itemSizeLabel ?? "—"} ·{" "}
          <span className="font-mono text-[#0A7A2C] dark:text-emerald-400">{shortRefOf(row.unitId)}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Prix public (${currency})`}>
            <input autoFocus inputMode="decimal" value={publicPrice} onChange={(e) => setPublicPrice(e.target.value)} className={inputCls + " text-lg tabular-nums"} />
          </Field>
          <Field label={`Net pour vous imposé (${currency}, facultatif)`} hint="Vide = calculé d'après l'accord.">
            <input inputMode="decimal" value={explicitNet} onChange={(e) => setExplicitNet(e.target.value)} className={inputCls + " text-lg tabular-nums"} />
          </Field>
        </div>
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Ce que le partenaire verra (estimation avant enregistrement)</div>
          <PricePair publicPrice={preview.publicPrice} sellerNet={preview.sellerNet} fees={preview.fees} currency={currency} />
        </div>
        <Field label="Note (facultatif)">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
        </Field>
        <p className="text-xs text-slate-500 dark:text-slate-400">Le prix est validé immédiatement et remplace le prix précédent de cette paire. Les autres paires ne sont pas touchées.</p>
        {error ? <Notice tone="red">{error}</Notice> : null}
      </div>
    </Modal>
  );
}

type StockxResult = { proposed: number; unitIds: string[]; breakdown: PriceBreakdown & { interpretedAs: string }; reliable: boolean; warnings: string[] };

function StockxModal({ open, partnerId, agreement, onClose, onDone }: { open: boolean; partnerId: string; agreement: AgreementRow | null; onClose: () => void; onDone: () => void }) {
  const currency = agreement?.currency ?? "CHF";
  const [variants, setVariants] = useState<ItemAggregate[]>([]);
  const [itemId, setItemId] = useState("");
  const [amount, setAmount] = useState("");
  const [basisCurrency, setBasisCurrency] = useState(currency);
  const [basisRef, setBasisRef] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [includesFees, setIncludesFees] = useState<"yes" | "no" | "unknown">("unknown");
  const [factor, setFactor] = useState("");
  const [opKey, setOpKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StockxResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    setOpKey(newOpKey("stx"));
    setBasisCurrency(currency);
    setFactor(agreement?.pricingFactor ? fmtFactor(agreement.pricingFactor) : "0.7");
    const now = new Date();
    setObservedAt(new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    whGet<{ items: ItemAggregate[] }>("units", { ownerPartnerId: partnerId, ownerKind: "PARTNER", group: "item", limit: 200 })
      .then((r) => setVariants(r.items))
      .catch((err) => setError(errorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, partnerId]);

  const basis = agreement?.pricingBasisIs ?? "UNCONFIRMED";
  const terms: Terms | null = agreement ? { commissionRate: agreement.commissionRate === null ? null : Number(agreement.commissionRate), fixedFee: agreement.fixedFee === null ? null : Number(agreement.fixedFee) } : null;
  const amt = num(amount);
  const fac = num(factor);
  const derived = amt !== null && fac !== null ? round2(amt * fac) : null;
  const preview = basis === "SELLER_NET" ? { publicPrice: null, fees: null, sellerNet: derived, margin: null } : estimate(derived, terms);
  const warnings: string[] = [];
  if (!agreement) warnings.push("Aucun accord de dépôt actif : frais et net non calculés.");
  if (basis === "UNCONFIRMED") warnings.push("Base à confirmer : le résultat est lu comme prix public, pas comme net du partenaire.");
  if (basis === "SELLER_NET") warnings.push("Accord en « net partenaire » : la proposition n'a pas de prix public et ne pourra pas être validée telle quelle.");
  if (!basisRef.trim()) warnings.push("Référence de l'annonce manquante.");
  if (basisCurrency.trim().toUpperCase() !== currency) warnings.push(`Relevé en ${basisCurrency.trim().toUpperCase() || "?"}, accord en ${currency} : aucune conversion automatique.`);
  if (includesFees === "unknown") warnings.push("Frais inclus ou non dans le relevé : à préciser, sinon la proposition ne pourra pas être validée.");
  const variant = variants.find((v) => v.itemId === itemId) ?? null;
  const valid = Boolean(itemId) && amt !== null && amt > 0 && Boolean(observedAt) && /^[A-Za-z]{3}$/.test(basisCurrency.trim()) && Boolean(basisRef.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await whPost<StockxResult>("prices/stockx-proposal", {
        opKey,
        partnerId,
        itemId,
        basisAmount: String(amt),
        basisCurrency: basisCurrency.trim().toUpperCase(),
        basisRef: basisRef.trim(),
        basisIncludesFees: includesFees === "unknown" ? null : includesFees === "yes",
        basisObservedAt: new Date(observedAt).toISOString(),
        factor: fac,
      });
      setResult(r);
      onDone();
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
      title="Proposer un prix depuis StockX"
      footer={
        result ? (
          <Btn variant="primary" onClick={onClose}>
            Fermer
          </Btn>
        ) : (
          <>
            <Btn onClick={onClose}>Annuler</Btn>
            <Btn variant="primary" busy={busy} disabled={!valid} onClick={() => void submit()}>
              Créer la proposition
            </Btn>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <Notice tone={result.reliable ? "green" : "amber"}>
            <div className="font-semibold">{result.proposed} paire(s) de cette variante ont reçu une proposition à valider.</div>
            <div>Aucun prix n'est appliqué tant qu'il n'est pas validé, paire par paire.</div>
          </Notice>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <PricePair publicPrice={result.breakdown.publicPrice} sellerNet={result.breakdown.sellerNet} fees={result.breakdown.fees} currency={currency} />
          </div>
          {result.warnings.length > 0 ? (
            <Notice tone="amber">
              <ul className="list-inside list-disc">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">Un relevé vaut pour UNE variante (un modèle et une pointure). Il n'est jamais étendu à une autre pointure.</p>
          <Field label="Variante concernée">
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputCls}>
              <option value="">Choisir…</option>
              {variants.map((v) => (
                <option key={v.itemId} value={v.itemId}>
                  {itemTitle(v.itemBrand, v.itemName)} · {v.itemSizeLabel ?? "—"} ({v.total} paire{v.total > 1 ? "s" : ""})
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Montant relevé (achat immédiat)">
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls + " text-lg tabular-nums"} />
            </Field>
            <Field label="Devise du relevé">
              <input value={basisCurrency} onChange={(e) => setBasisCurrency(e.target.value.toUpperCase())} maxLength={3} className={inputCls + " font-mono"} />
            </Field>
            <Field label="Coefficient">
              <input inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} className={inputCls + " tabular-nums"} />
            </Field>
            <Field label="Référence de l'annonce" hint="Adresse de la page, identifiant ou capture." className="sm:col-span-2">
              <input value={basisRef} onChange={(e) => setBasisRef(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Date du relevé">
              <input type="datetime-local" value={observedAt} onChange={(e) => setObservedAt(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Le montant relevé inclut-il les frais StockX ?</div>
            <Segmented<"yes" | "no" | "unknown">
              value={includesFees}
              onChange={setIncludesFees}
              options={[
                { value: "yes", label: "Oui" },
                { value: "no", label: "Non" },
                { value: "unknown", label: "Je ne sais pas" },
              ]}
            />
          </div>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              Calcul : {amt !== null ? amt.toFixed(2) : "…"} × {fac ?? "…"} = {derived !== null ? derived.toFixed(2) : "…"} {currency}
              {variant ? ` · ${variant.total} paire(s) concernée(s)` : ""}
            </div>
            <PricePair publicPrice={preview.publicPrice} sellerNet={preview.sellerNet} fees={preview.fees} currency={currency} />
          </div>
          {warnings.length > 0 ? (
            <Notice tone="amber">
              <ul className="list-inside list-disc">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {error ? <Notice tone="red">{error}</Notice> : null}
        </div>
      )}
    </Modal>
  );
}

function PricesTab({ partnerId, agreement, canEdit, onChanged }: { partnerId: string; agreement: AgreementRow | null; canEdit: boolean; onChanged: () => void }) {
  const [only, setOnly] = useState<Only>("");
  const [rows, setRows] = useState<PartnerPriceRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [setting, setSetting] = useState<PartnerPriceRow | null>(null);
  const [stockx, setStockx] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const seq = useRef(0);
  const currency = agreement?.currency ?? "CHF";
  const terms: Terms | null = agreement ? { commissionRate: agreement.commissionRate === null ? null : Number(agreement.commissionRate), fixedFee: agreement.fixedFee === null ? null : Number(agreement.fixedFee) } : null;

  const load = useCallback(
    async (append: boolean, from: string | null) => {
      const mine = ++seq.current;
      setLoading(true);
      try {
        const res = await whGet<{ items: PartnerPriceRow[]; nextCursor: string | null }>("prices", { partnerId, only: only || undefined, limit: 100, cursor: append ? from : undefined });
        if (mine !== seq.current) return;
        setRows((prev) => (append ? [...prev, ...res.items] : res.items));
        setCursor(res.nextCursor);
        setError(null);
      } catch (err) {
        if (mine === seq.current) setError(err);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [partnerId, only]
  );

  useEffect(() => {
    void load(false, null);
  }, [load]);

  const refresh = () => {
    void load(false, null);
    onChanged();
  };

  const decide = async (row: PartnerPriceRow, decision: "VALIDATE" | "REJECT") => {
    if (!row.proposalId) return;
    setBusyId(row.unitId);
    setFlash(null);
    try {
      await whPost(`prices/${row.proposalId}/decide`, { decision });
      setFlash({ tone: "green", text: decision === "VALIDATE" ? "Prix validé." : "Proposition refusée." });
      refresh();
    } catch (err) {
      setFlash({ tone: "red", text: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <Segmented<Only>
          value={only}
          onChange={setOnly}
          options={[
            { value: "", label: "Toutes" },
            { value: "UNPRICED", label: "Sans prix" },
            { value: "PROPOSED", label: "À valider" },
            { value: "PRICED", label: "Avec prix" },
          ]}
        />
        {canEdit ? <Btn onClick={() => setStockx(true)}>Proposer depuis StockX</Btn> : null}
      </div>
      {flash ? (
        <Notice tone={flash.tone} className="m-3">
          {flash.text}
        </Notice>
      ) : null}
      <ErrorNote error={error} className="m-3" onRetry={() => void load(false, null)} />
      {rows.length === 0 ? (
        loading ? (
          <Loading />
        ) : (
          <EmptyState title="Aucune paire dans cette liste" />
        )
      ) : (
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <Th>Modèle</Th>
                <Th>Pointure</Th>
                <Th>Réf. courte</Th>
                <Th>État</Th>
                <Th className="min-w-[260px]">Prix en vigueur</Th>
                <Th className="min-w-[260px]">Proposition à valider</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.unitId} className={rowCls + " align-top"}>
                  <Td>
                    <Link href={`/warehouse/stock/${r.unitId}`} className="font-medium text-slate-900 hover:underline dark:text-slate-100">
                      {itemTitle(r.itemBrand, r.itemName)}
                    </Link>
                    <div className="font-mono text-xs text-slate-500">{r.itemStyleCode ?? ""}</div>
                  </Td>
                  <Td className="text-base font-semibold tabular-nums">{r.itemSizeLabel ?? "—"}</Td>
                  <Td className="font-mono text-sm text-[#0A7A2C] dark:text-emerald-400">{shortRefOf(r.unitId)}</Td>
                  <Td>
                    <span className="inline-flex flex-wrap gap-1">
                      <Chip tone={PRESENCE[r.presence]?.tone}>{PRESENCE[r.presence]?.label ?? r.presence}</Chip>
                      <Chip tone={QC[r.qcState]?.tone}>{QC[r.qcState]?.label ?? r.qcState}</Chip>
                      <Chip tone={SALE[r.saleState]?.tone}>{SALE[r.saleState]?.label ?? r.saleState}</Chip>
                    </span>
                  </Td>
                  <Td>
                    {r.publicPrice === null && r.sellerNet === null ? (
                      <Chip tone="amber">Sans prix</Chip>
                    ) : (
                      <>
                        <PricePair publicPrice={r.publicPrice} sellerNet={r.sellerNet} fees={r.fees} currency={r.currency ?? currency} />
                        <div className="mt-1 text-xs text-slate-500">{r.priceSource === "STOCKX_BUYNOW_FACTOR" ? "D'après StockX" : "Saisi"}</div>
                      </>
                    )}
                  </Td>
                  <Td>
                    {r.proposalId ? (
                      <>
                        <PricePair muted publicPrice={r.proposalPublicPrice} sellerNet={r.proposalSellerNet} fees={r.proposalPublicPrice !== null && r.proposalSellerNet !== null ? round2(Number(r.proposalPublicPrice) - Number(r.proposalSellerNet)) : null} currency={r.currency ?? currency} />
                        <div className="mt-1 text-xs text-slate-500">
                          {r.proposalBasisAmount ? `Relevé StockX : ${fmtMoney(r.proposalBasisAmount, "")}` : ""}
                          {r.proposalNote ? <div className="text-amber-700 dark:text-amber-400">{r.proposalNote}</div> : null}
                        </div>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </Td>
                  <Td>
                    {canEdit ? (
                      <div className="flex flex-col items-stretch gap-2">
                        {r.proposalId ? (
                          <>
                            <Btn size="sm" variant="primary" busy={busyId === r.unitId} onClick={() => void decide(r, "VALIDATE")}>
                              Valider
                            </Btn>
                            <Btn size="sm" disabled={busyId === r.unitId} onClick={() => void decide(r, "REJECT")}>
                              Refuser
                            </Btn>
                          </>
                        ) : null}
                        <Btn size="sm" disabled={r.presence === "OUT"} onClick={() => setSetting(r)}>
                          {r.publicPrice ? "Modifier le prix" : "Fixer le prix"}
                        </Btn>
                      </div>
                    ) : null}
                  </Td>
                </tr>
              ))}
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

      <SetPriceModal row={setting} terms={terms} currency={currency} onClose={() => setSetting(null)} onDone={refresh} />
      <StockxModal open={stockx} partnerId={partnerId} agreement={agreement} onClose={() => setStockx(false)} onDone={refresh} />
    </div>
  );
}

// ───────────── requests ─────────────

function RequestsTab({ partnerId, canEdit, onChanged }: { partnerId: string; canEdit: boolean; onChanged: () => void }) {
  const requests = useLoad<PartnerRequestRow[]>(() => whGet<PartnerRequestRow[]>("requests", { partnerId, limit: 200 }), [partnerId]);
  const [answering, setAnswering] = useState<PartnerRequestRow | null>(null);
  const [response, setResponse] = useState("");
  const [close, setClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!answering) return;
    setBusy(true);
    setError(null);
    try {
      await whPost(`requests/${answering.id}/answer`, { response: response.trim(), status: close ? "CLOSED" : "ANSWERED" });
      setAnswering(null);
      await requests.reload();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!requests.data) return requests.loading ? <Loading /> : <ErrorNote error={requests.error} className="m-3" onRetry={() => void requests.reload()} />;
  if (requests.data.length === 0) return <EmptyState title="Aucune demande de ce partenaire" />;

  return (
    <>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {requests.data.map((r) => {
          const st = REQUEST_STATUS[r.status] ?? { label: r.status, tone: "slate" as const };
          return (
            <li key={r.id} className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={st.tone}>{st.label}</Chip>
                    <Chip>{REQUEST_TYPE[r.type] ?? r.type}</Chip>
                    <span className="text-xs text-slate-500">{fmtDateTime(r.createdAt)}</span>
                  </div>
                  {r.unitId ? (
                    <Link href={`/warehouse/stock/${r.unitId}`} className="mt-1 block text-sm font-medium text-slate-900 hover:underline dark:text-slate-100">
                      {r.itemName ?? "Paire"} · {r.itemSizeLabel ?? "—"} · <span className="font-mono text-[#0A7A2C] dark:text-emerald-400">{r.unitShortRef}</span>
                    </Link>
                  ) : null}
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">{r.message}</p>
                  {r.requestedPublicPrice ? <p className="mt-1 text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">Prix public demandé : {fmtMoney(r.requestedPublicPrice, r.currency)}</p> : null}
                  {r.response ? (
                    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="text-xs text-slate-500">Réponse du {fmtDateTime(r.answeredAt)}</div>
                      <div className="whitespace-pre-wrap text-slate-800 dark:text-slate-100">{r.response}</div>
                    </div>
                  ) : null}
                </div>
                {canEdit && r.status !== "CLOSED" ? (
                  <Btn
                    variant={r.status === "OPEN" ? "primary" : "secondary"}
                    onClick={() => {
                      setAnswering(r);
                      setResponse(r.response ?? "");
                      setClose(false);
                      setError(null);
                    }}
                  >
                    {r.status === "OPEN" ? "Répondre" : "Compléter la réponse"}
                  </Btn>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <Modal
        open={Boolean(answering)}
        onClose={() => setAnswering(null)}
        title="Répondre au partenaire"
        footer={
          <>
            <Btn onClick={() => setAnswering(null)}>Annuler</Btn>
            <Btn variant="primary" busy={busy} disabled={!response.trim()} onClick={() => void submit()}>
              Envoyer la réponse
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          <p className="whitespace-pre-wrap rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">{answering?.message}</p>
          <Field label="Réponse (visible par le partenaire)">
            <textarea autoFocus value={response} onChange={(e) => setResponse(e.target.value)} rows={4} className={inputCls + " py-2"} />
          </Field>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" className="h-5 w-5" checked={close} onChange={(e) => setClose(e.target.checked)} />
            Clore la demande
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400">Répondre ne change aucun prix : un changement de prix se fait dans l'onglet Prix.</p>
          {error ? <Notice tone="red">{error}</Notice> : null}
        </div>
      </Modal>
    </>
  );
}

// ───────────── page ─────────────

export default function PartnerPage() {
  const { partnerId } = useParams<{ partnerId: string }>();
  const { isAdmin, readOnly } = useWarehouse();
  const [tab, setTab] = useState<TabId>("prices");
  const partners = useLoad<WarehousePartnerRow[]>(() => whGet<WarehousePartnerRow[]>("partners"), []);
  const agreements = useLoad<AgreementRow[]>(() => whGet<AgreementRow[]>(`partners/${partnerId}/agreements`), [partnerId]);
  const partner = useMemo(() => partners.data?.find((p) => p.id === partnerId) ?? null, [partners.data, partnerId]);
  const active = useMemo(() => agreements.data?.find((a) => a.status === "ACTIVE") ?? null, [agreements.data]);
  const canEdit = isAdmin && !readOnly;

  const refresh = () => {
    void partners.reload();
    void agreements.reload();
  };

  if (!partners.data || !agreements.data) {
    return partners.loading || agreements.loading ? <Loading /> : <ErrorNote error={partners.error ?? agreements.error} onRetry={refresh} />;
  }
  if (!partner) {
    return (
      <div className="space-y-3">
        <Link href="/warehouse/partners" className="text-sm text-slate-500 hover:underline">
          ← Partenaires et tarifs
        </Link>
        <Notice tone="red">Partenaire introuvable.</Notice>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/warehouse/partners" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
          ← Partenaires et tarifs
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{partner.name}</h1>
          <span className="font-mono text-sm text-slate-500">{partner.key}</span>
          {!partner.active ? <Chip>Inactif</Chip> : null}
          {active?.pricingBasisIs === "UNCONFIRMED" ? <Chip tone="amber">Base de prix à confirmer</Chip> : null}
          {!isAdmin ? <Chip>Lecture seule</Chip> : null}
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {agreementSummary(partner)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiTile label="Paires détenues" value={partner.unitsHeld} href={`/warehouse/stock?ownerKind=PARTNER&ownerPartnerId=${partner.id}&tab=all`} />
        <KpiTile label="Vente autorisée" value={partner.unitsSaleAuthorized} tone="green" />
        <KpiTile label="Avec prix" value={partner.unitsPriced} sub={`sur ${partner.unitsHeld}`} />
        <KpiTile label="Prix à valider" value={partner.pricesToValidate} tone={partner.pricesToValidate > 0 ? "amber" : undefined} />
        <KpiTile label="Demandes ouvertes" value={partner.openRequests} tone={partner.openRequests > 0 ? "amber" : undefined} />
      </div>

      <Card flush>
        <div className="px-2">
          <Tabs<TabId>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "prices", label: "Prix", count: partner.pricesToValidate, tone: "amber" },
              { id: "agreement", label: "Accord de dépôt", count: agreements.data.length },
              { id: "requests", label: "Demandes", count: partner.openRequests, tone: "amber" },
            ]}
          />
        </div>
        {tab === "prices" ? <PricesTab partnerId={partner.id} agreement={active} canEdit={canEdit} onChanged={refresh} /> : null}
        {tab === "agreement" ? <AgreementTab partnerId={partner.id} agreements={agreements.data} canEdit={canEdit} onSaved={refresh} /> : null}
        {tab === "requests" ? <RequestsTab partnerId={partner.id} canEdit={canEdit} onChanged={refresh} /> : null}
      </Card>
    </div>
  );
}
