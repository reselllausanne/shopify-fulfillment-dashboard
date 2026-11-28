"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, ButtonLink } from "../_components/Button";
import { Card, CardHeader } from "../_components/Card";
import { BoxIcon, ChartIcon, ChevronRightIcon, ClockIcon, DownloadIcon, MessageIcon, ReceiptIcon, StoreIcon, TagIcon } from "../_components/icons";
import { KpiTile } from "../_components/KpiTile";
import { Money } from "../_components/Money";
import { Notice } from "../_components/Notice";
import { PageHeader } from "../_components/PageHeader";
import { PageSkeleton } from "../_components/Skeleton";
import { FOCUS, HAIRLINE, LINK, TEXT, TEXT_FAINT, TEXT_MUTED, cx } from "../_components/ui";
import { errorMessage, partnerApi, type PartnerStockSummary } from "../_lib/api";
import { formatCount, formatDate, pairs } from "../_lib/format";
import { usePartnerPortal } from "../_lib/portal";
import DropshippingDashboard from "./DropshippingDashboard";

function Shortcut({ href, icon, title, text }: { href: string; icon: React.ReactNode; title: string; text: string }) {
  return (
    <Link
      href={href}
      className={cx("flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#FAFBFA] dark:hover:bg-slate-800/40 sm:px-5", FOCUS, "focus-visible:-outline-offset-2")}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E6F9EB] text-[#017723] dark:bg-[#02C73A]/10 dark:text-[#5BE584]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cx("block text-sm font-medium", TEXT)}>{title}</span>
        <span className={cx("block text-xs", TEXT_FAINT)}>{text}</span>
      </span>
      <ChevronRightIcon size={18} className={TEXT_FAINT} />
    </Link>
  );
}

function StockHome({ summary }: { summary: PartnerStockSummary }) {
  const { partner, summaryError } = usePartnerPortal();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await partnerApi.exportCsv();
    } catch (err) {
      setExportError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const lastReceived = formatDate(summary.lastReceivedAt);
  const onHold = summary.blocked + summary.checking;

  return (
    <div className="space-y-6">
      <PageHeader
        title={partner ? `Bonjour, ${partner.name}` : "Bonjour"}
        description="Votre stock en dépôt chez Resell Lausanne, en un coup d'œil."
        actions={
          <>
            <ButtonLink href="/partners/stock" variant="primary" icon={<BoxIcon size={17} />}>
              Voir mon stock
            </ButtonLink>
            <Button onClick={exportCsv} busy={exporting} icon={<DownloadIcon size={17} />}>
              {exporting ? "Export…" : "Exporter (CSV)"}
            </Button>
            <ButtonLink href="/partners/requests?nouvelle=1" icon={<MessageIcon size={17} />}>
              Faire une demande
            </ButtonLink>
          </>
        }
      />

      {summaryError ? (
        <Notice tone="warning" title="Les chiffres affichés ne sont peut-être pas à jour">
          {summaryError.message}
        </Notice>
      ) : null}
      {exportError ? <Notice tone="error">{exportError}</Notice> : null}

      <section aria-labelledby="home-stock" className="space-y-3">
        <h2 id="home-stock" className="sr-only">
          Mon stock en chiffres
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <KpiTile label="Paires en dépôt" value={formatCount(summary.held)} hint="Présentes dans notre entrepôt" href="/partners/stock" />
          <KpiTile
            label="Valeur au prix public"
            unavailable={summary.publicValue.length === 0}
            value={
              summary.publicValue.length > 0 ? (
                <span className="flex flex-col">
                  {summary.publicValue.map((v) => (
                    <Money key={v.currency} amount={v.amount} currency={v.currency} />
                  ))}
                </span>
              ) : (
                "—"
              )
            }
            hint={
              summary.pricedUnits > 0
                ? `Sur ${pairs(summary.pricedUnits)} avec prix, parmi ${pairs(summary.held)} en dépôt`
                : "Aucune de vos paires n'a encore de prix défini."
            }
            href="/partners/prices"
          />
          <KpiTile label="Publiées sur les canaux" value="—" unavailable hint={summary.publishedReason} />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile label="Stockées" value={formatCount(summary.stored)} hint="Contrôlées, en stock" href="/partners/stock?statut=STORED" />
          <KpiTile label="En contrôle" value={formatCount(summary.inControl)} hint="Vérification à l'arrivée" href="/partners/stock?statut=IN_CONTROL" />
          <KpiTile
            label="Vente autorisée"
            value={formatCount(summary.saleAuthorized)}
            hint="Contrôlées, vente permise"
            href="/partners/stock?statut=SALE_AUTHORIZED"
            accent={summary.saleAuthorized > 0}
          />
          <KpiTile
            label="Bloquées / en vérification"
            value={formatCount(onHold)}
            hint={`${formatCount(summary.blocked)} ${summary.blocked > 1 ? "bloquées" : "bloquée"} · ${formatCount(summary.checking)} en vérification`}
            href={summary.blocked === 0 && summary.checking > 0 ? "/partners/stock?statut=CHECKING" : "/partners/stock?statut=BLOCKED"}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card as="section" aria-labelledby="home-reception">
          <div className="flex items-center gap-2">
            <ClockIcon size={18} className={TEXT_FAINT} />
            <h2 id="home-reception" className={cx("text-[15px] font-semibold", TEXT)}>
              Dernière réception
            </h2>
          </div>
          <p className={cx("mt-2 text-lg font-semibold", lastReceived ? TEXT : "text-[#8A948D] dark:text-slate-500")}>{lastReceived ?? "—"}</p>
          <p className={cx("mt-1 text-xs leading-5", TEXT_FAINT)}>
            {lastReceived ? "Date d'enregistrement de votre dernière paire arrivée à l'entrepôt." : "Aucune paire reçue pour l'instant."}
          </p>
          {summary.inTransit > 0 ? (
            <p className={cx("mt-2 text-sm", TEXT_MUTED)}>
              {pairs(summary.inTransit)} en route entre deux de nos sites.{" "}
              <Link href="/partners/stock?tab=route" className={LINK}>
                Voir
              </Link>
            </p>
          ) : null}
        </Card>

        <Card as="section" aria-labelledby="home-sites">
          <div className="flex items-center gap-2">
            <StoreIcon size={18} className={TEXT_FAINT} />
            <h2 id="home-sites" className={cx("text-[15px] font-semibold", TEXT)}>
              Sites
            </h2>
          </div>
          {summary.sites.length > 0 ? (
            <ul className="mt-2 divide-y divide-[#EEF0EE] dark:divide-slate-800">
              {summary.sites.map((site) => (
                <li key={site.siteCode} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                  <span className={cx("min-w-0 truncate font-medium", TEXT)}>
                    {site.siteName} <span className={cx("font-mono text-xs font-normal", TEXT_FAINT)}>{site.siteCode}</span>
                  </span>
                  <span className={cx("shrink-0 tabular-nums", TEXT_MUTED)}>{pairs(site.held)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={cx("mt-2 text-sm", TEXT_MUTED)}>Aucune paire présente sur un site pour l'instant.</p>
          )}
        </Card>

        <Card as="section" aria-labelledby="home-requests">
          <div className="flex items-center gap-2">
            <MessageIcon size={18} className={TEXT_FAINT} />
            <h2 id="home-requests" className={cx("text-[15px] font-semibold", TEXT)}>
              Demandes ouvertes
            </h2>
          </div>
          <p className={cx("mt-2 text-lg font-semibold tabular-nums", TEXT)}>{formatCount(summary.openRequests)}</p>
          <p className={cx("mt-1 text-xs leading-5", TEXT_FAINT)}>
            {summary.openRequests > 0 ? "En attente d'une réponse de notre équipe." : "Aucune demande en attente de réponse."}
          </p>
          <p className="mt-2 text-sm">
            <Link href="/partners/requests" className={LINK}>
              Voir mes demandes
            </Link>
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card as="section" flush aria-labelledby="home-shortcuts">
          <div className="px-4 pb-2 pt-4 sm:px-5">
            <CardHeader id="home-shortcuts" title="Raccourcis" />
          </div>
          <div className={cx("divide-y border-t", HAIRLINE, "divide-[#EEF0EE] dark:divide-slate-800")}>
            <Shortcut href="/partners/stock" icon={<BoxIcon size={18} />} title="Voir mon stock" text="Chaque paire, son statut et ses prix" />
            <Shortcut href="/partners/prices" icon={<TagIcon size={18} />} title="Prix et canaux" text="Prix public et net pour vous, par modèle" />
            <Shortcut href="/partners/requests?nouvelle=1" icon={<MessageIcon size={18} />} title="Faire une demande" text="Modification de prix, écart constaté ou autre" />
          </div>
        </Card>

        <Card as="section" flush aria-labelledby="home-dropshipping">
          <div className="px-4 pb-2 pt-4 sm:px-5">
            <CardHeader id="home-dropshipping" title="Dropshipping" description="Votre catalogue, vos commandes et vos factures restent au même endroit." />
          </div>
          <div className={cx("divide-y border-t", HAIRLINE, "divide-[#EEF0EE] dark:divide-slate-800")}>
            <Shortcut href="/partners/dropshipping" icon={<ChartIcon size={18} />} title="Tableau dropshipping" text="Import du catalogue, enrichissement, ventes" />
            <Shortcut href="/partners/orders" icon={<BoxIcon size={18} />} title="Commandes" text="Commandes à traiter et expéditions" />
            <Shortcut href="/partners/invoices" icon={<ReceiptIcon size={18} />} title="Factures" text="Factures de votre activité dropshipping" />
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * Accueil. With the stock module: the home of the stock in deposit. Without it
 * (MODULE_DISABLED): the dropshipping dashboard, exactly as before.
 */
export default function PartnerHomePage() {
  const { moduleState, summary, summaryError, refreshSummary } = usePartnerPortal();

  if (moduleState === "loading") return <PageSkeleton />;
  if (moduleState === "disabled") return <DropshippingDashboard />;
  if (moduleState === "enabled" && summary) return <StockHome summary={summary} />;

  // The stock service did not answer: say so, and keep the existing dashboard usable.
  return (
    <div className="space-y-8">
      <Notice
        tone="error"
        title="Impossible d'afficher votre stock en dépôt pour le moment"
        action={
          <Button size="sm" onClick={refreshSummary}>
            Réessayer
          </Button>
        }
      >
        {summaryError?.message ?? "Le service ne répond pas. Réessayez dans un instant."}
      </Notice>
      <DropshippingDashboard />
    </div>
  );
}
