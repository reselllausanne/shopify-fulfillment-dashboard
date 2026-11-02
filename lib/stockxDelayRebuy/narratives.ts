import { formatFrDate } from "@/lib/stockxDelayRebuy/eta";
import type { DelayNarrativeKind, DelayRebuyCase } from "@/lib/stockxDelayRebuy/types";

export type CustomerNarrative = {
  kind: DelayNarrativeKind;
  subject: string;
  headline: string;
  bodyParagraphs: string[];
  activeStepLabel: string;
  etaLine: string;
};

/** Client-facing mito — never mention StockX by name. */
export function buildCustomerNarrative(
  c: DelayRebuyCase,
  kind: DelayNarrativeKind
): CustomerNarrative {
  const first = (c.customerFirstName || "").trim() || "Bonjour";
  const laneLabel = c.rebuyLane === "EXPRESS" ? "prioritaire" : "standard";
  // Delay uses announced ETA (StockX refresh or synthetic); cancel-rebuy always rebuy window.
  const delayEtaRange = `${formatFrDate(c.announceEtaStart)} – ${formatFrDate(c.announceEtaEnd)}`;
  const rebuyEtaRange = `${formatFrDate(c.rebuyEtaStart)} – ${formatFrDate(c.rebuyEtaEnd)}`;

  if (kind === "SUPPLIER_CHANGE_DELAY") {
    return {
      kind,
      subject: `Suivi commande ${c.shopifyOrderName} — délai mis à jour`,
      headline: "Délai de livraison mis à jour",
      bodyParagraphs: [
        `${first},`,
        `Le fournisseur initial n'a pas expédié ta paire à temps. On active un autre vendeur vérifié pour la même référence — ça arrive parfois sur les pièces très demandées.`,
        `Ta commande ${c.shopifyOrderName} reste active. Nouvelle arrivée estimée (parcours ${laneLabel}) : ${delayEtaRange}.`,
        `Désolé pour ce contretemps. Tu recevras un e-mail automatique dès la prochaine étape réelle (authentification ou expédition). Pas besoin de nous écrire tant que cette nouvelle date n'est pas dépassée de 48h.`,
      ],
      activeStepLabel: "Authentification en cours",
      etaLine: delayEtaRange,
    };
  }

  if (kind === "CANCEL_REBUY_LEGIT") {
    return {
      kind,
      subject: `Suivi commande ${c.shopifyOrderName} — article recommandé`,
      headline: "Petit souci de contrôle — on a déjà racheté",
      bodyParagraphs: [
        `${first},`,
        `Lors du contrôle d'authenticité, l'article n'a pas passé la validation. On a immédiatement commandé le même modèle auprès d'un autre vendeur vérifié pour ne pas te faire attendre inutilement.`,
        `Désolé pour ce contretemps. Nouvelle arrivée estimée (parcours ${laneLabel}) : ${rebuyEtaRange}.`,
        `Rien à faire de ton côté. On te tient au courant à chaque étape.`,
      ],
      activeStepLabel: "Commande confirmée",
      etaLine: rebuyEtaRange,
    };
  }

  return {
    kind,
    subject: `Suivi commande ${c.shopifyOrderName} — mise à jour importante`,
    headline: "Commande fournisseur annulée",
    bodyParagraphs: [
      `${first},`,
      `Le fournisseur n'a pas pu finaliser cette commande. On te recontacte très vite avec une solution (nouvel article ou remboursement).`,
    ],
    activeStepLabel: "Commande confirmée",
    etaLine: "à confirmer",
  };
}

export function fmtPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "n/a";
  return `${(pct * 100).toFixed(1)}%`;
}
