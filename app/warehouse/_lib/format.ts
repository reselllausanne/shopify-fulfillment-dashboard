import type { ExceptionType } from "@/lib/warehouse/types";

export type Tone = "green" | "amber" | "red" | "slate" | "blue";

export const EXCEPTION_LABELS: Record<ExceptionType, string> = {
  UNKNOWN_GTIN: "GTIN inconnu",
  AMBIGUOUS_GTIN: "GTIN ambigu",
  UNKNOWN_CODE: "Code inconnu",
  WRONG_CODE_TYPE: "Mauvais type de code",
  SURPLUS: "Excédent",
  MISSING: "Manquant",
  WRONG_VARIANT: "Mauvaise variante",
  OWNER_SUSPECT: "Propriétaire à confirmer",
  DUPLICATE_SCAN: "Double scan",
  DUPLICATE_LABEL: "Étiquette en double",
  LABEL_LOST: "Étiquette perdue",
  LEVEL_FULL: "Niveau plein",
  CAPACITY_MISMATCH: "Capacité dépassée",
  WRONG_LOCATION: "Mauvais emplacement",
  UNIT_NOT_FOUND: "Paire introuvable",
  PRINT_UNCERTAIN: "Impression incertaine",
  RECOVERY_RECONCILE: "Rapprochement après reprise",
  COUNT_MISMATCH: "Écart de comptage",
  OTHER: "Autre",
};

export const exceptionLabel = (type: string): string => (EXCEPTION_LABELS as Record<string, string>)[type] ?? type;

type Labelled = { label: string; tone: Tone };

export const PRESENCE: Record<string, Labelled> = {
  PRESENT: { label: "Présente", tone: "green" },
  IN_TRANSIT: { label: "En transit", tone: "blue" },
  THIRD_PARTY: { label: "Chez un tiers", tone: "blue" },
  MISSING: { label: "Introuvable", tone: "red" },
  OUT: { label: "Sortie", tone: "slate" },
};
export const QC: Record<string, Labelled> = {
  PENDING: { label: "Contrôle à faire", tone: "amber" },
  PASSED: { label: "Contrôle validé", tone: "green" },
  QUARANTINE: { label: "Quarantaine", tone: "red" },
};
export const SALE: Record<string, Labelled> = {
  STORAGE_ONLY: { label: "Stockage seul", tone: "slate" },
  SALE_AUTHORIZED: { label: "Vente autorisée", tone: "green" },
  BLOCKED: { label: "Vente bloquée", tone: "red" },
};
export const CONDITION_LABELS: Record<string, string> = { NEW: "Neuf", USED: "Utilisé", DAMAGED: "Abîmé", UNKNOWN: "Non précisé" };
export const BOX_LABELS: Record<string, string> = { GOOD: "Boîte en bon état", DAMAGED: "Boîte abîmée", MISSING: "Sans boîte", UNKNOWN: "Boîte non précisée" };
export const OUT_REASON_LABELS: Record<string, string> = {
  SOLD: "Vendue",
  WITHDRAWN: "Reprise par le déposant",
  RETURNED_TO_SUPPLIER: "Retour fournisseur",
  DISPOSED: "Détruite",
  OTHER: "Autre",
};
export const LOCATION_KIND_LABELS: Record<string, string> = {
  SECTOR: "Secteur",
  ROW: "Rangée",
  RACK: "Rack",
  LEVEL: "Niveau",
  RECEIVING: "Zone de réception",
  CART: "Chariot",
  PACKING: "Emballage",
  RETURNS: "Retours",
  QUARANTINE: "Quarantaine",
};
export const LOCATION_STATUS: Record<string, Labelled> = {
  ACTIVE: { label: "Actif", tone: "green" },
  BLOCKED: { label: "Bloqué", tone: "amber" },
  RETIRED: { label: "Retiré", tone: "slate" },
};
export const BATCH_KIND_LABELS: Record<string, string> = { STOCK_TAKE: "Reprise de stock", RECEIVING: "Réception" };
export const BATCH_FLOW_LABELS: Record<string, string> = {
  CONSIGNMENT: "Dépôt partenaire",
  OWN_STOCK: "Stock propre",
  SUPPLIER: "Fournisseur",
  ORDER_TRANSIT: "Commande en transit",
  CUSTOMER_RETURN: "Retour client",
};
export const BATCH_STATUS: Record<string, Labelled> = {
  OPEN: { label: "Ouvert", tone: "green" },
  PAUSED: { label: "En pause", tone: "amber" },
  CLOSED: { label: "Clos", tone: "slate" },
  CANCELLED: { label: "Annulé", tone: "slate" },
};
export const PRINT_STATUS: Record<string, Labelled> = {
  QUEUED: { label: "En attente", tone: "amber" },
  CLAIMED: { label: "En cours", tone: "blue" },
  SENT: { label: "Envoyée", tone: "green" },
  CONFIRMED: { label: "Confirmée", tone: "green" },
  FAILED: { label: "Échec", tone: "red" },
  UNCERTAIN: { label: "Incertaine", tone: "amber" },
  CANCELLED: { label: "Annulée", tone: "slate" },
};
export const PRICE_STATUS: Record<string, Labelled> = {
  PROPOSED: { label: "À valider", tone: "amber" },
  VALIDATED: { label: "Validé", tone: "green" },
  REJECTED: { label: "Refusé", tone: "red" },
  SUPERSEDED: { label: "Remplacé", tone: "slate" },
};
export const MOVEMENT_LABELS: Record<string, string> = {
  RECEIVE: "Réception",
  STOCK_TAKE: "Reprise de stock",
  PUTAWAY: "Rangement",
  RELOCATE: "Déplacement",
  TRANSFER_OUT: "Départ en transfert",
  TRANSFER_IN: "Arrivée de transfert",
  MARK_MISSING: "Déclarée introuvable",
  FOUND: "Retrouvée",
  QC: "Contrôle",
  SALE_STATE: "Droit de vente",
  OWNER_CHANGE: "Changement de propriétaire",
  ITEM_CORRECTION: "Correction de variante",
  CONDITION: "État",
  LABEL_PRINT: "Étiquette imprimée",
  LABEL_REPRINT: "Étiquette réimprimée",
  LABEL_VERIFIED: "Étiquette vérifiée",
  ALLOCATE: "Réservée pour une vente",
  RELEASE: "Réservation libérée",
  OUT: "Sortie de stock",
  CORRECTION: "Correction",
  RECOVERED: "Récupérée",
};
export const LABEL_KIND_LABELS: Record<string, string> = { PAIR: "Paire", LOCATION: "Emplacement", TEST: "Test", PARCEL: "Colis", SHIPPING: "Expédition", RETURN: "Retour" };

export function ownerLabel(ownerKind: string, ownerName: string | null | undefined): string {
  if (ownerKind === "OWN") return "Resell Lausanne";
  if (ownerKind === "PARTNER") return ownerName || "Partenaire";
  return "Propriétaire inconnu";
}
export function ownerTone(ownerKind: string): Tone {
  return ownerKind === "UNKNOWN" ? "red" : ownerKind === "PARTNER" ? "blue" : "slate";
}

/**
 * Dates are shown in the time zone of the site being worked on, not of the browser: a screen
 * opened from another country must show the warehouse's day and hour (C34).
 */
function makeFormats(timeZone: string | undefined) {
  return {
    dateTime: new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone }),
    dateOnly: new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone }),
    timeOnly: new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone }),
  };
}
let displayTimeZone = "Europe/Zurich";
let formats = makeFormats(displayTimeZone);
export function setDisplayTimeZone(timeZone: string | null | undefined): void {
  const next = timeZone || "Europe/Zurich";
  if (next === displayTimeZone) return;
  try {
    formats = makeFormats(next);
    displayTimeZone = next;
  } catch {
    // Unknown zone name: keep the previous one rather than break every date on screen.
  }
}
export function getDisplayTimeZone(): string {
  return displayTimeZone;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : formats.dateTime.format(d);
}
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : formats.dateOnly.format(d);
}
export function fmtTime(date: Date | number): string {
  return formats.timeOnly.format(date);
}

/** "il y a 12 min", "il y a 3 h", "il y a 2 j". */
export function fmtAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

export function fmtMoney(value: string | number | null | undefined, currency: string | null | undefined = "CHF"): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  // Swiss money notation: decimal point, apostrophe for thousands (CHF 1'234.50).
  const amount = n.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "" ? amount : `${currency ?? "CHF"} ${amount}`;
}

export function fmtPercent(rate: string | number | null | undefined): string {
  if (rate === null || rate === undefined || rate === "") return "—";
  const n = Number(rate);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toLocaleString("fr-CH", { maximumFractionDigits: 2 })} %`;
}

export function shortRefOf(unitId: string): string {
  const hex = unitId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

export function itemTitle(brand: string | null | undefined, name: string | null | undefined): string {
  const n = (name ?? "").trim();
  const b = (brand ?? "").trim();
  if (!b) return n || "Variante sans nom";
  return n.toLowerCase().startsWith(b.toLowerCase()) ? n : `${b} ${n}`.trim();
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("fr-CH")} ${n > 1 ? many : one}`;
}

/** "0.7000" → "0.7" (database numerics come back padded). */
export function fmtFactor(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "?";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : String(value);
}
