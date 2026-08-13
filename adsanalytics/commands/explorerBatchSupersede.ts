import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { log, withSyncRun } from "@/adsanalytics/run";

type Options = { oldBatch?: string; newBatch?: string };

export async function explorerBatchSupersedeCommand(options: Options = {}): Promise<number> {
  return withSyncRun("explorer:batch:supersede", options, async () => {
    const oldBatch = options.oldBatch?.trim();
    const newBatch = options.newBatch?.trim();
    if (!oldBatch) throw new Error("Missing --old-batch=<id>");
    if (!newBatch) throw new Error("Missing --new-batch=<id>");
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "public"."ads_explorer_batches"
      SET
        "status" = 'superseded',
        "error" = 'superseded_by_' || ${newBatch},
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${oldBatch}
    `);
    log("explorer_batch_supersede.done", { oldBatch, newBatch });
    return { oldBatch, newBatch, status: "superseded" };
  });
}

