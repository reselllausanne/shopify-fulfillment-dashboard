/** Public base URL for partner workers / jobs (feed push). Prefer request origin, then env. */
export function resolveAppOriginForPartnerJobs(explicit?: string | null): string | null {
  const t = explicit?.trim();
  if (t) return t;
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_ORIGIN?.trim();
  return fromEnv || null;
}
