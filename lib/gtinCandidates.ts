/** Expand EAN/UPC scan shapes for DB lookup (leading zeros, UPC-A ↔ EAN-13). */
export function expandGtinCandidates(candidates: string[]): string[] {
  const set = new Set<string>();
  for (const raw of candidates) {
    const digits = String(raw ?? "").replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 14) continue;
    set.add(digits);
    const trimmed = digits.replace(/^0+/, "");
    if (trimmed.length >= 8) set.add(trimmed);
    if (digits.length === 12) set.add(`0${digits}`);
    if (digits.length === 13 && digits.startsWith("0")) set.add(digits.slice(1));
  }
  return Array.from(set).filter((g) => g.length >= 8);
}
