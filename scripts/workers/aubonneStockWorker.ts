import { PrismaClient } from "@prisma/client";
import { checkStyle, loadStyleCodes, loadStyleMeta, type ScanLane } from "@/lib/aubonne/nikeStoreStock";

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LETTER_EVERY_MS = Number(process.env.AUBONNE_LETTER_EVERY_MS ?? 20 * 60 * 60 * 1000);
const NUMERIC_EVERY_MS = Number(process.env.AUBONNE_NUMERIC_EVERY_MS ?? 7 * 24 * 60 * 60 * 1000);
const BATCH = Math.max(1, Number(process.env.AUBONNE_CONCURRENCY ?? 8));

function due(finishedAt: Date | null, everyMs: number): boolean {
  if (!finishedAt) return true;
  return Date.now() - finishedAt.getTime() >= everyMs;
}

async function runLane(lane: ScanLane) {
  const state = await prisma.aubonneScanState.upsert({
    where: { id: lane },
    create: { id: lane },
    update: {},
  });
  const resume = state.startedAt && !state.finishedAt && state.cursor > 0 && state.cursor < state.total;
  if (!resume && !due(state.finishedAt, lane === "letter" ? LETTER_EVERY_MS : NUMERIC_EVERY_MS)) {
    console.info(`[aubonne] ${lane} fresh until ${state.finishedAt?.toISOString()}`);
    return;
  }
  console.info(`[aubonne] ${lane} loading codes`);
  const codes = await loadStyleCodes(prisma, lane);
  const meta = await loadStyleMeta(prisma, codes);
  let cursor = resume ? state.cursor : 0;
  let found = resume ? state.found : 0;
  let errors = resume ? state.errors : 0;
  await prisma.aubonneScanState.update({
    where: { id: lane },
    data: {
      startedAt: resume ? state.startedAt : new Date(),
      finishedAt: null,
      cursor,
      total: codes.length,
      found,
      errors,
    },
  });
  console.info(`[aubonne] ${lane} ${codes.length} codes from ${cursor}`);
  while (cursor < codes.length) {
    const batch = codes.slice(cursor, cursor + BATCH);
    const results = await Promise.all(
      batch.map(async (style) => {
        try {
          return await checkStyle(prisma, style, meta.get(style));
        } catch (err) {
          console.warn(`[aubonne] ${style} ${err instanceof Error ? err.message : err}`);
          return "error" as const;
        }
      })
    );
    for (const result of results) {
      if (result === "hit") found += 1;
      else if (result === "error") errors += 1;
    }
    cursor += batch.length;
    if (cursor % 200 < BATCH || cursor >= codes.length) {
      await prisma.aubonneScanState.update({
        where: { id: lane },
        data: { cursor, found, errors, total: codes.length },
      });
      console.info(`[aubonne] ${lane} ${cursor}/${codes.length} instock ${found} err ${errors}`);
    }
  }
  await prisma.aubonneScanState.update({
    where: { id: lane },
    data: { finishedAt: new Date(), cursor: 0, total: codes.length, found, errors },
  });
  console.info(`[aubonne] ${lane} done instock ${found} err ${errors}`);
}

async function main() {
  console.info("[aubonne] worker start");
  for (;;) {
    try {
      await runLane("letter");
      await runLane("numeric");
    } catch (err) {
      console.error("[aubonne] pass failed", err instanceof Error ? err.message : err);
    }
    await sleep(60_000);
  }
}

main().finally(() => prisma.$disconnect());
