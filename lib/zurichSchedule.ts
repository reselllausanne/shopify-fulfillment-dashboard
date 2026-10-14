const SCHEDULE_TZ = "Europe/Zurich";

/**
 * ms until the next HH:MM wall-clock time in Europe/Zurich (minute precision;
 * on DST switch days the run may shift by the switched hour).
 */
export function msUntilNextZurichTime(hhmm: string, now = new Date()): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`invalid time "${hhmm}" (expected HH:MM)`);
  const target = Number(m[1]) * 60 + Number(m[2]);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SCHEDULE_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  let delta = target - (hour * 60 + minute);
  if (delta <= 0) delta += 24 * 60;
  return delta * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds();
}
