/** PSA / BGS / SGC / CGC grade labels on graded TCG feed rows (StockX size → Galaxus title/spec). */

const GRADED_TCG_PREFIX_RE = /^(PSA|BGS|SGC|CGC)\s/i;

export function extractGradedTradingCardLabel(sizeRaw?: string | null): string | null {
  const raw = String(sizeRaw ?? "").trim().replace(/\s+/g, " ");
  if (!raw || !GRADED_TCG_PREFIX_RE.test(raw)) return null;
  return raw;
}

export function appendGradedTradingCardToTitle(title: string, sizeRaw?: string | null): string {
  const grade = extractGradedTradingCardLabel(sizeRaw);
  if (!grade) return title;
  if (title.toLowerCase().includes(grade.toLowerCase())) return title;
  const combined = `${title} — ${grade}`;
  return combined.length <= 200 ? combined : `${title.slice(0, 200 - grade.length - 3).trim()} — ${grade}`;
}

export function gradedTradingCardDescriptionSuffix(sizeRaw?: string | null): string | null {
  const grade = extractGradedTradingCardLabel(sizeRaw);
  if (!grade) return null;
  const grader = grade.split(/\s/)[0]?.toUpperCase() ?? "";
  if (grader === "PSA") return `Bewertung: ${grade} (Professional Sports Authenticator).`;
  if (grader === "BGS") return `Bewertung: ${grade} (Beckett Grading Services).`;
  if (grader === "CGC") return `Bewertung: ${grade} (Certified Guaranty Company).`;
  if (grader === "SGC") return `Bewertung: ${grade} (Sportscard Guaranty Corporation).`;
  return `Bewertung: ${grade}.`;
}
