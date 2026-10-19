#!/usr/bin/env npx tsx
/**
 * Delete funnel_events older than retention window (default 14 months). TRACKING-PLAN §10.
 *
 *   npx tsx scripts/purge-funnel-events.ts              # dry-run (default)
 *   npx tsx scripts/purge-funnel-events.ts --execute
 */
import "dotenv/config";

import { prisma } from "../app/lib/prisma";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

async function main() {
  const execute = arg("execute") === "true";
  const months = Math.max(1, Number(process.env.FUNNEL_EVENTS_RETENTION_MONTHS ?? 14));
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  const [{ count }] = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count
    FROM public.funnel_events
    WHERE created_at < ${cutoff}
  `;

  const n = Number(count);
  console.log(
    `funnel_events before ${cutoff.toISOString()} (${months}mo retention): ${n} row(s)${execute ? " — deleting" : " — dry-run (pass --execute to delete)"}`,
  );

  if (!execute || n === 0) return;

  const deleted = await prisma.$executeRaw`
    DELETE FROM public.funnel_events WHERE created_at < ${cutoff}
  `;
  console.log(`deleted ${deleted} row(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
