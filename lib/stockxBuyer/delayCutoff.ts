/**
 * Galaxus "keep N days of delay": auto-buy only orders older than N full Zurich days.
 * Cutoff is an exclusive upper bound on orderDate (Zurich 00:00 of today - N days).
 * Example: now = Nov 12, N = 2 → cutoff Nov 10 00:00 → orders up to Nov 9 inclusive.
 */
const ZONE = "Europe/Zurich";

function zurichYmd(d: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d)
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

/** Zurich local midnight of y-m-d as a UTC instant (handles DST). */
function zurichMidnight(y: number, m: number, d: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  for (const offH of [1, 2]) {
    const cand = new Date(guess.getTime() - offH * 3600_000);
    const z = zurichYmd(cand);
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hour: "2-digit", hourCycle: "h23" }).format(cand)
    );
    if (z.y === y && z.m === m && z.d === d && hour === 0) return cand;
  }
  return new Date(guess.getTime() - 3600_000);
}

export function galaxusDelayCutoff(now: Date, delayDays: number, startsOn: Date | null): Date | null {
  if (!(delayDays > 0)) return null;
  if (startsOn && now.getTime() < startsOn.getTime()) return null;
  const t = zurichYmd(now);
  const back = new Date(Date.UTC(t.y, t.m - 1, t.d - Math.floor(delayDays)));
  return zurichMidnight(back.getUTCFullYear(), back.getUTCMonth() + 1, back.getUTCDate());
}
