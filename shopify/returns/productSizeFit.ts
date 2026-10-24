/** Same metafield the storefront PDP uses — override via RETURNS_SIZE_FIT_METAFIELD=namespace.key */

export type ProductSizeFitCode = "runs_small" | "true_to_size" | "runs_large" | "unknown";

export type ProductSizeFit = {
  code: ProductSizeFitCode;
  /** Short customer-facing line for returns portal */
  shortLabelFr: string;
  shortLabelEn: string;
  shortLabelDe: string;
  rawValue: string | null;
};

export function resolveSizeFitMetafieldSpec(): { namespace: string; key: string } {
  const raw = String(process.env.RETURNS_SIZE_FIT_METAFIELD ?? "custom.size_fit").trim();
  const dot = raw.indexOf(".");
  if (dot <= 0) return { namespace: "custom", key: raw || "size_fit" };
  return {
    namespace: raw.slice(0, dot).trim() || "custom",
    key: raw.slice(dot + 1).trim() || "size_fit",
  };
}

function normalizeToken(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function parseProductSizeFit(raw: string | null | undefined): ProductSizeFit | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const t = normalizeToken(trimmed);

  if (
    /runs_small|run_small|size_small|taille_petit|taille petit|petit|small|narrow|coupe_etroite/.test(
      t
    )
  ) {
    return {
      code: "runs_small",
      shortLabelFr: "Taille petit — prenez plutôt une demi-pointure au-dessus.",
      shortLabelEn: "Runs small — consider going half a size up.",
      shortLabelDe: "Faellt klein aus — eher eine halbe Groesse groesser waehlen.",
      rawValue: trimmed,
    };
  }
  if (/runs_large|run_large|size_large|taille_grand|taille grand|grand|large|wide/.test(t)) {
    return {
      code: "runs_large",
      shortLabelFr: "Taille grand — une demi-pointure en dessous peut suffire.",
      shortLabelEn: "Runs large — you may go half a size down.",
      shortLabelDe: "Faellt gross aus — evtl. eine halbe Groesse kleiner.",
      rawValue: trimmed,
    };
  }
  if (
    /true_to_size|taille_normale|taille normalement|taille_normalement|normal|true|tts|fidèle|fidele/.test(
      t
    )
  ) {
    return {
      code: "true_to_size",
      shortLabelFr: "Ce modèle taille normalement.",
      shortLabelEn: "True to size.",
      shortLabelDe: "Normalerweise true to size.",
      rawValue: trimmed,
    };
  }

  return {
    code: "unknown",
    shortLabelFr: trimmed,
    shortLabelEn: trimmed,
    shortLabelDe: trimmed,
    rawValue: trimmed,
  };
}

/** Prefer storefront copy when the metafield already holds a full sentence. */
export function customerSizeFitLine(fit: ProductSizeFit, locale: "fr" | "en" | "de"): string {
  const raw = String(fit.rawValue ?? "").trim();
  if (raw.length >= 12 || /modèle|modele|model/i.test(raw)) {
    return raw;
  }
  if (locale === "en") return fit.shortLabelEn;
  if (locale === "de") return fit.shortLabelDe;
  return fit.shortLabelFr;
}
