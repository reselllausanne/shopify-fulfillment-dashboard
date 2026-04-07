/** UTC date-only helpers shared by financial dashboard and recurring APIs */

export const toUtcDateOnly = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export const getRunDateForMonth = (year: number, monthIndex: number, dayOfMonth: number) => {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(dayOfMonth, 1), lastDay);
  return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0));
};

export const parseYmdUtc = (value?: string | null): Date | null => {
  if (!value) return null;
  const parts = value.split("-").map((p) => Number(p));
  if (parts.length !== 3 || !parts[0]) return null;
  const [y, m, d] = parts;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
};

export const recurringMarker = (recurringId: string) => `[RECURRING:${recurringId}]`;

export const extractRecurringIdFromNote = (note?: string | null): string | null => {
  if (!note) return null;
  const match = note.match(/\[RECURRING:([^\]]+)\]/);
  return match?.[1] || null;
};
