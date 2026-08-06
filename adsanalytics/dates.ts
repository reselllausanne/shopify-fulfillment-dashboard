/**
 * Date helpers for the ads POC.
 *
 * Google Ads reports in the *account* timezone and GAQL takes plain YYYY-MM-DD
 * strings, so everything here works on calendar dates in UTC terms and never
 * converts to a wall-clock instant. The DB column is DATE for the same reason.
 */

export type DateRange = { start: string; end: string };

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function addDays(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

/** Yesterday is the last day with settled Google Ads data. */
export function defaultEndDate(now: Date = new Date()): string {
  const end = new Date(now.getTime());
  end.setUTCDate(end.getUTCDate() - 1);
  return toIsoDate(end);
}

export function rangeForDays(days: number, endDate: string = defaultEndDate()): DateRange {
  if (!Number.isFinite(days) || days < 1) throw new Error(`Invalid --days value: ${days}`);
  return { start: addDays(endDate, -(days - 1)), end: endDate };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: string, label: string): string {
  if (!ISO_DATE.test(value)) throw new Error(`Invalid ${label}: ${value} (expected YYYY-MM-DD)`);
  return value;
}

/** Explicit inclusive range, or falling back to --days lookback ending yesterday. */
export function resolveDateRange(options: {
  from?: string;
  to?: string;
  days?: number;
}): DateRange {
  if (options.from || options.to) {
    if (!options.from || !options.to) {
      throw new Error("Both --from=YYYY-MM-DD and --to=YYYY-MM-DD are required together");
    }
    const start = assertIsoDate(options.from, "--from");
    const end = assertIsoDate(options.to, "--to");
    if (parseIsoDate(end) < parseIsoDate(start)) {
      throw new Error(`Invalid range: --to ${end} is before --from ${start}`);
    }
    return { start, end };
  }
  return rangeForDays(options.days ?? 30);
}

/** End of the decision window: exclude the last `lagDays` of the period for negatives. */
export function decisionRange(range: DateRange, lagDays = 7): DateRange {
  const decisionEnd = addDays(range.end, -lagDays);
  if (parseIsoDate(decisionEnd) < parseIsoDate(range.start)) {
    return { start: range.start, end: range.start };
  }
  return { start: range.start, end: decisionEnd };
}

/** The lag tail excluded from negative decisions (may be empty). */
export function lagRange(range: DateRange, lagDays = 7): DateRange | null {
  const decisionEnd = addDays(range.end, -lagDays);
  if (parseIsoDate(decisionEnd) < parseIsoDate(range.start)) return null;
  const lagStart = addDays(decisionEnd, 1);
  if (parseIsoDate(lagStart) > parseIsoDate(range.end)) return null;
  return { start: lagStart, end: range.end };
}

/**
 * Split a range into calendar months, newest first, so a backfill can be resumed
 * month by month and an early failure keeps the most recent data already stored.
 */
export function splitIntoMonths(range: DateRange): DateRange[] {
  const chunks: DateRange[] = [];
  const start = parseIsoDate(range.start);
  const end = parseIsoDate(range.end);
  if (end < start) return chunks;

  let cursorEnd = end;
  while (cursorEnd >= start) {
    const monthStart = new Date(
      Date.UTC(cursorEnd.getUTCFullYear(), cursorEnd.getUTCMonth(), 1)
    );
    const chunkStart = monthStart < start ? start : monthStart;
    chunks.push({ start: toIsoDate(chunkStart), end: toIsoDate(cursorEnd) });

    const previousDay = new Date(chunkStart.getTime());
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    cursorEnd = previousDay;
  }

  return chunks;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}
