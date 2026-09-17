/**
 * Bounded image dimension probe for KicksDB / StockX URLs.
 *
 * Sync paths must NOT call this in hot loops without a cache hit.
 * Prefer declared imgix w/h; probe only when size is unknown.
 */

import sharp from "sharp";

export const IMAGE_PROBE_TIMEOUT_MS = 4_000;
export const IMAGE_PROBE_MAX_BYTES = 2_000_000;
export const IMAGE_PROBE_CACHE_MAX = 512;

export type ImageDimensionSource = "declared" | "probed" | "none";

export type ImageDimensionResult = {
  url: string;
  width: number | null;
  height: number | null;
  longEdge: number | null;
  source: ImageDimensionSource;
  ok: boolean;
  reason:
    | "declared_ok"
    | "probed_ok"
    | "declared_too_small"
    | "probed_too_small"
    | "IMAGE_DIMENSIONS_UNVERIFIED"
    | "download_failed"
    | "timeout"
    | "too_large"
    | "not_an_image"
    | "invalid_url";
};

type CacheEntry = ImageDimensionResult & { at: number };

const cache = new Map<string, CacheEntry>();

export function clearImageDimensionCache(): void {
  cache.clear();
}

export function getCachedImageDimension(url: string): ImageDimensionResult | null {
  const hit = cache.get(url);
  return hit ? { ...hit } : null;
}

function putCache(result: ImageDimensionResult): ImageDimensionResult {
  if (cache.size >= IMAGE_PROBE_CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(result.url, { ...result, at: Date.now() });
  return result;
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function buildHeaders(sourceUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (compatible; ResellImageProbe/1.0)",
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
  if (sourceUrl.includes("stockx") || sourceUrl.includes("goat.com")) {
    headers.Referer = "https://stockx.com/";
  }
  return headers;
}

async function downloadBounded(
  url: string,
  timeoutMs: number,
  maxBytes: number
): Promise<{ buffer: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: buildHeaders(url),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw Object.assign(new Error(`HTTP ${response.status}`), { code: "download_failed" });
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (contentType && !contentType.startsWith("image/") && contentType !== "application/octet-stream") {
      throw Object.assign(new Error(`not image: ${contentType}`), { code: "not_an_image" });
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw Object.assign(new Error("content-length too large"), { code: "too_large" });
    }
    if (!response.body) {
      const ab = await response.arrayBuffer();
      if (ab.byteLength > maxBytes) {
        throw Object.assign(new Error("body too large"), { code: "too_large" });
      }
      return { buffer: Buffer.from(ab), contentType };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw Object.assign(new Error("body too large"), { code: "too_large" });
      }
      chunks.push(value);
    }
    return { buffer: Buffer.concat(chunks.map((c) => Buffer.from(c))), contentType };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw Object.assign(new Error("timeout"), { code: "timeout" });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe real pixel dimensions. Uses in-memory cache. Bounded timeout + max bytes.
 * Never throws — returns a structured result with reason codes.
 */
export async function probeImageDimensions(
  url: string,
  options?: { timeoutMs?: number; maxBytes?: number; minPx?: number; bypassCache?: boolean }
): Promise<ImageDimensionResult> {
  const trimmed = String(url ?? "").trim();
  const minPx = options?.minPx ?? 500;
  if (!trimmed || !isAbsoluteHttpUrl(trimmed)) {
    return {
      url: trimmed,
      width: null,
      height: null,
      longEdge: null,
      source: "none",
      ok: false,
      reason: "invalid_url",
    };
  }

  if (!options?.bypassCache) {
    const cached = cache.get(trimmed);
    if (cached) return { ...cached };
  }

  try {
    const { buffer } = await downloadBounded(
      trimmed,
      options?.timeoutMs ?? IMAGE_PROBE_TIMEOUT_MS,
      options?.maxBytes ?? IMAGE_PROBE_MAX_BYTES
    );
    const meta = await sharp(buffer, { failOn: "none" }).metadata();
    const width = typeof meta.width === "number" && meta.width > 0 ? meta.width : null;
    const height = typeof meta.height === "number" && meta.height > 0 ? meta.height : null;
    if (width == null || height == null) {
      return putCache({
        url: trimmed,
        width,
        height,
        longEdge: null,
        source: "none",
        ok: false,
        reason: "IMAGE_DIMENSIONS_UNVERIFIED",
      });
    }
    const longEdge = Math.max(width, height);
    const ok = longEdge >= minPx;
    return putCache({
      url: trimmed,
      width,
      height,
      longEdge,
      source: "probed",
      ok,
      reason: ok ? "probed_ok" : "probed_too_small",
    });
  } catch (error: unknown) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    const reason =
      code === "timeout"
        ? "timeout"
        : code === "too_large"
          ? "too_large"
          : code === "not_an_image"
            ? "not_an_image"
            : code === "download_failed"
              ? "download_failed"
              : "IMAGE_DIMENSIONS_UNVERIFIED";
    return putCache({
      url: trimmed,
      width: null,
      height: null,
      longEdge: null,
      source: "none",
      ok: false,
      reason,
    });
  }
}
