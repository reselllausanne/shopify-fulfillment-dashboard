import { prisma } from "@/app/lib/prisma";
import { listDecathlonJobDefinitions } from "./jobDefinitions";

export async function getDecathlonOpsStatus() {
  const prismaAny = prisma as any;
  const jobs = await listDecathlonJobDefinitions();
  const recentRuns = await prismaAny.decathlonImportRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 15,
  });

  const latestByFlow: Record<string, any> = {};
  for (const run of recentRuns) {
    if (!latestByFlow[run.flow]) {
      latestByFlow[run.flow] = run;
    }
  }

  return {
    ok: true,
    jobs,
    latest: latestByFlow,
    recentRuns,
  };
}
