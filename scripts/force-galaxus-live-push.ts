#!/usr/bin/env npx tsx
/**
 * Force live Galaxus stock → price → master after physical recovery.
 * Assumes feed snapshot is invalidated so exports use live path.
 */
import "dotenv/config";
import { prisma } from "../app/lib/prisma";

const BASE = process.env.GALAXUS_OPS_BASE_URL ?? "http://127.0.0.1:3000";

async function post(action: string) {
  const res = await fetch(`${BASE}/api/galaxus/ops/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const json = await res.json().catch(() => ({}));
  console.info("[force-push] POST", action, res.status, json);
  return json;
}

async function waitIdle(label: string, maxMs: number) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const active = await prisma.galaxusFeedRun.count({ where: { finishedAt: null } });
    const pending = await prisma.galaxusFeedTrigger.count({
      where: { status: { in: ["PENDING", "RUNNING"] } },
    });
    console.info("[force-push] wait", label, { active, pending, elapsedSec: Math.round((Date.now() - start) / 1000) });
    if (active === 0 && pending === 0) return true;
    await new Promise((r) => setTimeout(r, 30_000));
  }
  return false;
}

async function main() {
  const meta = await prisma.galaxusFeedSnapshotMeta.findFirst({
    select: { rebuiltAt: true, stockRowCount: true, offerRowCount: true },
  });
  console.info("[force-push] snapshot meta", meta);
  if (meta?.rebuiltAt) {
    console.warn("[force-push] snapshot still valid — stock may miss physical keys. Invalidating.");
    await prisma.galaxusFeedSnapshotMeta.updateMany({
      where: { id: "default" },
      data: { rebuiltAt: null, stockRowCount: 0, offerRowCount: 0 },
    });
  }

  // Drain whatever is already running (post-sale price etc.)
  await waitIdle("pre", 3_600_000);

  await post("push-stock");
  await waitIdle("stock", 3_600_000);

  await post("push-price");
  await waitIdle("price", 3_600_000);

  await post("push-master-specs");
  await waitIdle("master", 14_400_000);

  const last = await prisma.galaxusFeedRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
    select: {
      scope: true,
      startedAt: true,
      finishedAt: true,
      success: true,
      countsJson: true,
      errorMessage: true,
      triggerSource: true,
    },
  });
  console.info("[force-push] DONE last runs", JSON.stringify(last, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
