import type { IdentityMatchLevel, VariantObservation } from "./types";

const POKEMON_BOOSTER_RE =
  /\b(booster\s*pack|booster\s*single|single\s*booster|1er\s*booster|booster\s*carte)\b/i;
const POKEMON_DISPLAY_RE =
  /\b(booster\s*display|display\s*box|booster\s*box|36\s*booster|18\s*booster|etb|elite\s*trainer)\b/i;

const PACK_QTY_RE =
  /\b(\d{1,3})\s*(st[üu]ck|pcs|pieces?|er[- ]?pack|pack|ve|x)\b|\bpack\s*(?:of\s*)?(\d{1,3})\b|\b(\d{1,3})\s*x\s*\d+\b/i;

export function resolveIdentityMatchLevel(input: {
  gtin?: string | null;
  manufacturerRef?: string | null;
  supplierSku?: string | null;
  productUrl?: string | null;
  productName?: string | null;
  dbGtin?: string | null;
  dbMpn?: string | null;
  dbSku?: string | null;
  dbUrl?: string | null;
  dbTitle?: string | null;
}): IdentityMatchLevel {
  const norm = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase();

  if (input.gtin && input.dbGtin && norm(input.gtin) === norm(input.dbGtin)) return "gtin";
  if (input.manufacturerRef && input.dbMpn && norm(input.manufacturerRef) === norm(input.dbMpn)) return "mpn";
  if (input.supplierSku && input.dbSku && norm(input.supplierSku) === norm(input.dbSku)) return "sku";
  if (input.productUrl && input.dbUrl && norm(input.productUrl) === norm(input.dbUrl)) return "url";

  const title = norm(input.productName);
  const dbTitle = norm(input.dbTitle);
  if (title && dbTitle && (title === dbTitle || title.includes(dbTitle) || dbTitle.includes(title))) {
    return "title";
  }

  return "uncertain";
}

export function identityConfidenceScore(level: IdentityMatchLevel): number {
  switch (level) {
    case "gtin":
      return 1.0;
    case "mpn":
      return 0.92;
    case "sku":
      return 0.85;
    case "url":
      return 0.8;
    case "title":
      return 0.55;
    default:
      return 0.25;
  }
}

/** Booster title vs display classification conflict. */
export function isPokemonBoosterDisplayConflict(input: {
  title?: string | null;
  mappedTitle?: string | null;
  productType?: string | null;
}): boolean {
  const left = `${String(input.title ?? "")} ${String(input.productType ?? "")}`;
  const right = String(input.mappedTitle ?? "");

  const titleBooster = POKEMON_BOOSTER_RE.test(left) && !POKEMON_DISPLAY_RE.test(left);
  const titleDisplay = POKEMON_DISPLAY_RE.test(left);
  const mappedBooster = POKEMON_BOOSTER_RE.test(right) && !POKEMON_DISPLAY_RE.test(right);
  const mappedDisplay = POKEMON_DISPLAY_RE.test(right);

  return (titleBooster && mappedDisplay) || (titleDisplay && mappedBooster);
}

/** qty 1 must never publish 100 — pack inflation guard. */
export function detectPackSizeInflation(input: {
  internalQty: number;
  publishedQty: number;
  title?: string | null;
}): { inflated: boolean; inferredPack?: number } {
  const internal = Math.max(0, Math.floor(Number(input.internalQty) || 0));
  const published = Math.max(0, Math.floor(Number(input.publishedQty) || 0));

  if (internal === 1 && published >= 10) {
    return { inflated: true, inferredPack: published };
  }

  const inferred = inferPackCount(input.title);
  if (internal === 1 && inferred != null && inferred > 1 && published > 1) {
    return { inflated: true, inferredPack: inferred };
  }

  if (published > internal && internal > 0 && published >= internal * 5) {
    return { inflated: true, inferredPack: Math.round(published / internal) };
  }

  return { inflated: false };
}

export function inferPackCount(text?: string | null): number | null {
  const t = String(text ?? "");
  const m = t.match(PACK_QTY_RE);
  if (!m) return null;
  const qty = Number(m[1] || m[3] || m[4] || 0);
  if (!Number.isFinite(qty) || qty <= 1) return null;
  if (qty > 500) return null;
  return qty;
}

export function applyIdentityToObservation(
  obs: VariantObservation,
  db: {
    gtin?: string | null;
    manufacturerRef?: string | null;
    supplierSku?: string | null;
    productUrl?: string | null;
    productName?: string | null;
  }
): VariantObservation {
  const level = resolveIdentityMatchLevel({
    gtin: obs.gtin,
    manufacturerRef: obs.manufacturerRef,
    supplierSku: obs.supplierSku,
    productUrl: obs.productUrl,
    productName: obs.productName,
    dbGtin: db.gtin,
    dbMpn: db.manufacturerRef,
    dbSku: db.supplierSku,
    dbUrl: db.productUrl,
    dbTitle: db.productName,
  });

  const score = identityConfidenceScore(level);
  let availabilityStatus = obs.availabilityStatus;
  if (level === "uncertain" && availabilityStatus === "confirmed_in_stock") {
    availabilityStatus = "variant_uncertain";
  }

  return {
    ...obs,
    identityMatchLevel: level,
    confidenceScore: score,
    availabilityStatus,
  };
}
