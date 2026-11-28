/**
 * French wording of the partner portal. Copied here on purpose: client components must never
 * import runtime code from `lib/warehouse` (it pulls the database client).
 */
import type { PartnerRequestStatus, PartnerRequestType, PartnerUnitStatus } from "./api";

export type Tone = "green" | "amber" | "orange" | "blue" | "violet" | "neutral" | "red";

export const UNIT_STATUS: Record<PartnerUnitStatus, { label: string; tone: Tone; explain: string }> = {
  IN_CONTROL: {
    label: "En contrôle",
    tone: "amber",
    explain:
      "Votre paire est bien arrivée chez nous. Nous contrôlons son état et sa conformité avant de la mettre en stock. Elle n'est pas proposée à la vente pendant ce contrôle.",
  },
  STORED: {
    label: "Stocké",
    tone: "neutral",
    explain: "Votre paire a été contrôlée et elle est conservée en stock. Elle n'est pas proposée à la vente pour le moment.",
  },
  SALE_AUTHORIZED: {
    label: "Vente autorisée",
    tone: "green",
    explain:
      "Votre paire a été contrôlée, elle est en stock et sa vente est autorisée. La publication sur les canaux de vente n'est pas encore active pour le stock en dépôt.",
  },
  BLOCKED: {
    label: "Bloqué",
    tone: "orange",
    explain:
      "Cette paire est mise de côté le temps d'une vérification. Elle n'est pas proposée à la vente. Vous pouvez nous écrire ci-dessous pour en savoir plus.",
  },
  IN_TRANSIT: {
    label: "En route",
    tone: "blue",
    explain: "Cette paire est en cours d'acheminement entre deux de nos sites. Elle réapparaîtra en stock dès son arrivée.",
  },
  CHECKING: {
    label: "Vérification en cours",
    tone: "violet",
    explain: "Nous vérifions actuellement où se trouve cette paire. Son statut sera mis à jour dès la fin de la vérification.",
  },
  OUT: {
    label: "Sorti",
    tone: "neutral",
    explain: "Cette paire ne fait plus partie de votre stock en dépôt.",
  },
};

export function unitStatusLabel(status: string): string {
  return UNIT_STATUS[status as PartnerUnitStatus]?.label ?? "Statut à préciser";
}

export const CONDITION_LABELS: Record<string, string> = {
  NEW: "Neuf",
  USED: "Porté",
  DAMAGED: "Abîmé",
  UNKNOWN: "À contrôler",
};

export const BOX_LABELS: Record<string, string> = {
  GOOD: "Bonne",
  DAMAGED: "Abîmée",
  MISSING: "Sans boîte",
  UNKNOWN: "À contrôler",
};

export const REQUEST_TYPE_LABELS: Record<PartnerRequestType, string> = {
  PRICE_CHANGE: "Modification de prix",
  DISCREPANCY: "Écart constaté",
  OTHER: "Autre",
};

export function requestTypeLabel(type: string): string {
  return REQUEST_TYPE_LABELS[type as PartnerRequestType] ?? "Autre";
}

export const REQUEST_STATUS: Record<PartnerRequestStatus, { label: string; tone: Tone }> = {
  OPEN: { label: "Ouverte", tone: "amber" },
  ANSWERED: { label: "Répondue", tone: "green" },
  CLOSED: { label: "Close", tone: "neutral" },
};

export const PRICE_OWNER_SENTENCE = "Les prix sont définis par Resell Lausanne ; vous pouvez demander une modification.";
export const NO_PRICE_LABEL = "Prix à définir";
