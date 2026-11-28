"use client";

import { ButtonLink } from "../_components/Button";
import { Card, CardHeader } from "../_components/Card";
import { EmptyState } from "../_components/EmptyState";
import { BoxIcon, ReceiptIcon, WalletIcon } from "../_components/icons";
import { KpiTile } from "../_components/KpiTile";
import { PageHeader } from "../_components/PageHeader";
import { StockModuleGate } from "../_components/StockModuleGate";
import { TEXT_MUTED, cx } from "../_components/ui";

const NO_PAYOUT_REASON = "Les versements seront affichés ici dès qu'une vente de votre stock en dépôt sera enregistrée.";

// No sale and no payout exists for stock in deposit at this stage: the tiles never show an amount.
const WALLET_TILES = ["Solde", "Disponible", "En attente"];

function SalesScreen() {
  return (
    <div className="space-y-5">
      <PageHeader title="Ventes et versements" description="Les ventes de votre stock en dépôt et ce qui vous est versé." />

      <section aria-labelledby="wallet">
        <h2 id="wallet" className="sr-only">
          Versements
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {WALLET_TILES.map((label) => (
            <KpiTile key={label} label={label} value="—" unavailable hint={NO_PAYOUT_REASON} />
          ))}
        </div>
      </section>

      <Card as="section" aria-label="Ventes de votre stock en dépôt">
        <EmptyState
          icon={<WalletIcon size={22} />}
          title="Aucune vente de votre stock en dépôt pour l'instant"
          action={
            <ButtonLink href="/partners/stock" icon={<BoxIcon size={17} />}>
              Voir mon stock
            </ButtonLink>
          }
        >
          Vos paires en dépôt ne sont publiées sur aucun canal de vente à ce stade. Chaque vente apparaîtra ici, avec son prix public et le net pour vous.
        </EmptyState>
      </Card>

      <Card as="section" aria-labelledby="sales-dropshipping">
        <CardHeader
          id="sales-dropshipping"
          title="Votre activité dropshipping"
          description="Les ventes et les factures de votre catalogue dropshipping ne changent pas : elles restent dans la rubrique Factures."
          action={
            <ButtonLink href="/partners/invoices" icon={<ReceiptIcon size={17} />}>
              Voir mes factures
            </ButtonLink>
          }
        />
        <p className={cx("mt-2 text-xs", TEXT_MUTED)}>Cette page ne concerne que les paires confiées à notre entrepôt.</p>
      </Card>
    </div>
  );
}

export default function PartnerSalesPage() {
  return (
    <StockModuleGate>
      <SalesScreen />
    </StockModuleGate>
  );
}
