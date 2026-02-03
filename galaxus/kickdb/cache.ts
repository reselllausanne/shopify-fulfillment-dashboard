const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

export type KickDbCacheState = {
  lastFetchedAt?: Date | null;
  notFound?: boolean | null;
};

export function shouldFetchKickDb(state: KickDbCacheState): boolean {
  const { lastFetchedAt, notFound } = state;
  if (!lastFetchedAt) return true;
  const ageMs = Date.now() - lastFetchedAt.getTime();
  if (notFound) {
    return ageMs >= SEVEN_DAYS_MS;
  }
  return ageMs >= ONE_DAY_MS;
}
