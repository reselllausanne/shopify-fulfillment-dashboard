import { formatFrDate } from "@/lib/stockxDelayRebuy/eta";
import type { DelayNarrativeKind, DelayRebuyCase } from "@/lib/stockxDelayRebuy/types";

export type CustomerNarrative = {
  kind: DelayNarrativeKind;
  subject: string;
  /** Short status title. Sits above the ETA band, not inside a paragraph. */
  headline: string;
  /** One sentence under the title. Never the full apology. */
  statusLine: string;
  greeting: string;
  /** Two short paragraphs under the order summary. */
  bodyParagraphs: string[];
  activeStepLabel: string;
  etaLine: string;
  /** Standard or Prioritaire — order-summary row, not prose. */
  shippingLabel: string;
};

/** Client-facing mito — never mention StockX by name. */
export function buildCustomerNarrative(
  c: DelayRebuyCase,
  kind: DelayNarrativeKind
): CustomerNarrative {
  const name = (c.customerFirstName || "").trim();
  const greeting = name ? `Bonjour ${name},` : "Bonjour,";
  const shippingLabel = c.rebuyLane === "EXPRESS" ? "Prioritaire" : "Standard";
  // Delay uses announced ETA (supplier refresh or synthetic); cancel-rebuy always rebuy window.
  const delayEtaRange = `${formatFrDate(c.announceEtaStart)} – ${formatFrDate(c.announceEtaEnd)}`;
  const rebuyEtaRange = `${formatFrDate(c.rebuyEtaStart)} – ${formatFrDate(c.rebuyEtaEnd)}`;

  if (kind === "SUPPLIER_CHANGE_DELAY") {
    return {
      kind,
      subject: `Commande ${c.shopifyOrderName} — délai de livraison mis à jour`,
      headline: "Délai de livraison mis à jour",
      statusLine: "Nouvelle date de livraison confirmée.",
      greeting,
      bodyParagraphs: [
        `Le vendeur initial n'a pas expédié l'article dans le délai prévu. Nous avons passé la commande auprès d'un autre vendeur vérifié, pour la même référence et la même taille.`,
        `Nous sommes désolés pour ce contretemps. Tu n'as rien à faire : un e-mail part automatiquement à la prochaine étape.`,
      ],
      activeStepLabel: "Authentification en cours",
      etaLine: delayEtaRange,
      shippingLabel,
    };
  }

  if (kind === "CANCEL_REBUY_LEGIT") {
    return {
      kind,
      subject: `Commande ${c.shopifyOrderName} — article remplacé`,
      headline: "Article remplacé",
      statusLine: "Même référence recommandée. Nouvelle date ci-dessous.",
      greeting,
      bodyParagraphs: [
        `Lors du contrôle d'authenticité, l'article n'a pas été validé. Nous avons immédiatement commandé le même modèle, même taille, auprès d'un autre vendeur vérifié.`,
        `Nous sommes désolés pour ce contretemps. Ta commande ${c.shopifyOrderName} reste active. Aucune action de ton côté.`,
      ],
      activeStepLabel: "Commande confirmée",
      etaLine: rebuyEtaRange,
      shippingLabel,
    };
  }

  return {
    kind,
    subject: `Commande ${c.shopifyOrderName} — mise à jour importante`,
    headline: "Commande non finalisée",
    statusLine: "Nous te recontactons avec une solution.",
    greeting,
    bodyParagraphs: [
      `Le vendeur n'a pas pu finaliser cette commande. Nous te recontactons très vite avec un nouvel article ou un remboursement.`,
      `Nous sommes désolés pour ce contretemps.`,
    ],
    activeStepLabel: "Commande confirmée",
    etaLine: "À confirmer",
    shippingLabel,
  };
}

export function fmtPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "n/a";
  return `${(pct * 100).toFixed(1)}%`;
}
