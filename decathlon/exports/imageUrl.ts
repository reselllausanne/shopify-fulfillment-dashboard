/**
 * Decathlon / Mirakl product imports often reject URLs that request WebP/AVIF
 * (e.g. StockX `fm=webp`) while the path still says `.jpg`.
 */
export function normalizeDecathlonImageUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  try {
    const u = new URL(trimmed);
    const fm = u.searchParams.get("fm");
    if (fm && /webp|avif/i.test(fm)) {
      u.searchParams.set("fm", "jpg");
    }
    const format = u.searchParams.get("format");
    if (format && /webp|avif/i.test(format)) {
      u.searchParams.set("format", "jpg");
    }
    return u.toString();
  } catch {
    return trimmed
      .replace(/([?&])fm=webp\b/gi, "$1fm=jpg")
      .replace(/([?&])fm=avif\b/gi, "$1fm=jpg")
      .replace(/([?&])format=webp\b/gi, "$1format=jpg")
      .replace(/([?&])format=avif\b/gi, "$1format=jpg");
  }
}
