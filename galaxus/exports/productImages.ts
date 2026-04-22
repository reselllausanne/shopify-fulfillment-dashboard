import { normalizeDecathlonImageUrl } from "@/decathlon/exports/imageUrl";

function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function urlFromImageEntry(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t && isAbsoluteUrl(t) ? t : null;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of ["url", "src", "href", "imageUrl", "image"]) {
      const u = o[k];
      if (typeof u === "string" && isAbsoluteUrl(u.trim())) return u.trim();
    }
  }
  return null;
}

/**
 * Normalize `SupplierVariant.images` (Json) into absolute image URLs.
 * Mirrors `galaxus/jobs/imageSync.ts` so export picks match sync source order.
 */
function extractAbsoluteImages(images: unknown): string[] {
  let current: unknown = images;
  if (typeof current === "string") {
    const s = current.trim();
    if (!s) return [];
    try {
      current = JSON.parse(s);
    } catch {
      return isAbsoluteUrl(s) ? [s] : [];
    }
  }
  if (!Array.isArray(current)) return [];
  const out: string[] = [];
  for (const el of current) {
    const direct = urlFromImageEntry(el);
    if (direct) {
      out.push(direct);
      continue;
    }
    if (Array.isArray(el) && el.length > 0) {
      const nested = urlFromImageEntry(el[0]);
      if (nested) out.push(nested);
    }
  }
  return out;
}

function pushUnique(ordered: string[], seen: Set<string>, url: string | null | undefined) {
  const t = typeof url === "string" ? url.trim() : "";
  if (!t || !isAbsoluteUrl(t) || seen.has(t)) return;
  seen.add(t);
  ordered.push(t);
}

/** Supplier `images` first (same as image sync), then source, then hosted — score breaks ties (e.g. JPG in JSON vs AVIF hosted). */
function collectVariantImageUrls(variant: {
  images?: unknown;
  sourceImageUrl?: string | null;
  hostedImageUrl?: string | null;
}): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const u of extractAbsoluteImages(variant?.images)) {
    pushUnique(ordered, seen, u);
  }
  pushUnique(ordered, seen, variant?.sourceImageUrl);
  pushUnique(ordered, seen, variant?.hostedImageUrl);
  return ordered;
}

/** Higher = better for Galaxus (raster JPEG/PNG paths, avoid AVIF/WebP file extension and query format). */
export function scoreGalaxusImageUrl(url: string): number {
  let s = 0;
  let pathname = "";
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    pathname = url.toLowerCase().split("?")[0] ?? "";
  }
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) s += 200;
  else if (pathname.includes(".jpg") || pathname.includes(".jpeg")) s += 120;
  if (pathname.endsWith(".png")) s += 150;
  if (pathname.endsWith(".webp")) s -= 100;
  if (pathname.endsWith(".avif")) s -= 100;
  if (pathname.endsWith(".gif")) s -= 80;
  try {
    const u = new URL(url);
    const fm = (u.searchParams.get("fm") || "").toLowerCase();
    if (fm === "webp" || fm === "avif") s -= 60;
    if (fm === "jpg" || fm === "jpeg" || fm === "pjpeg") s += 40;
    const fmt = (u.searchParams.get("format") || "").toLowerCase();
    if (fmt === "webp" || fmt === "avif") s -= 60;
  } catch {
    /* ignore */
  }
  return s;
}

/** Best first, up to 9 (MainImage + ImageUrl_1..8). Query-normalized for CDNs that serve WebP via `fm=`. */
export function pickGalaxusProductImageList(variant: {
  images?: unknown;
  sourceImageUrl?: string | null;
  hostedImageUrl?: string | null;
}): string[] {
  const raw = collectVariantImageUrls(variant);
  if (raw.length === 0) return [];
  const indexed = raw.map((url, idx) => ({ url, idx, score: scoreGalaxusImageUrl(url) }));
  indexed.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const normalized = indexed.map((x) => normalizeDecathlonImageUrl(x.url));
  const out: string[] = [];
  const seenN = new Set<string>();
  for (const n of normalized) {
    if (!n || seenN.has(n)) continue;
    seenN.add(n);
    out.push(n);
    if (out.length >= 9) break;
  }
  return out;
}
