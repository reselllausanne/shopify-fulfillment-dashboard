/**
 * Canonical KicksDB / StockX image resolver.
 *
 * Single source of truth for every path that writes product images
 * (import, enrich, STX sync, image host, Shopify create/update).
 *
 * Rules:
 * - Prefer normal / high-res StockX-imgix URLs over API thumbnails.
 * - Explicitly reject declared thumbnails that cannot be upgraded.
 * - Upgrade imgix `w`/`h` so delivered pixels meet Google Merchant mins.
 * - Never invent an image — return null when nothing is compliant.
 * - Callers must NOT overwrite an existing good Shopify hero with null.
 */

import { upgradeGalaxusImageResolution } from "@/galaxus/exports/productImages";

/** Google Shopping ads reject images under 250×250; we gate at 500×500. */
export const KICKDB_GOOGLE_MIN_PX = 500;

export type KickdbImageResolveResult = {
  url: string | null;
  /** Raw candidates before upgrade/filter (absolute http(s) only). */
  candidates: string[];
  /** Candidates after imgix upgrade. */
  upgraded: string[];
  /** True when at least one original URL looked like a thumbnail. */
  thumbnailDetected: boolean;
  /** Why url is null when no compliant image exists. */
  reason: "ok" | "no_candidates" | "no_compliant_after_filter";
};

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !isAbsoluteHttpUrl(trimmed)) return null;
  return trimmed;
}

function urlFromEntry(value: unknown): string | null {
  const direct = normalizeUrl(value);
  if (direct) return direct;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const key of ["url", "src", "href", "imageUrl", "image"]) {
      const found = normalizeUrl(o[key]);
      if (found) return found;
    }
  }
  return null;
}

function pushUnique(out: string[], seen: Set<string>, url: string | null) {
  if (!url || seen.has(url)) return;
  seen.add(url);
  out.push(url);
}

/**
 * Declared long-edge pixels from imgix-style query params (includes dpr).
 * Returns null when size is unknown.
 */
export function declaredLongEdgePx(url: string): number | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const width = Number.parseInt(parsed.searchParams.get("w") ?? parsed.searchParams.get("width") ?? "", 10);
  const height = Number.parseInt(parsed.searchParams.get("h") ?? parsed.searchParams.get("height") ?? "", 10);
  const dprRaw = Number.parseFloat(parsed.searchParams.get("dpr") ?? "1");
  const dpr = Number.isFinite(dprRaw) && dprRaw > 0 ? dprRaw : 1;
  const edges: number[] = [];
  if (Number.isFinite(width) && width > 0) edges.push(width * dpr);
  if (Number.isFinite(height) && height > 0) edges.push(height * dpr);
  if (edges.length === 0) return null;
  return Math.max(...edges);
}

export function declaredPixelArea(url: string): number {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 0;
  }
  const width = Number.parseInt(parsed.searchParams.get("w") ?? parsed.searchParams.get("width") ?? "", 10);
  const height = Number.parseInt(parsed.searchParams.get("h") ?? parsed.searchParams.get("height") ?? "", 10);
  const dprRaw = Number.parseFloat(parsed.searchParams.get("dpr") ?? "1");
  const dpr = Number.isFinite(dprRaw) && dprRaw > 0 ? dprRaw : 1;
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) return 0;
  return Math.round(width * dpr) * Math.round(height * dpr);
}

/**
 * True when URL declares a size below Google min (classic StockX thumb w=140&h=100).
 * Unknown size → false (do not reject).
 */
export function isKickdbThumbnailUrl(url: string, minPx = KICKDB_GOOGLE_MIN_PX): boolean {
  const lower = url.toLowerCase();
  if (lower.includes("thumbnail") || lower.includes("/thumb/") || lower.includes("_thumb.")) {
    return true;
  }
  const edge = declaredLongEdgePx(url);
  if (edge === null) return false;
  return edge < minPx;
}

/** Upgrade StockX/GOAT imgix params; identity for other hosts. */
export function upgradeKickdbImageUrl(url: string): string {
  return upgradeGalaxusImageResolution(url.trim());
}

/**
 * After upgrade, URL must either declare long-edge ≥ minPx or have unknown size
 * (full-asset CDN URLs without w/h). Still-small after upgrade → reject.
 */
export function isGoogleCompliantKickdbUrl(url: string, minPx = KICKDB_GOOGLE_MIN_PX): boolean {
  if (!normalizeUrl(url)) return false;
  if (isKickdbThumbnailUrl(url, minPx)) return false;
  const edge = declaredLongEdgePx(url);
  if (edge === null) return true;
  return edge >= minPx;
}

/** Collect absolute image URLs from a raw KicksDB / StockX product payload. */
export function collectKickdbImageCandidates(productRecord: unknown): string[] {
  if (!productRecord || typeof productRecord !== "object") return [];
  const record = productRecord as Record<string, unknown>;
  const out: string[] = [];
  const seen = new Set<string>();

  pushUnique(out, seen, normalizeUrl(record.image));
  pushUnique(out, seen, normalizeUrl(record.image_url));
  pushUnique(out, seen, normalizeUrl(record.imageUrl));

  const media = record.media;
  if (media && typeof media === "object") {
    const m = media as Record<string, unknown>;
    pushUnique(out, seen, normalizeUrl(m.image));
    pushUnique(out, seen, normalizeUrl(m.imageUrl));
  }

  for (const key of ["gallery", "gallery_360", "images"] as const) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      pushUnique(out, seen, urlFromEntry(item));
    }
  }

  return out;
}

function scoreCandidate(url: string): number {
  // Prefer originally-large / product shots; unknown size ranks mid.
  const area = declaredPixelArea(url);
  const edge = declaredLongEdgePx(url);
  let score = area > 0 ? area : 500_000;
  if (edge !== null && edge >= KICKDB_GOOGLE_MIN_PX) score += 1_000_000;
  const path = url.toLowerCase();
  if (path.includes("product") || path.includes("-product.")) score += 50_000;
  if (isKickdbThumbnailUrl(url)) score -= 5_000_000;
  return score;
}

/**
 * Resolve the single canonical hero image for a KicksDB product payload.
 * Always upgrades imgix thumbnails when possible; never returns a sub-min URL.
 */
export function resolveCanonicalKickdbImage(
  productRecord: unknown,
  options?: { minPx?: number; logContext?: Record<string, unknown> }
): KickdbImageResolveResult {
  const minPx = options?.minPx ?? KICKDB_GOOGLE_MIN_PX;
  const candidates = collectKickdbImageCandidates(productRecord);
  if (candidates.length === 0) {
    const result: KickdbImageResolveResult = {
      url: null,
      candidates,
      upgraded: [],
      thumbnailDetected: false,
      reason: "no_candidates",
    };
    logMissingCompliant(result, options?.logContext);
    return result;
  }

  const thumbnailDetected = candidates.some((url) => isKickdbThumbnailUrl(url, minPx));
  const ranked = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  const upgraded = ranked.map(upgradeKickdbImageUrl);
  const compliant = upgraded.filter((url) => isGoogleCompliantKickdbUrl(url, minPx));

  if (compliant.length === 0) {
    const result: KickdbImageResolveResult = {
      url: null,
      candidates,
      upgraded,
      thumbnailDetected,
      reason: "no_compliant_after_filter",
    };
    logMissingCompliant(result, options?.logContext);
    return result;
  }

  return {
    url: compliant[0]!,
    candidates,
    upgraded,
    thumbnailDetected,
    reason: "ok",
  };
}

/** Ordered list of compliant image URLs (hero first), deduped after upgrade. */
export function resolveCanonicalKickdbImageList(
  productRecord: unknown,
  options?: { minPx?: number; max?: number; logContext?: Record<string, unknown> }
): string[] {
  const minPx = options?.minPx ?? KICKDB_GOOGLE_MIN_PX;
  const max = options?.max ?? 9;
  const resolved = resolveCanonicalKickdbImage(productRecord, {
    minPx,
    logContext: options?.logContext,
  });
  if (!resolved.url) return [];

  const ranked = [...resolved.candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ranked) {
    const upgraded = upgradeKickdbImageUrl(raw);
    if (!isGoogleCompliantKickdbUrl(upgraded, minPx)) continue;
    if (seen.has(upgraded)) continue;
    seen.add(upgraded);
    out.push(upgraded);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Pick best compliant URL from an already-stored images JSON / string list
 * (SupplierVariant.images). Used by image sync so stock/price paths never
 * rehost a thumbnail as sourceImageUrl.
 */
export function resolveCanonicalKickdbImageFromList(
  images: unknown,
  options?: { minPx?: number; fallbackUrl?: string | null }
): string | null {
  const minPx = options?.minPx ?? KICKDB_GOOGLE_MIN_PX;
  const candidates: string[] = [];
  const seen = new Set<string>();

  let current: unknown = images;
  if (typeof current === "string") {
    const trimmed = current.trim();
    if (trimmed) {
      try {
        current = JSON.parse(trimmed);
      } catch {
        pushUnique(candidates, seen, normalizeUrl(trimmed));
        current = null;
      }
    }
  }
  if (Array.isArray(current)) {
    for (const item of current) {
      pushUnique(candidates, seen, urlFromEntry(item));
    }
  }
  pushUnique(candidates, seen, normalizeUrl(options?.fallbackUrl ?? null));

  if (candidates.length === 0) return null;

  const ranked = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  for (const raw of ranked) {
    const upgraded = upgradeKickdbImageUrl(raw);
    if (isGoogleCompliantKickdbUrl(upgraded, minPx)) return upgraded;
  }
  return null;
}

function logMissingCompliant(
  result: KickdbImageResolveResult,
  logContext?: Record<string, unknown>
) {
  if (result.reason === "ok") return;
  console.warn(
    JSON.stringify({
      event: "kickdb.image.no_compliant",
      reason: result.reason,
      thumbnailDetected: result.thumbnailDetected,
      candidateCount: result.candidates.length,
      sample: result.candidates.slice(0, 3),
      ...logContext,
    })
  );
}
