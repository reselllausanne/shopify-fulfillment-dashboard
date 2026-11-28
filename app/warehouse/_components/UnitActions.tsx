"use client";

import { useEffect, useState } from "react";
import type { PrintOutcome } from "@/lib/warehouse/printing";
import type { ItemSummary, LocationSummary } from "@/lib/warehouse/types";
import type { ScanResolution, UnitDetail } from "@/lib/warehouse/units";
import { errorMessage, isWhError, lookupOperation, newOpKey, whGet, whPost } from "../_lib/api";
import { useWarehouse } from "../_lib/context";
import { BOX_LABELS, CONDITION_LABELS, LOCATION_KIND_LABELS, OUT_REASON_LABELS, itemTitle } from "../_lib/format";
import { IdentifyPanel, materializeItem, type Ident } from "./box";
import { cleanScan } from "./scan";
import { PrintOutcomeNote } from "./units";
import { Btn, Field, Modal, Notice, inputCls } from "./ui";

export type UnitActionId =
  | "qc-pass"
  | "qc-quarantine"
  | "qc-pending"
  | "sale-authorize"
  | "sale-block"
  | "sale-storage"
  | "condition"
  | "owner"
  | "item"
  | "missing"
  | "out"
  | "relocate"
  | "reprint"
  | "external-ref"
  | "duplicate-label"
  | "confirm-item";

type Meta = { title: string; confirm: string; reason: "required" | "optional" | "none"; danger?: boolean; intro?: string };

const META: Record<UnitActionId, Meta> = {
  "qc-pass": { title: "Valider le contrôle", confirm: "Valider le contrôle", reason: "optional", intro: "La paire a été contrôlée et elle est conforme." },
  "qc-quarantine": { title: "Mettre en quarantaine", confirm: "Mettre en quarantaine", reason: "required", danger: true, intro: "La paire est exclue de la vente tant que la quarantaine n'est pas levée." },
  "qc-pending": { title: "Remettre à contrôler", confirm: "Remettre à contrôler", reason: "optional" },
  "sale-authorize": { title: "Autoriser la vente", confirm: "Autoriser la vente", reason: "optional", intro: "Possible seulement si la paire est présente, contrôlée, et que l'accord du déposant autorise la vente." },
  "sale-block": { title: "Bloquer la vente", confirm: "Bloquer la vente", reason: "required", danger: true },
  "sale-storage": { title: "Repasser en stockage seul", confirm: "Stockage seul", reason: "optional" },
  condition: { title: "État de la paire et de la boîte", confirm: "Enregistrer l'état", reason: "optional" },
  owner: { title: "Changer de propriétaire", confirm: "Changer le propriétaire", reason: "required", danger: true, intro: "Les prix en cours sont annulés et la vente repasse en stockage seul." },
  item: { title: "Corriger la variante", confirm: "Corriger la variante", reason: "required", intro: "La paire garde son identifiant et son étiquette. Les prix en cours sont annulés." },
  missing: { title: "Déclarer introuvable", confirm: "Déclarer introuvable", reason: "required", danger: true, intro: "La paire quitte son emplacement et un écart est ouvert. Elle se retrouve avec « Paire retrouvée »." },
  out: { title: "Sortie de stock", confirm: "Sortir du stock", reason: "required", danger: true, intro: "La paire reste dans l'historique ; elle ne compte plus dans le stock." },
  relocate: { title: "Déplacer la paire", confirm: "Déplacer", reason: "optional" },
  reprint: { title: "Réimprimer l'étiquette", confirm: "Réimprimer", reason: "required", intro: "C'est le MÊME code qui est réimprimé : aucune nouvelle paire n'est créée. L'étiquette devra être rescannée pour être vérifiée." },
  "duplicate-label": {
    title: "Étiquette vue sur deux boîtes",
    confirm: "Signaler le doublon",
    reason: "required",
    danger: true,
    intro: "Le même QR est collé sur deux boîtes : la vente de cette paire est bloquée et un écart est ouvert. Mettez les deux boîtes de côté ; l'une d'elles devra recevoir une nouvelle identité.",
  },
  "confirm-item": {
    title: "Confirmer l'article",
    confirm: "Confirmer l'article",
    reason: "required",
    intro: "L'article provisoire devient un article confirmé pour toutes ses paires. Elles gardent leur identifiant et leur étiquette ; la vente reste à autoriser séparément. Indiquez comment l'article a été identifié.",
  },
  "external-ref": { title: "Ajouter une référence externe", confirm: "Ajouter", reason: "none", intro: "Ancienne étiquette, référence du partenaire : sert uniquement à retrouver la paire." },
};

/**
 * One dialog for every gesture on a pair. The action key is created when the dialog opens and
 * is reused for every retry; when the answer is lost the form is frozen until "Vérifier".
 */
export default function UnitActionModal({ action, detail, onClose, onDone }: { action: UnitActionId | null; detail: UnitDetail; onClose: () => void; onDone: () => void }) {
  const { isAdmin } = useWarehouse();
  const unit = detail.unit;
  const [opKey, setOpKey] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [print, setPrint] = useState<PrintOutcome | null>(null);

  const [condition, setCondition] = useState(unit.condition);
  const [boxCondition, setBoxCondition] = useState(unit.boxCondition);
  const [conditionNote, setConditionNote] = useState(unit.conditionNote ?? "");
  const [ownerKind, setOwnerKind] = useState<string>(unit.ownerKind);
  const [ownerPartnerId, setOwnerPartnerId] = useState(unit.ownerPartnerId ?? "");
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([]);
  const [outReason, setOutReason] = useState("WITHDRAWN");
  const [ident, setIdent] = useState<Ident>({ step: "unknown", gtin: null, checksumValid: true });
  const [newItem, setNewItem] = useState<ItemSummary | null>(null);
  const [destCode, setDestCode] = useState("");
  const [dest, setDest] = useState<LocationSummary | null>(null);
  const [zones, setZones] = useState<LocationSummary[]>([]);
  const [force, setForce] = useState(false);
  const [profileAsk, setProfileAsk] = useState<string | null>(null);
  const [acceptProfile, setAcceptProfile] = useState(false);
  const [boxProfile, setBoxProfile] = useState(unit.boxProfile);
  const [itemGtin, setItemGtin] = useState("");
  const [itemName, setItemName] = useState(unit.itemName ?? "");
  const [itemSize, setItemSize] = useState(unit.itemSizeLabel ?? "");
  const [namespace, setNamespace] = useState("LEGACY_LABEL");
  const [refValue, setRefValue] = useState("");

  useEffect(() => {
    if (!action) return;
    setOpKey(newOpKey(`unit-${action}`));
    setReason("");
    setNote("");
    setError(null);
    setUncertain(false);
    setPrint(null);
    setBusy(false);
    setCondition(unit.condition);
    setBoxCondition(unit.boxCondition);
    setConditionNote(unit.conditionNote ?? "");
    setOwnerKind(unit.ownerKind);
    setOwnerPartnerId(unit.ownerPartnerId ?? "");
    setIdent({ step: "unknown", gtin: null, checksumValid: true });
    setNewItem(null);
    setDest(null);
    setDestCode("");
    setForce(false);
    setProfileAsk(null);
    setAcceptProfile(false);
    setBoxProfile(unit.boxProfile);
    setItemGtin("");
    setItemName(unit.itemName ?? "");
    setItemSize(unit.itemSizeLabel ?? "");
    setRefValue("");
    if (action === "owner") whGet<{ id: string; name: string }[]>("partners").then(setPartners).catch(() => undefined);
    if (action === "relocate") {
      const siteId = unit.currentSiteId;
      if (siteId)
        whGet<{ items: LocationSummary[] }>("locations", { siteId, kinds: "RECEIVING,CART,QUARANTINE,RETURNS,PACKING", status: "ACTIVE", limit: 100 })
          .then((r) => setZones(r.items))
          .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  if (!action) return null;
  const meta = META[action];
  const found = action === "relocate" && unit.presence === "MISSING";
  const reasonRequired = meta.reason === "required" || (action === "relocate" && (unit.currentLocationKind === "LEVEL" || force || found));

  const resolveDest = async () => {
    const code = cleanScan(destCode);
    if (!code) return;
    setError(null);
    try {
      const res = await whGet<ScanResolution>("scan", { code });
      if (res.kind === "LOCATION") {
        if (!res.location.holdsUnits) setError(`${res.location.code} est un repère de structure, pas un emplacement de paires.`);
        else setDest(res.location);
      } else setError("hint" in res ? res.hint : "Ce code n'est pas un emplacement.");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const build = (): { path: string; url?: string; body: Record<string, unknown> } | string => {
    const base = { opKey, expectedVersion: unit.version, reason: reason.trim() || null, note: note.trim() || null };
    switch (action) {
      case "qc-pass":
        return { path: "qc", body: { ...base, qcState: "PASSED" } };
      case "qc-quarantine":
        return { path: "qc", body: { ...base, qcState: "QUARANTINE" } };
      case "qc-pending":
        return { path: "qc", body: { ...base, qcState: "PENDING" } };
      case "sale-authorize":
        return { path: "sale", body: { ...base, saleState: "SALE_AUTHORIZED" } };
      case "sale-block":
        return { path: "sale", body: { ...base, saleState: "BLOCKED" } };
      case "sale-storage":
        return { path: "sale", body: { ...base, saleState: "STORAGE_ONLY" } };
      case "condition":
        return { path: "condition", body: { ...base, condition, boxCondition, boxProfile, conditionNote: conditionNote.trim() || null } };
      case "owner":
        if (ownerKind === "PARTNER" && !ownerPartnerId) return "Choisissez le partenaire.";
        return { path: "owner", body: { ...base, ownerKind, ownerPartnerId: ownerKind === "PARTNER" ? ownerPartnerId : null } };
      case "item":
        if (!newItem) return "Choisissez la bonne variante.";
        return { path: "item", body: { ...base, itemId: newItem.id } };
      case "missing":
        return { path: "missing", body: base };
      case "out":
        return { path: "out", body: { ...base, outReason } };
      case "relocate":
        if (!dest) return "Scannez ou choisissez la destination.";
        return { path: "relocate", body: { ...base, toLocationId: dest.id, force: force ? true : undefined, acceptProfileMismatch: acceptProfile ? true : undefined } };
      case "duplicate-label":
        return { path: "duplicate-label", body: { ...base, note: reason.trim() || null } };
      case "confirm-item":
        if (!itemName.trim()) return "Indiquez le nom de l'article.";
        if (itemGtin.trim() && !/^\d{8,14}$/.test(itemGtin.trim())) return "GTIN : 8 à 14 chiffres, ou laissez vide.";
        return {
          path: "confirm-item",
          url: `items/${unit.itemId}/confirm`,
          body: { opKey, gtin: itemGtin.trim() || null, name: itemName.trim(), sizeLabel: itemSize.trim() || null, note: reason.trim() },
        };
      case "reprint":
        return { path: "reprint", body: { opKey, reason: reason.trim() } };
      case "external-ref":
        if (!refValue.trim()) return "Saisissez la référence.";
        return { path: "external-ref", body: { opKey, namespace, value: refValue.trim(), note: note.trim() || null } };
    }
  };

  const finish = (result: { print?: PrintOutcome } | null) => {
    if (action === "reprint" && result?.print) {
      setPrint(result.print);
      onDone();
      return;
    }
    onDone();
    onClose();
  };

  const submit = async () => {
    const req = build();
    if (typeof req === "string") {
      setError(req);
      return;
    }
    if (reasonRequired && reason.trim().length < 3) {
      setError("Le motif est obligatoire (3 caractères au moins).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await whPost<{ print?: PrintOutcome }>(req.url ?? `units/${unit.id}/${req.path}`, req.body);
      setUncertain(false);
      finish(result);
    } catch (err) {
      if (isWhError(err) && err.fateUnknown) {
        setUncertain(true);
        setError("Connexion perdue — le résultat de l'action est inconnu. Vérifiez avant de modifier quoi que ce soit.");
      } else {
        setUncertain(false);
        // Nothing was written: the form keeps every value.
        if (isWhError(err) && err.code === "SIZE_PROFILE_MISMATCH") setProfileAsk(err.message);
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      const res = await lookupOperation<{ print?: PrintOutcome }>(opKey);
      if (res.found) {
        setUncertain(false);
        finish(res.result ?? null);
      } else {
        setUncertain(false);
        setError("Rien n'a été enregistré : vous pouvez renvoyer l'action.");
      }
    } catch (err) {
      setError(isWhError(err) && err.fateUnknown ? "Connexion toujours perdue." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const frozen = busy || uncertain;

  return (
    <Modal
      open
      onClose={onClose}
      wide={action === "item"}
      tone={meta.danger ? "red" : undefined}
      title={found ? "Paire retrouvée" : meta.title}
      footer={
        print ? (
          <Btn variant="primary" onClick={onClose}>
            Fermer
          </Btn>
        ) : (
          <>
            <Btn onClick={onClose}>Annuler</Btn>
            {uncertain ? (
              <Btn variant="warn" busy={busy} onClick={() => void verify()}>
                Vérifier
              </Btn>
            ) : null}
            <Btn variant={meta.danger ? "danger" : "primary"} busy={busy} onClick={() => void submit()}>
              {uncertain ? "Réessayer (même clé)" : found ? "Enregistrer à cette adresse" : meta.confirm}
            </Btn>
          </>
        )
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
          <span className="font-medium text-slate-900 dark:text-slate-100">{itemTitle(unit.itemBrand, unit.itemName)}</span> · pointure {unit.itemSizeLabel ?? "—"} ·{" "}
          <span className="font-mono text-[#0A7A2C] dark:text-emerald-400">{unit.shortRef}</span>
        </div>
        {meta.intro && !found ? <p className="text-sm text-slate-600 dark:text-slate-300">{meta.intro}</p> : null}

        {print ? (
          <Notice tone={print.status === "QUEUED" ? "green" : "amber"}>
            <div className="font-semibold">Même code réimprimé :</div>
            <div className="break-all font-mono text-xs">{unit.labelCode}</div>
            <PrintOutcomeNote print={print} unitId={unit.id} className="mt-2" />
          </Notice>
        ) : (
          <fieldset disabled={frozen} className="space-y-3">
            {action === "condition" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="État de la paire">
                  <select value={condition} onChange={(e) => setCondition(e.target.value as typeof condition)} className={inputCls}>
                    {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Boîte">
                  <select value={boxCondition} onChange={(e) => setBoxCondition(e.target.value as typeof boxCondition)} className={inputCls}>
                    {Object.entries(BOX_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Format de la boîte">
                  <select value={boxProfile} onChange={(e) => setBoxProfile(e.target.value)} className={inputCls}>
                    <option value="STANDARD">Standard</option>
                    <option value="LARGE">Grande (bottes, double boîte)</option>
                    {!["STANDARD", "LARGE"].includes(boxProfile) ? <option value={boxProfile}>{boxProfile}</option> : null}
                  </select>
                </Field>
                <Field label="Précision sur l'état" className="sm:col-span-2">
                  <input value={conditionNote} onChange={(e) => setConditionNote(e.target.value)} className={inputCls} placeholder="ex. semelle jaunie, couvercle déchiré" />
                </Field>
              </div>
            ) : null}

            {action === "owner" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nouveau propriétaire">
                  <select value={ownerKind} onChange={(e) => setOwnerKind(e.target.value)} className={inputCls}>
                    <option value="OWN">Resell Lausanne</option>
                    <option value="PARTNER">Un partenaire</option>
                    <option value="UNKNOWN">Inconnu (à confirmer)</option>
                  </select>
                </Field>
                {ownerKind === "PARTNER" ? (
                  <Field label="Partenaire">
                    <select value={ownerPartnerId} onChange={(e) => setOwnerPartnerId(e.target.value)} className={inputCls}>
                      <option value="">Choisir…</option>
                      {partners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
              </div>
            ) : null}

            {action === "out" ? (
              <Field label="Type de sortie">
                <select value={outReason} onChange={(e) => setOutReason(e.target.value)} className={inputCls}>
                  {Object.entries(OUT_REASON_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {action === "item" ? (
              newItem ? (
                <Notice tone="green">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Nouvelle variante : <strong>{itemTitle(newItem.brand, newItem.name)}</strong> · pointure {newItem.sizeLabel ?? "—"} {newItem.styleCode ? `· ${newItem.styleCode}` : ""}
                    </span>
                    <Btn size="sm" onClick={() => setNewItem(null)}>
                      Changer
                    </Btn>
                  </div>
                </Notice>
              ) : (
                <IdentifyPanel
                  ident={ident}
                  busy={busy}
                  onCancel={onClose}
                  onPick={(next) => {
                    if (next.step !== "ready") {
                      setIdent(next);
                      return;
                    }
                    setError(null);
                    materializeItem(next)
                      .then(setNewItem)
                      .catch((err) => setError(errorMessage(err)));
                  }}
                />
              )
            ) : null}

            {action === "relocate" ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {found ? "Indiquez où la paire a été retrouvée." : `Actuellement en ${unit.currentLocationCode ?? "—"}.`}
                </p>
                {dest ? (
                  <Notice tone="green">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Destination : <span className="font-mono text-base font-semibold">{dest.code}</span> · {LOCATION_KIND_LABELS[dest.kind] ?? dest.kind}
                        {dest.capacity !== null ? ` · ${dest.occupiedCount + dest.reservedCount} / ${dest.capacity}` : ""}
                      </span>
                      <Btn size="sm" onClick={() => setDest(null)}>
                        Changer
                      </Btn>
                    </div>
                  </Notice>
                ) : (
                  <>
                    <Field label="Scannez ou saisissez le code de l'emplacement">
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          value={destCode}
                          onChange={(e) => setDestCode(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void resolveDest();
                            }
                          }}
                          placeholder="ex. CH01-A-R01-T02-N03"
                          className={inputCls + " font-mono"}
                          autoComplete="off"
                        />
                        <Btn onClick={() => void resolveDest()}>Valider</Btn>
                      </div>
                    </Field>
                    {zones.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {zones.map((z) => (
                          <button
                            key={z.id}
                            type="button"
                            onClick={() => setDest(z)}
                            className="min-h-[44px] rounded-lg border border-slate-300 px-3 font-mono text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
                          >
                            {z.code}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
                {profileAsk ? (
                  <label className="flex min-h-[44px] items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                    <input type="checkbox" checked={acceptProfile} onChange={(e) => setAcceptProfile(e.target.checked)} className="h-5 w-5" />
                    Ranger ici malgré le format de la boîte (noté dans l'historique)
                  </label>
                ) : null}
                {isAdmin ? (
                  <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="h-5 w-5" />
                    Forcer si l'emplacement est plein ou bloqué (un écart est ouvert)
                  </label>
                ) : null}
              </div>
            ) : null}

            {action === "confirm-item" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nom de l'article" className="sm:col-span-2">
                  <input value={itemName} onChange={(e) => setItemName(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Pointure">
                  <input value={itemSize} onChange={(e) => setItemSize(e.target.value)} className={inputCls} />
                </Field>
                <Field label="GTIN de la boîte (facultatif)">
                  <input inputMode="numeric" value={itemGtin} onChange={(e) => setItemGtin(e.target.value.replace(/[^0-9]/g, ""))} className={inputCls + " font-mono"} placeholder="8 à 14 chiffres" />
                </Field>
              </div>
            ) : null}

            {action === "external-ref" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Type de référence">
                  <select value={namespace} onChange={(e) => setNamespace(e.target.value)} className={inputCls}>
                    <option value="LEGACY_LABEL">Ancienne étiquette</option>
                    <option value="PARTNER_REF">Référence du partenaire</option>
                    <option value="SUPPLIER_REF">Référence fournisseur</option>
                    <option value="OTHER">Autre</option>
                  </select>
                </Field>
                <Field label="Valeur">
                  <input value={refValue} onChange={(e) => setRefValue(e.target.value)} className={inputCls + " font-mono"} autoComplete="off" />
                </Field>
              </div>
            ) : null}

            {meta.reason !== "none" ? (
              <Field label={reasonRequired ? "Motif (obligatoire)" : "Motif (facultatif)"}>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputCls + " py-2"} />
              </Field>
            ) : null}
            {action !== "reprint" ? (
              <Field label="Note interne (facultatif)">
                <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
              </Field>
            ) : null}
          </fieldset>
        )}

        {error ? <Notice tone={uncertain ? "amber" : "red"}>{error}</Notice> : null}
      </div>
    </Modal>
  );
}
