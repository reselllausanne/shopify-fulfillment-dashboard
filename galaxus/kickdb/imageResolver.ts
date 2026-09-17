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
 * - Unknown size is NOT valid until probed (async verify).
 * - Never invent an image — return null when nothing is compliant.
 * - Callers must NOT overwrite an existing good Shopify hero with null.
 */

import { upgradeGalaxusImageResolution } from "@/galaxus/exports/productImages";
import { probeImageDimensions } from "@/galaxus/kickdb/imageDimensionProbe";

/** Google Shopping ads reject images under 250×250; we gate at 500×500. */
export const KICKDB_GOOGLE_MIN_PX = 500;

export type KickdbImageRejectReason =
  | "ok"
  | "no_candidates"
  | "no_compliant_after_filter"
  | "IMAGE_DIMENSIONS_UNVERIFIED";

export type KickdbImageResolveResult = {
  url: string | null;
  /** Raw candidates before upgrade/filter (absolute http(s) only). */
  candidates: string[];
  /** Candidates after imgix upgrade. */
  upgraded: string[];
  /** True when at least one original URL looked like a thumbnail. */
  thumbnailDetected: boolean;
  /** Why url is null when no compliant image exists. */
  reason: KickdbImageRejectReason;
  /** Declared long-edge for the chosen URL (null if unknown / rejected). */
  declaredLongEdge: number | null;
  /** Probed long-edge when async verify ran. */
  verifiedLongEdge: number | null;
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
 * Unknown size → false (unknown is handled separately as unverified).
 */
export function isKickdbThumbnailUrl(url: string, minPx = KICKDB_GOOGLE_MIN_PX): boolean {
  const lower = url.toLowerCase();
  if (lower.includes("thumbnail") || lower.includes("/thumb/") || lower.includes("_thumb.")) {
    return true;
  }
  if (
    lower.includes("product-placeholder") ||
    lower.includes("placeholder-default") ||
    lower.includes("/placeholder.")
  ) {
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
 * Sync compliance: declared long-edge ≥ minPx after upgrade.
 * Unknown size → NOT compliant (must probe via verifyKickdbImageUrl).
 */
export function isGoogleCompliantKickdbUrl(url: string, minPx = KICKDB_GOOGLE_MIN_PX): boolean {
  if (!normalizeUrl(url)) return false;
  if (isKickdbThumbnailUrl(url, minPx)) return false;
  const edge = declaredLongEdgePx(url);
  if (edge === null) return false;
  return edge >= minPx;
}

export function isKickdbImageSizeUnknown(url: string): boolean {
  return normalizeUrl(url) != null && declaredLongEdgePx(url) === null && !isKickdbThumbnailUrl(url);
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
  const area = declaredPixelArea(url);
  const edge = declaredLongEdgePx(url);
  let score = area > 0 ? area : 0;
  if (edge !== null && edge >= KICKDB_GOOGLE_MIN_PX) score += 1_000_000;
  else if (edge === null) score += 10_000; // unknown ranked below declared HD, above thumbs
  const path = url.toLowerCase();
  if (path.includes("product") || path.includes("-product.")) score += 50_000;
  if (isKickdbThumbnailUrl(url)) score -= 5_000_000;
  return score;
}

function emptyResult(
  reason: KickdbImageRejectReason,
  partial?: Partial<KickdbImageResolveResult>
): KickdbImageResolveResult {
  return {
    url: null,
    candidates: [],
    upgraded: [],
    thumbnailDetected: false,
    reason,
    declaredLongEdge: null,
    verifiedLongEdge: null,
    ...partial,
  };
}

/**
 * Sync resolve: only returns URLs with declared long-edge ≥ minPx after upgrade.
 * Unknown-size URLs are refused (IMAGE_DIMENSIONS_UNVERIFIED) — use
 * resolveCanonicalKickdbImageVerified for probe-backed selection.
 */
export function resolveCanonicalKickdbImage(
  productRecord: unknown,
  options?: { minPx?: number; logContext?: Record<string, unknown> }
): KickdbImageResolveResult {
  const minPx = options?.minPx ?? KICKDB_GOOGLE_MIN_PX;
  const candidates = collectKickdbImageCandidates(productRecord);
  if (candidates.length === 0) {
    const result = emptyResult("no_candidates", { candidates });
    logMissingCompliant(result, options?.logContext);
    return result;
  }

  const thumbnailDetected = candidates.some((url) => isKickdbThumbnailUrl(url, minPx));
  const ranked = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  const upgraded = ranked.map(upgradeKickdbImageUrl);
  const compliant = upgraded.filter((url) => isGoogleCompliantKickdbUrl(url, minPx));

  if (compliant.length === 0) {
    const hasUnknown = upgraded.some((url) => isKickdbImageSizeUnknown(url));
    const reason: KickdbImageRejectReason = hasUnknown
      ? "IMAGE_DIMENSIONS_UNVERIFIED"
      : "no_compliant_after_filter";
    const result = emptyResult(reason, {
      candidates,
      upgraded,
      thumbnailDetected,
    });
    logMissingCompliant(result, options?.logContext);
    return result;
  }

  const url = compliant[0]!;
  return {
    url,
    candidates,
    upgraded,
    thumbnailDetected,
    reason: "ok",
    declaredLongEdge: declaredLongEdgePx(url),
    verifiedLongEdge: null,
  };
}

/**
 * Async resolve with bounded probe for unknown-size URLs.
 * Declared HD wins first; unknowns are probed one-by-one until a ≥minPx hit.
 * Workers should prefer sync resolve; scripts/backfill use this before upload.
 */
export async function resolveCanonicalKickdbImageVerified(
  productRecord: unknown,
  options?: { minPx?: number; logContext?: Record<string, unknown>; maxProbes?: number }
): Promise<KickdbImageResolveResult> {
  const minPx = options?.minPx ?? KICKDB_GOOGLE_MIN_PX;
  const maxProbes = options?.maxProbes ?? 3;
  const sync = resolveCanonicalKickdbImage(productRecord, {
    minPx,
    logContext: options?.logContext,
  });
  if (sync.url) return sync;

  const candidates = sync.candidates.length
    ? sync.candidates
    : collectKickdbImageCandidates(productRecord);
  if (candidates.length === 0) return sync;

  const thumbnailDetected =
    sync.thumbnailDetected || candidates.some((url) => isKickdbThumbnailUrl(url, minPx));
  const ranked = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  const upgraded = ranked.map(upgradeKickdbImageUrl);
  let probes = 0;
  let sawUnverified = false;

  for (const url of upgraded) {
    if (isGoogleCompliantKickdbUrl(url, minPx)) {
      return {
        url,
        candidates,
        upgraded,
        thumbnailDetected,
        reason: "ok",
        declaredLongEdge: declaredLongEdgePx(url),
        verifiedLongEdge: null,
      };
    }
    if (!isKickdbImageSizeUnknown(url)) continue;
    if (probes >= maxProbes) {
      sawUnverified = true;
      break;
    }
    probes += 1;
    const probed = await probeImageDimensions(url, { minPx });
    if (probed.ok && probed.longEdge != null) {
      return {
        url,
        candidates,
        upgraded,
        thumbnailDetected,
        reason: "ok",
        declaredLongEdge: null,
        verifiedLongEdge: probed.longEdge,
      };
    }
    if (
      probed.reason === "IMAGE_DIMENSIONS_UNVERIFIED" ||
      probed.reason === "timeout" ||
      probed.reason === "download_failed"
    ) {
      sawUnverified = true;
    }
  }

  const reason: KickdbImageRejectReason = sawUnverified
    ? "IMAGE_DIMENSIONS_UNVERIFIED"
    : "no_compliant_after_filter";
  const result = emptyResult(reason, { candidates, upgraded, thumbnailDetected });
  logMissingCompliant(result, options?.logContext);
  return result;
}

/** Ordered list of declared-compliant image URLs (hero first). Unknown sizes excluded. */
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
 * Pick best declared-compliant URL from SupplierVariant.images.
 * Unknown sizes are skipped (not probed) — safe for image sync workers.
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

/**
 * Verify a single candidate URL is upload-safe (≥ minPx declared or probed).
 */
export async function verifyKickdbImageUrl(
  url: string,
  options?: { minPx?: number }
): Promise<{
  url: string;
  ok: boolean;
  longEdge: number | null;
  source: "declared" | "probed" | "none";
  reason: string;
}> {
  const minPx = options?.minPx ?? KICKDB_GOOGLE_MIN_PX;
  const upgraded = upgradeKickdbImageUrl(url);
  const declared = declaredLongEdgePx(upgraded);
  if (declared != null) {
    const ok = declared >= minPx && !isKickdbThumbnailUrl(upgraded, minPx);
    return {
      url: upgraded,
      ok,
      longEdge: declared,
      source: "declared",
      reason: ok ? "declared_ok" : "declared_too_small",
    };
  }
  const probed = await probeImageDimensions(upgraded, { minPx });
  return {
    url: upgraded,
    ok: probed.ok,
    longEdge: probed.longEdge,
    source: probed.source === "probed" ? "probed" : "none",
    reason: probed.reason,
  };
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
