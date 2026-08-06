/**
 * Google Ads returns product language as a resource name like
 * `languageConstants/1000`. Persist the ISO-ish code instead.
 *
 * Constants observed on Resell Lausanne (CH feed): 1000 / 1001 / 1002.
 * Full Google Ads language constant table is larger; unknown IDs stay as
 * `lang_<id>` so nothing is silently dropped.
 */
const LANGUAGE_CONSTANT_TO_CODE: Record<string, string> = {
  "1000": "en",
  "1001": "de",
  "1002": "fr",
  "1003": "es",
  "1004": "it",
  "1005": "ja",
  "1009": "nl",
  "1010": "pt",
};

export function normalizeLanguageCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Already a short code.
  if (/^[a-z]{2}(?:-[A-Z]{2})?$/.test(trimmed)) return trimmed;

  const match = /^(?:languageConstants\/)?(\d+)$/.exec(trimmed);
  if (!match) return trimmed;

  const id = match[1];
  return LANGUAGE_CONSTANT_TO_CODE[id] ?? `lang_${id}`;
}
