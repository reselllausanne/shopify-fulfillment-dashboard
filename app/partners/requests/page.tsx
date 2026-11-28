"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../_components/Button";
import { Card, CardHeader } from "../_components/Card";
import { DisabledAction } from "../_components/DisabledAction";
import { EmptyState } from "../_components/EmptyState";
import { MessageIcon, PlusIcon } from "../_components/icons";
import { Notice } from "../_components/Notice";
import { PageHeader } from "../_components/PageHeader";
import { RequestForm } from "../_components/RequestForm";
import { RequestItem } from "../_components/RequestItem";
import { PageSkeleton, SkeletonRows } from "../_components/Skeleton";
import { StockModuleGate } from "../_components/StockModuleGate";
import { Tabs, type TabItem } from "../_components/Tabs";
import { HAIRLINE, TEXT_FAINT, cx } from "../_components/ui";
import { partnerApi, type PartnerRequestStatus, type PartnerRequestType } from "../_lib/api";
import { useApi } from "../_lib/useApi";

type Filter = "ALL" | PartnerRequestStatus;

const LIST_LIMIT = 200;
const TYPES: PartnerRequestType[] = ["PRICE_CHANGE", "DISCREPANCY", "OTHER"];

function RequestsScreen() {
  const params = useSearchParams();
  const wantsNew = params.get("nouvelle") === "1" || params.has("unitId");
  const typeParam = params.get("type") as PartnerRequestType | null;
  const initialType = typeParam && TYPES.includes(typeParam) ? typeParam : undefined;
  const initialUnitId = params.get("unitId");

  const { data, error, loading, reload } = useApi(() => partnerApi.requests({ limit: LIST_LIMIT }), []);
  const [formOpen, setFormOpen] = useState(wantsNew);
  const [formKey, setFormKey] = useState(0);
  const [filter, setFilter] = useState<Filter>("ALL");
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (wantsNew) setFormOpen(true);
  }, [wantsNew]);

  const requests = useMemo(() => data ?? [], [data]);
  const counts = useMemo(() => {
    const c: Record<PartnerRequestStatus, number> = { OPEN: 0, ANSWERED: 0, CLOSED: 0 };
    for (const r of requests) if (r.status in c) c[r.status] += 1;
    return c;
  }, [requests]);
  const shown = useMemo(() => (filter === "ALL" ? requests : requests.filter((r) => r.status === filter)), [requests, filter]);

  const tabs: TabItem<Filter>[] = [
    { value: "ALL", label: "Toutes", count: data ? requests.length : null },
    { value: "OPEN", label: "Ouvertes", count: data ? counts.OPEN : null },
    { value: "ANSWERED", label: "Répondues", count: data ? counts.ANSWERED : null },
    { value: "CLOSED", label: "Closes", count: data ? counts.CLOSED : null },
  ];

  const openForm = () => {
    setFormOpen(true);
    setFormKey((k) => k + 1);
    window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Demandes et retraits"
        description="Écrivez à notre équipe au sujet de votre stock en dépôt : un prix à revoir, un écart constaté, une question. Nous vous répondons ici."
        actions={
          !formOpen ? (
            <Button variant="primary" onClick={openForm} icon={<PlusIcon size={17} />}>
              Nouvelle demande
            </Button>
          ) : null
        }
      />

      {formOpen ? (
        <div ref={formRef} className="scroll-mt-20">
          <Card as="section" aria-labelledby="new-request">
            <CardHeader id="new-request" title="Nouvelle demande" description="Une demande est un message à notre équipe : rien n'est modifié automatiquement." />
            <div className="mt-4 max-w-2xl">
              <RequestForm
                key={formKey}
                types={TYPES}
                defaultType={initialType}
                initialUnitId={initialUnitId}
                onCreated={reload}
                onCancel={() => setFormOpen(false)}
                hideRequestsLink
              />
            </div>
          </Card>
        </div>
      ) : null}

      <Card as="section" aria-labelledby="withdrawal">
        <CardHeader id="withdrawal" title="Retrait de paires" description="Récupérer des paires confiées à l'entrepôt." />
        <DisabledAction
          className="mt-3"
          label="Demander un retrait"
          reason="Retrait de paires : à convenir avec l'entrepôt ; envoyez une demande « Autre » en précisant les paires."
        />
      </Card>

      <Card as="section" flush aria-labelledby="my-requests">
        <div className="px-4 pt-4 sm:px-5">
          <CardHeader id="my-requests" title="Mes demandes" />
        </div>
        <Tabs items={tabs} value={filter} onChange={setFilter} label="Filtrer mes demandes par état" bleed={false} className="mt-1 px-1 sm:px-2" />
        <div>
          {error && !data ? (
            <div className="p-4">
              <Notice
                tone="error"
                action={
                  <Button size="sm" onClick={reload}>
                    Réessayer
                  </Button>
                }
              >
                {error.message}
              </Notice>
            </div>
          ) : loading && !data ? (
            <SkeletonRows rows={3} />
          ) : requests.length === 0 ? (
            <EmptyState
              icon={<MessageIcon size={20} />}
              title="Aucune demande pour l'instant"
              action={
                !formOpen ? (
                  <Button variant="primary" onClick={openForm}>
                    Nouvelle demande
                  </Button>
                ) : null
              }
            >
              Vos demandes et les réponses de notre équipe apparaîtront ici.
            </EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState compact title="Aucune demande dans cet état" />
          ) : (
            <ul className="divide-y divide-[#EEF0EE] dark:divide-slate-800">
              {shown.map((request) => (
                <li key={request.id}>
                  <RequestItem request={request} />
                </li>
              ))}
            </ul>
          )}
        </div>
        {data && requests.length >= LIST_LIMIT ? (
          <p className={cx("border-t px-4 py-3 text-xs sm:px-5", HAIRLINE, TEXT_FAINT)}>
            Les {LIST_LIMIT} demandes les plus récentes sont affichées.
          </p>
        ) : null}
      </Card>
    </div>
  );
}

export default function PartnerRequestsPage() {
  return (
    <StockModuleGate>
      <Suspense fallback={<PageSkeleton />}>
        <RequestsScreen />
      </Suspense>
    </StockModuleGate>
  );
}
