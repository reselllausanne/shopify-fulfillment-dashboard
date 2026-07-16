import { countImageSyncBacklog, runImageSync } from "@/galaxus/jobs/imageSync";

async function main() {
  const initialBacklog = await countImageSyncBacklog({ supplierKeys: ["stx", "the"] });
  console.info("[image-sync][full] initial backlog", initialBacklog);

  const result = await runImageSync({
    full: true,
    limit: 2000,
    concurrency: 8,
    supplierKeys: ["stx", "the"],
  });

  const remaining = await countImageSyncBacklog({ supplierKeys: ["stx", "the"] });
  console.info("[image-sync][full] finished", { ...result, remaining });
}

main().catch((error) => {
  console.error("[image-sync][full] failed", error);
  process.exit(1);
});
