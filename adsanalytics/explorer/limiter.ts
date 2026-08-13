/** Minimal in-process concurrency limiter shared by every Merchant/Ads batch writer. */
export function createLimiter(concurrency: number) {
  const limit = Math.max(1, concurrency);
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= limit) return;
    const job = queue.shift();
    if (!job) return;
    active += 1;
    job();
  };
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
  };
}
