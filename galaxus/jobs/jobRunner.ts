import { prisma } from "@/app/lib/prisma";

type JobResult<T> = {
  name: string;
  startedAt: Date;
  finishedAt: Date;
  success: boolean;
  result?: T;
  error?: string;
};

async function createJobRunRecord(name: string, startedAt: Date) {
  try {
    return await (prisma as any).galaxusJobRun.create({
      data: {
        jobName: name,
        startedAt,
        finishedAt: startedAt,
        success: false,
      },
    });
  } catch {
    return null;
  }
}

async function finishJobRunRecord(
  id: string | null,
  payload: { finishedAt: Date; success: boolean; result?: unknown; errorMessage?: string }
) {
  if (!id) return;
  try {
    await (prisma as any).galaxusJobRun.update({
      where: { id },
      data: {
        finishedAt: payload.finishedAt,
        success: payload.success,
        resultJson: payload.result ?? undefined,
        errorMessage: payload.errorMessage ?? null,
      },
    });
  } catch {
    // ignore audit failures
  }
}

export async function runJob<T>(name: string, handler: () => Promise<T>): Promise<JobResult<T>> {
  const startedAt = new Date();
  console.info(`[galaxus][job:${name}] started`);
  const audit = await createJobRunRecord(name, startedAt);
  try {
    const result = await handler();
    const finishedAt = new Date();
    console.info(`[galaxus][job:${name}] success`);
    await finishJobRunRecord(audit?.id ?? null, { finishedAt, success: true, result });
    return { name, startedAt, finishedAt, success: true, result };
  } catch (error) {
    const finishedAt = new Date();
    console.error(`[galaxus][job:${name}] failed`, error);
    const message = error instanceof Error ? error.message : undefined;
    await finishJobRunRecord(audit?.id ?? null, { finishedAt, success: false, errorMessage: message });
    return { name, startedAt, finishedAt, success: false, error: message };
  }
}
