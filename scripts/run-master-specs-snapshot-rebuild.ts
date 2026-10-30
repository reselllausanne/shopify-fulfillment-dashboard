#!/usr/bin/env npx tsx
import { rebuildMasterSpecsSnapshot } from "@/galaxus/exports/masterSpecsSnapshot";

/** Line-buffer stdout when piped (docker compose / cron) so progress isn't stuck in 64KB chunks. */
try {
  const handle = (process.stdout as { _handle?: { setBlocking?: (v: boolean) => void } })._handle;
  handle?.setBlocking?.(true);
} catch {
  // ignore
}

async function main() {
  const started = Date.now();
  console.info("[run-master-specs-snapshot-rebuild] start", {
    nodeOptions: process.env.NODE_OPTIONS ?? "(default)",
  });
  const result = await rebuildMasterSpecsSnapshot();
  console.info("[run-master-specs-snapshot-rebuild] done", {
    ...result,
    wallMs: Date.now() - started,
  });
}

main().catch((err) => {
  console.error("[run-master-specs-snapshot-rebuild] failed", err);
  process.exitCode = 1;
});
