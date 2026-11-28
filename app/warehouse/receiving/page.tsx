"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { BatchRow } from "@/lib/warehouse/batches";
import type { BatchFlow, BatchKind, LocationSummary, OwnerKind } from "@/lib/warehouse/types";
import { errorMessage, whGet, whPost } from "../_lib/api";
import { useWarehouse } from "../_lib/context";
import { LOCATION_KIND_LABELS } from "../_lib/format";
import { useLoad } from "../_lib/hooks";
import { BatchTable } from "../_components/BatchTable";
import { Btn, Card, ErrorNote, Field, Loading, Modal, Notice, PageHeader, Segmented, inputCls } from "../_components/ui";

type PartnerOption = { id: string; key: string; name: string; active: boolean };

function NewBatchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { siteId, site } = useWarehouse();
  const [kind, setKind] = useState<BatchKind>("STOCK_TAKE");
  const [flow, setFlow] = useState<BatchFlow>("CONSIGNMENT");
  const [ownerPartnerId, setOwnerPartnerId] = useState("");
  const [supplierOwner, setSupplierOwner] = useState<"OWN" | "PARTNER">("OWN");
  const [receivingLocationId, setReceivingLocationId] = useState("");
  const [form, setForm] = useState({ title: "", notes: "", sourceDocType: "", sourceDocRef: "", supplierName: "", countedAt: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const partners = useLoad<PartnerOption[]>(() => whGet<PartnerOption[]>("partners"), [], { enabled: open });
  const zones = useLoad<{ items: LocationSummary[] }>(() => whGet("locations", { siteId, kinds: "RECEIVING,CART", status: "ACTIVE", limit: 200 }), [siteId], {
    enabled: open && Boolean(siteId),
  });

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const ownerKind: OwnerKind = flow === "CONSIGNMENT" ? "PARTNER" : flow === "OWN_STOCK" ? "OWN" : supplierOwner;
  const needsPartner = ownerKind === "PARTNER";
  const valid = Boolean(siteId) && (!needsPartner || ownerPartnerId) && (kind !== "RECEIVING" || receivingLocationId);

  const submit = async () => {
    if (!siteId) return;
    setBusy(true);
    setError(null);
    try {
      const batch = await whPost<BatchRow>("batches", {
        siteId,
        kind,
        flow,
        ownerKind,
        ownerPartnerId: needsPartner ? ownerPartnerId : null,
        receivingLocationId: kind === "RECEIVING" ? receivingLocationId : null,
        title: form.title || null,
        notes: form.notes || null,
        sourceDocType: form.sourceDocType || null,
        sourceDocRef: form.sourceDocRef || null,
        supplierName: flow === "SUPPLIER" ? form.supplierName || null : null,
        countedAt: kind === "STOCK_TAKE" && form.countedAt ? form.countedAt : null,
      });
      router.push(`/warehouse/receiving/${batch.id}`);
    } catch (err) {
      // The form keeps everything that was typed.
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`Nouveau lot${site ? ` · ${site.code}` : ""}`}
      footer={
        <>
          <Btn onClick={onClose}>Annuler</Btn>
          <Btn variant="primary" busy={busy} disabled={!valid} onClick={() => void submit()}>
            Créer le lot
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Type de lot</div>
          <Segmented<BatchKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: "STOCK_TAKE", label: "Reprise de stock existant" },
              { value: "RECEIVING", label: "Réception" },
            ]}
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {kind === "STOCK_TAKE"
              ? "Les paires sont déjà en rayon, sans étiquette : on scanne un niveau, puis chaque boîte."
              : "Les boîtes arrivent : chaque boîte est identifiée, étiquetée et posée en zone de réception ou sur un chariot."}
          </p>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Origine</div>
          <Segmented<BatchFlow>
            value={flow}
            onChange={setFlow}
            options={[
              { value: "CONSIGNMENT", label: "Dépôt partenaire" },
              { value: "OWN_STOCK", label: "Stock Resell" },
              { value: "SUPPLIER", label: "Fournisseur" },
            ]}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {flow === "SUPPLIER" ? (
            <Field label="Propriétaire des paires">
              <select value={supplierOwner} onChange={(e) => setSupplierOwner(e.target.value as "OWN" | "PARTNER")} className={inputCls}>
                <option value="OWN">Resell Lausanne</option>
                <option value="PARTNER">Un partenaire</option>
              </select>
            </Field>
          ) : null}
          {needsPartner ? (
            <Field label="Partenaire déposant">
              <select value={ownerPartnerId} onChange={(e) => setOwnerPartnerId(e.target.value)} className={inputCls}>
                <option value="">Choisir…</option>
                {(partners.data ?? [])
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.key})
                    </option>
                  ))}
              </select>
            </Field>
          ) : flow === "OWN_STOCK" ? (
            <Field label="Propriétaire">
              <input disabled value="Resell Lausanne" className={inputCls} />
            </Field>
          ) : null}
          {flow === "SUPPLIER" ? (
            <Field label="Fournisseur">
              <input value={form.supplierName} onChange={(e) => setForm({ ...form, supplierName: e.target.value })} className={inputCls} />
            </Field>
          ) : null}
          {kind === "RECEIVING" ? (
            <Field label="Où attendent les boîtes" hint="Zone de réception ou chariot du site.">
              <select value={receivingLocationId} onChange={(e) => setReceivingLocationId(e.target.value)} className={inputCls}>
                <option value="">Choisir…</option>
                {(zones.data?.items ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · {LOCATION_KIND_LABELS[l.kind] ?? l.kind} ({l.occupiedCount} paires)
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Date du comptage (facultatif)">
              <input type="date" value={form.countedAt} onChange={(e) => setForm({ ...form, countedAt: e.target.value })} className={inputCls} />
            </Field>
          )}
          <Field label="Intitulé (facultatif)">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} placeholder="ex. Dépôt Tony, novembre" />
          </Field>
          <Field label="Type de document (facultatif)">
            <input value={form.sourceDocType} onChange={(e) => setForm({ ...form, sourceDocType: e.target.value })} className={inputCls} placeholder="Bordereau, facture, liste…" />
          </Field>
          <Field label="Référence du document (facultatif)">
            <input value={form.sourceDocRef} onChange={(e) => setForm({ ...form, sourceDocRef: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Notes (facultatif)" className="sm:col-span-2">
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className={inputCls + " py-2"} />
          </Field>
        </div>
        <ErrorNote error={partners.error ?? zones.error} />
        {kind === "RECEIVING" && zones.data && zones.data.items.length === 0 ? (
          <Notice tone="amber">Aucune zone de réception ni chariot actif sur ce site : en créer un dans Emplacements.</Notice>
        ) : null}
        {error ? <Notice tone="red">{error}</Notice> : null}
      </div>
    </Modal>
  );
}

export default function ReceivingPage() {
  const { siteId, readOnly } = useWarehouse();
  const [creating, setCreating] = useState(false);
  const open = useLoad<BatchRow[]>(() => whGet<BatchRow[]>("batches", { siteId, status: "OPEN,PAUSED" }), [siteId], { enabled: Boolean(siteId), intervalMs: 30_000 });
  const closed = useLoad<BatchRow[]>(() => whGet<BatchRow[]>("batches", { siteId, status: "CLOSED,CANCELLED", limit: 15 }), [siteId], { enabled: Boolean(siteId) });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Réception et reprise"
        subtitle="Un lot regroupe les boîtes d'une même arrivée ou d'une même reprise de stock."
        actions={
          <Btn variant="primary" disabled={readOnly} onClick={() => setCreating(true)}>
            Nouveau lot
          </Btn>
        }
      />
      <ErrorNote error={open.error} onRetry={() => void open.reload()} />
      <Card title="Lots en cours" flush>
        {open.data ? <BatchTable batches={open.data} emptyLabel="Aucun lot en cours sur ce site." /> : open.loading ? <Loading /> : null}
      </Card>
      <Card title="Lots récemment clos" flush>
        {closed.data ? <BatchTable batches={closed.data} emptyLabel="Aucun lot clos." /> : closed.loading ? <Loading /> : <ErrorNote error={closed.error} className="m-3" />}
      </Card>
      <NewBatchModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
