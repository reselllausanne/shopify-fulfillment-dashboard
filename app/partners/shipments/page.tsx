"use client";

import { ButtonLink } from "../_components/Button";
import { Card, CardHeader } from "../_components/Card";
import { DisabledAction } from "../_components/DisabledAction";
import { EmptyState } from "../_components/EmptyState";
import { BoxIcon, MessageIcon, TruckIcon } from "../_components/icons";
import { KpiTile } from "../_components/KpiTile";
import { PageHeader } from "../_components/PageHeader";
import { StockModuleGate } from "../_components/StockModuleGate";
import { HAIRLINE, TEXT, TEXT_MUTED, cx } from "../_components/ui";
import { formatCount, formatDate } from "../_lib/format";
import { usePartnerPortal } from "../_lib/portal";

const STEPS = [
  {
    title: "Prévenez-nous avant d'envoyer des paires",
    text: "Écrivez-nous avec les modèles, les pointures et les quantités prévues.",
  },
  {
    title: "L'entrepôt enregistre chaque paire à son arrivée",
    text: "Chaque paire reçoit sa propre référence, que vous retrouvez dans « Mon stock ».",
  },
  {
    title: "Contrôle, puis mise en stock",
    text: "Le statut de chaque paire passe de « En contrôle » à « Stocké » ou « Vente autorisée ».",
  },
];

function ShipmentsScreen() {
  const { summary } = usePartnerPortal();
  const lastReceived = formatDate(summary?.lastReceivedAt);

  return (
    <div className="space-y-5">
      <PageHeader title="Envois" description="L'arrivée de vos paires à notre entrepôt." />

      <Card as="section" aria-labelledby="shipments-today">
        <EmptyState
          icon={<TruckIcon size={22} />}
          title="Aucun envoi à suivre ici pour l'instant"
          action={
            <ButtonLink href="/partners/stock" variant="primary" icon={<BoxIcon size={17} />}>
              Voir mon stock
            </ButtonLink>
          }
        >
          <span id="shipments-today">Vos paires sont enregistrées à leur arrivée par l'entrepôt.</span> Le suivi d'un envoi en cours n'existe pas encore dans
          cet espace : une paire apparaît dans « Mon stock » dès qu'elle a été enregistrée.
        </EmptyState>
      </Card>

      {summary ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiTile
            label="Dernière réception"
            value={lastReceived ?? "—"}
            unavailable={!lastReceived}
            hint={lastReceived ? "Date d'enregistrement de votre dernière paire arrivée" : "Aucune paire reçue pour l'instant."}
            size={lastReceived ? "md" : "lg"}
            className="col-span-2 lg:col-span-1"
          />
          <KpiTile label="Paires en dépôt" value={formatCount(summary.held)} hint="Enregistrées et présentes à l'entrepôt" href="/partners/stock" />
          <KpiTile
            label="En route entre nos sites"
            value={formatCount(summary.inTransit)}
            hint="Paires déjà enregistrées, en transfert"
            href="/partners/stock?tab=route"
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card as="section" aria-labelledby="shipments-how">
          <CardHeader id="shipments-how" title="Comment cela se passe aujourd'hui" />
          <ol className="mt-3 space-y-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E6F9EB] text-xs font-semibold text-[#017723] dark:bg-[#02C73A]/10 dark:text-[#5BE584]"
                >
                  {index + 1}
                </span>
                <div>
                  <div className={cx("text-sm font-medium", TEXT)}>{step.title}</div>
                  <div className={cx("text-sm leading-6", TEXT_MUTED)}>{step.text}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card as="section" aria-labelledby="shipments-declare">
          <CardHeader id="shipments-declare" title="Déclarer un envoi" description="Annoncer en ligne les paires que vous nous envoyez." />
          <DisabledAction
            className="mt-3"
            label="Déclarer un envoi"
            icon={<TruckIcon size={16} />}
            reason="Déclaration d'envoi en ligne : pas encore disponible ; contactez-nous avant d'envoyer des paires."
          />
          <div className={cx("mt-4 border-t pt-4", HAIRLINE)}>
            <p className={cx("text-sm leading-6", TEXT_MUTED)}>En attendant, annoncez votre envoi par une demande « Autre ».</p>
            <ButtonLink href="/partners/requests?nouvelle=1&type=OTHER" className="mt-2" icon={<MessageIcon size={17} />}>
              Écrire à l'équipe
            </ButtonLink>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function PartnerShipmentsPage() {
  return (
    <StockModuleGate>
      <ShipmentsScreen />
    </StockModuleGate>
  );
}
