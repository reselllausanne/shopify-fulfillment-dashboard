"use client";

import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { Button, ButtonLink } from "../../_components/Button";
import { Card, CardHeader } from "../../_components/Card";
import { CopyRef } from "../../_components/CopyRef";
import { EmptyState } from "../../_components/EmptyState";
import { BoxIcon, TagIcon } from "../../_components/icons";
import { PricePair } from "../../_components/Money";
import { Notice } from "../../_components/Notice";
import { PageHeader } from "../../_components/PageHeader";
import { ProductThumb } from "../../_components/ProductThumb";
import { RequestForm } from "../../_components/RequestForm";
import { RequestItem } from "../../_components/RequestItem";
import { Skeleton } from "../../_components/Skeleton";
import { StatusChip } from "../../_components/StatusChip";
import { StockModuleGate } from "../../_components/StockModuleGate";
import { HAIRLINE, TEXT, TEXT_FAINT, TEXT_MUTED, cx } from "../../_components/ui";
import { isNotFound, partnerApi, type PartnerRequestType, type PartnerUnitDetail, type PartnerUnitStatus } from "../../_lib/api";
import { formatDate, formatDateTime, productTitle } from "../../_lib/format";
import { BOX_LABELS, CONDITION_LABELS, PRICE_OWNER_SENTENCE, UNIT_STATUS } from "../../_lib/labels";
import { useApi } from "../../_lib/useApi";

const BACK = { href: "/partners/stock", label: "Mon stock" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className={cx("shrink-0 text-sm", TEXT_MUTED)}>{label}</dt>
      <dd className={cx("min-w-0 text-right text-sm font-medium", TEXT)}>{children}</dd>
    </div>
  );
}

function Identity({ unit }: { unit: PartnerUnitDetail }) {
  return (
    <Card as="section" aria-labelledby="unit-identity">
      <CardHeader id="unit-identity" title="Identité de la paire" />
      <dl className={cx("mt-2 divide-y", "divide-[#EEF0EE] dark:divide-slate-800")}>
        <Field label="Référence de la paire">
          <CopyRef value={unit.shortRef} size="md" />
        </Field>
        <Field label="Marque">{unit.itemBrand ?? "—"}</Field>
        <Field label="Modèle">{unit.itemName}</Field>
        <Field label="Pointure">{unit.itemSizeLabel ?? "—"}</Field>
        <Field label="Référence fabricant">{unit.itemStyleCode ?? "—"}</Field>
        <Field label="GTIN">{unit.itemGtin ? <span className="font-mono text-[13px]">{unit.itemGtin}</span> : "—"}</Field>
        <Field label="État">{CONDITION_LABELS[unit.condition] ?? "À contrôler"}</Field>
        <Field label="Boîte">{BOX_LABELS[unit.boxCondition] ?? "À contrôler"}</Field>
        <Field label="Site">{unit.siteName ?? unit.siteCode ?? "—"}</Field>
        <Field label="Reçue le">{formatDate(unit.receivedAt) ?? "—"}</Field>
      </dl>
    </Card>
  );
}

function StatusCard({ unit }: { unit: PartnerUnitDetail }) {
  const meta = UNIT_STATUS[unit.status as PartnerUnitStatus];
  return (
    <Card as="section" aria-labelledby="unit-status">
      <CardHeader id="unit-status" title="Statut" action={<StatusChip status={unit.status} />} />
      <p className={cx("mt-2 text-sm leading-6", TEXT_MUTED)}>
        {meta?.explain ?? "Le statut de cette paire est en cours de mise à jour."}
      </p>
    </Card>
  );
}

function PriceCard({ unit, onAskPriceChange }: { unit: PartnerUnitDetail; onAskPriceChange: () => void }) {
  const priced = Boolean(unit.publicPrice);
  return (
    <Card as="section" aria-labelledby="unit-price">
      <CardHeader id="unit-price" title="Prix" />
      <PricePair publicPrice={unit.publicPrice} sellerNet={unit.sellerNet} currency={unit.currency} size="lg" className="mt-3" />
      <div className={cx("mt-4 space-y-1.5 border-t pt-3 text-sm leading-6", HAIRLINE, TEXT_MUTED)}>
        {priced ? (
          <p>
            Le <strong className={cx("font-medium", TEXT)}>prix public</strong> est le prix affiché au client. Le{" "}
            <strong className={cx("font-medium", TEXT)}>net pour vous</strong> est ce prix, déduction faite de la commission et des frais prévus par votre
            accord de dépôt.
          </p>
        ) : (
          <p>Aucun prix n'est encore défini pour cette paire.</p>
        )}
        <p>{PRICE_OWNER_SENTENCE}</p>
      </div>
      <div className="mt-3">
        <Button onClick={onAskPriceChange} icon={<TagIcon size={17} />}>
          Demander une modification de prix
        </Button>
      </div>
    </Card>
  );
}

function Timeline({ unit }: { unit: PartnerUnitDetail }) {
  return (
    <Card as="section" aria-labelledby="unit-timeline">
      <CardHeader id="unit-timeline" title="Suivi" description="Les étapes de votre paire chez nous, de la plus récente à la plus ancienne." />
      {unit.timeline.length === 0 ? (
        <p className={cx("mt-3 text-sm", TEXT_MUTED)}>Aucune étape enregistrée pour l'instant.</p>
      ) : (
        <ol className="mt-4">
          {unit.timeline.map((step, index) => (
            <li key={`${step.at}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
              {index < unit.timeline.length - 1 ? <span aria-hidden="true" className="absolute bottom-0 left-[5px] top-4 w-px bg-[#E7E9E7] dark:bg-slate-700" /> : null}
              <span
                aria-hidden="true"
                className={cx(
                  "relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2",
                  index === 0 ? "border-[#02C73A] bg-[#02C73A]" : "border-[#C9CFCA] bg-white dark:border-slate-600 dark:bg-slate-900"
                )}
              />
              <div className="min-w-0">
                <div className={cx("text-sm font-medium", TEXT)}>{step.label}</div>
                <div className={cx("text-xs", TEXT_FAINT)}>{formatDateTime(step.at) ?? "—"}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function UnitRequests({ unit, formType, onOpenForm, onCloseForm, onCreated }: {
  unit: PartnerUnitDetail;
  formType: PartnerRequestType | null;
  onOpenForm: (type: PartnerRequestType) => void;
  onCloseForm: () => void;
  onCreated: () => void;
}) {
  return (
    <Card as="section" flush aria-labelledby="unit-requests">
      <div className="p-4 sm:p-5">
        <CardHeader
          id="unit-requests"
          title="Demandes sur cette paire"
          description="Une question, un prix à revoir, un écart constaté : écrivez-nous, nous vous répondons ici."
        />
        {formType ? (
          <div className={cx("mt-4 rounded-lg border p-4", HAIRLINE)}>
            <RequestForm key={formType} unit={unit} defaultType={formType} onCreated={onCreated} onCancel={onCloseForm} />
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => onOpenForm("PRICE_CHANGE")}>
              Demander une modification de prix
            </Button>
            <Button onClick={() => onOpenForm("DISCREPANCY")}>Signaler un écart</Button>
          </div>
        )}
      </div>
      {unit.requests.length > 0 ? (
        <ul className={cx("divide-y border-t", HAIRLINE, "divide-[#EEF0EE] dark:divide-slate-800")}>
          {unit.requests.map((request) => (
            <li key={request.id}>
              <RequestItem request={request} hideUnit />
            </li>
          ))}
        </ul>
      ) : (
        <p className={cx("border-t px-4 py-4 text-sm sm:px-5", HAIRLINE, TEXT_MUTED)}>Aucune demande sur cette paire pour l'instant.</p>
      )}
    </Card>
  );
}

function UnitScreen({ unitId }: { unitId: string }) {
  const { data: unit, error, loading, reload } = useApi(() => partnerApi.unit(unitId), [unitId]);
  const [formType, setFormType] = useState<PartnerRequestType | null>(null);
  const requestsRef = useRef<HTMLDivElement>(null);

  const openForm = (type: PartnerRequestType) => {
    setFormType(type);
    // The form sits in the "Demandes" block: bring it into view.
    window.requestAnimationFrame(() => requestsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  if (!unit && loading) {
    return (
      <div role="status" aria-label="Chargement de la paire" className="space-y-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Skeleton className="h-72 w-full rounded-lg" />
          <div className="space-y-5">
            <Skeleton className="h-28 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (!unit) {
    // A pair of another partner and an unknown reference get the same answer.
    if (isNotFound(error)) {
      return (
        <div className="space-y-5">
          <PageHeader title="Paire introuvable" back={BACK} />
          <Card>
            <EmptyState
              icon={<BoxIcon size={22} />}
              title="Aucune paire ne correspond à cette référence"
              action={
                <ButtonLink href="/partners/stock" variant="primary">
                  Retour à mon stock
                </ButtonLink>
              }
            >
              Vérifiez le lien ou la référence, puis retrouvez vos paires dans « Mon stock ».
            </EmptyState>
          </Card>
        </div>
      );
    }
    return (
      <div className="space-y-5">
        <PageHeader title="Paire" back={BACK} />
        <Notice
          tone="error"
          action={
            <Button size="sm" onClick={reload}>
              Réessayer
            </Button>
          }
        >
          {error?.message ?? "Impossible d'afficher cette paire pour le moment."}
        </Notice>
      </div>
    );
  }

  const title = productTitle(unit.itemBrand, unit.itemName);

  return (
    <div className="space-y-5">
      <PageHeader
        back={BACK}
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Pointure {unit.itemSizeLabel ?? "—"}</span>
            {unit.itemStyleCode ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{unit.itemStyleCode}</span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <CopyRef value={unit.shortRef} />
          </span>
        }
        actions={<StatusChip status={unit.status} className="px-2.5 py-1 text-[13px]" />}
      />

      {error ? <Notice tone="error">{error.message}</Notice> : null}

      {/* Mobile: photo, status and price, then identity. Desktop: photo + identity on the left. */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start">
        <Card className="lg:col-start-1 lg:row-start-1">
          <ProductThumb
            src={unit.itemImageUrl}
            alt={title}
            size="lg"
            className="mx-auto max-w-[220px] border-0 bg-transparent dark:bg-transparent lg:max-w-none"
          />
          {!unit.itemImageUrl ? <p className={cx("mt-2 text-center text-xs", TEXT_FAINT)}>Pas de photo disponible pour ce modèle.</p> : null}
        </Card>

        <div className="space-y-5 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <StatusCard unit={unit} />
          <PriceCard unit={unit} onAskPriceChange={() => openForm("PRICE_CHANGE")} />
          <Timeline unit={unit} />
          <div ref={requestsRef} className="scroll-mt-20">
            <UnitRequests unit={unit} formType={formType} onOpenForm={openForm} onCloseForm={() => setFormType(null)} onCreated={reload} />
          </div>
        </div>

        <div className="lg:col-start-1 lg:row-start-2">
          <Identity unit={unit} />
        </div>
      </div>
    </div>
  );
}

export default function PartnerUnitPage() {
  const params = useParams<{ unitId: string }>();
  const unitId = typeof params?.unitId === "string" ? params.unitId : "";
  return (
    <StockModuleGate>
      <UnitScreen unitId={unitId} />
    </StockModuleGate>
  );
}
