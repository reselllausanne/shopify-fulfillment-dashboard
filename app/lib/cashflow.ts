import { formatInTimeZone, toZonedTime } from "date-fns-tz";

export const CASHFLOW_TIMEZONE = "Europe/Zurich";

export function toDateKey(date: Date) {
  return formatInTimeZone(date, CASHFLOW_TIMEZONE, "yyyy-MM-dd");
}

export function fromDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

export function clampDateToDay(date: Date, endOfDay: boolean) {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0
    )
  );
}

export function startOfTodayZurich() {
  const nowZurich = toZonedTime(new Date(), CASHFLOW_TIMEZONE);
  return new Date(
    Date.UTC(
      nowZurich.getFullYear(),
      nowZurich.getMonth(),
      nowZurich.getDate(),
      0,
      0,
      0,
      0
    )
  );
}

export function endOfTodayZurich() {
  const nowZurich = toZonedTime(new Date(), CASHFLOW_TIMEZONE);
  return new Date(
    Date.UTC(
      nowZurich.getFullYear(),
      nowZurich.getMonth(),
      nowZurich.getDate(),
      23,
      59,
      59,
      999
    )
  );
}

export function isWeekend(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function addCalendarDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + Math.round(days));
  return result;
}

export function addBusinessDays(date: Date, days: number) {
  const totalDays = Math.ceil(days);
  const result = new Date(date);
  let added = 0;
  while (added < totalDays) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (!isWeekend(result)) {
      added += 1;
    }
  }
  return result;
}

export function nextFriday(date: Date) {
  const result = new Date(date);
  const day = result.getUTCDay(); // 0=Sun, 5=Fri
  const diff = (5 - day + 7) % 7;
  result.setUTCDate(result.getUTCDate() + diff);
  return result;
}

export function buildDateRange(start: Date, end: Date) {
  const dates: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
