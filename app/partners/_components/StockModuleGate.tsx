"use client";

import type { ReactNode } from "react";
import { usePartnerPortal } from "../_lib/portal";
import { Button, ButtonLink } from "./Button";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { BoxIcon } from "./icons";
import { Notice } from "./Notice";
import { PageSkeleton } from "./Skeleton";

/**
 * Renders a stock screen only when the stock module is enabled for the signed-in partner.
 * Nothing is requested from the stock API before that is known.
 */
export function StockModuleGate({ children }: { children: ReactNode }) {
  const { moduleState, summaryError, refreshSummary } = usePartnerPortal();

  if (moduleState === "loading") return <PageSkeleton />;

  if (moduleState === "disabled") {
    return (
      <Card>
        <EmptyState
          icon={<BoxIcon size={22} />}
          title="Le stock en dépôt n'est pas activé pour votre compte"
          action={
            <ButtonLink href="/partners/dashboard" variant="primary">
              Retour à l'accueil
            </ButtonLink>
          }
        >
          Cette rubrique concerne les paires confiées à notre entrepôt. Votre activité dropshipping reste disponible depuis le menu.
        </EmptyState>
      </Card>
    );
  }

  if (moduleState === "error") {
    return (
      <Notice
        tone="error"
        title="Impossible d'afficher votre stock pour le moment"
        action={
          <Button size="sm" onClick={refreshSummary}>
            Réessayer
          </Button>
        }
      >
        {summaryError?.message ?? "Le service ne répond pas. Réessayez dans un instant."}
      </Notice>
    );
  }

  return <>{children}</>;
}
