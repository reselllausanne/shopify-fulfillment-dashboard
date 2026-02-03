export type JobResult<T> = {
  name: string;
  startedAt: Date;
  finishedAt: Date;
  success: boolean;
  result?: T;
};

export async function runJob<T>(name: string, handler: () => Promise<T>): Promise<JobResult<T>> {
  const startedAt = new Date();
  console.info(`[galaxus][job:${name}] started`);
  try {
    const result = await handler();
    const finishedAt = new Date();
    console.info(`[galaxus][job:${name}] success`);
    return { name, startedAt, finishedAt, success: true, result };
  } catch (error) {
    const finishedAt = new Date();
    console.error(`[galaxus][job:${name}] failed`, error);
    return { name, startedAt, finishedAt, success: false };
  }
}
