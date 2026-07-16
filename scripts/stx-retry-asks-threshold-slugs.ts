/**
 * Reset only ERROR slugs blocked by the old asks≥2 rule, then enqueue slug sync.
 *
 * Usage:
 *   npx tsx scripts/stx-retry-asks-threshold-slugs.ts
 *   npx tsx scripts/stx-retry-asks-threshold-slugs.ts --reset-only
 *   npx tsx scripts/stx-retry-asks-threshold-slugs.ts --inline --limit 20
 */
import "dotenv/config";

import { POST as syncPost } from "../app/api/galaxus/stx/import-slugs/sync/route";

async function main() {
  const args = new Set(process.argv.slice(2));
  const resetOnly = args.has("--reset-only");
  const inline = args.has("--inline");
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 50;

  const body: Record<string, unknown> = {
    retryAsksThreshold: true,
    resetOnly,
  };

  if (!resetOnly) {
    if (inline) {
      body.limit = limit;
      body.concurrency = Math.min(6, limit);
      body.batchSize = limit;
    } else {
      body.enqueue = true;
      body.workerJobs = 4;
      body.concurrency = 6;
      body.batchSize = 120;
      body.autoDrain = true;
    }
  } else if (args.has("--enqueue")) {
    body.resetOnly = false;
    body.retryAsksThreshold = false;
    body.enqueue = true;
    body.workerJobs = 4;
    body.concurrency = 6;
    body.batchSize = 120;
    body.autoDrain = true;
  }

  const res = await syncPost(
    new Request("http://script.local/api/galaxus/stx/import-slugs/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
  if (!res.ok || !data?.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
