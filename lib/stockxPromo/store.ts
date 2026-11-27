import fs from "node:fs/promises";
import path from "node:path";
import {
  mergePromoCodes,
  pickNextPromo,
  promoRejectReason,
  zurichDay,
  type PromoAccount,
  type PromoCode,
} from "@/lib/stockxPromo/codes";

export type PromoFile = {
  updatedAt: string;
  codes: PromoCode[];
};

const HOLD_MS = 10 * 60 * 1000;

export function promoCodesFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.STOCKX_PROMO_CODES_PATH) return env.STOCKX_PROMO_CODES_PATH;
  const root = env.STOCKX_DATA_DIR || path.join(process.cwd(), ".data");
  return path.join(root, "stockx-promo-codes.json");
}

async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const start = Date.now();
  for (;;) {
    try {
      await fs.mkdir(lock);
      break;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw error;
      if (Date.now() - start > 15_000) throw new Error("stockx promo codes lock timeout");
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rmdir(lock).catch(() => undefined);
  }
}

export async function readPromoFile(file = promoCodesFile()): Promise<PromoFile> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as PromoFile;
    return { updatedAt: parsed.updatedAt ?? "", codes: Array.isArray(parsed.codes) ? parsed.codes : [] };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { updatedAt: "", codes: [] };
    throw error;
  }
}

async function writePromoFile(file: string, data: PromoFile): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(tmp, file);
}

export async function mergeScannedPromos(
  incoming: PromoCode[],
  file = promoCodesFile()
): Promise<{ added: number; total: number; unused: number }> {
  return withLock(file, async () => {
    const existing = await readPromoFile(file);
    const before = new Set(existing.codes.map((code) => code.code.toUpperCase()));
    const codes = mergePromoCodes(existing.codes, incoming);
    const added = codes.filter((code) => !before.has(code.code.toUpperCase())).length;
    await writePromoFile(file, { updatedAt: new Date().toISOString(), codes });
    return {
      added,
      total: codes.length,
      unused: codes.filter((code) => code.status === "unused").length,
    };
  });
}

function expireStale(codes: PromoCode[], nowMs: number): PromoCode[] {
  const today = zurichDay(nowMs);
  return codes.map((code) => {
    if (code.status === "unused" && code.expires && code.expires < today) {
      return { ...code, status: "rejected" as const, rejectReason: "expired", holdUntil: null };
    }
    return code;
  });
}

/** Oldest unused code for this account. Holds it so a parallel checkout does not take the same one. */
export async function claimNextPromo(
  account: PromoAccount,
  nowMs = Date.now(),
  file = promoCodesFile()
): Promise<PromoCode | null> {
  return withLock(file, async () => {
    const existing = await readPromoFile(file);
    const codes = expireStale(existing.codes, nowMs);
    const next = pickNextPromo(codes, account, nowMs);
    if (!next) {
      await writePromoFile(file, { updatedAt: new Date(nowMs).toISOString(), codes });
      return null;
    }
    const holdUntil = new Date(nowMs + HOLD_MS).toISOString();
    const claimed = codes.map((code) =>
      code.code.toUpperCase() === next.code.toUpperCase()
        ? { ...code, lastTriedAt: new Date(nowMs).toISOString(), holdUntil }
        : code
    );
    await writePromoFile(file, { updatedAt: new Date(nowMs).toISOString(), codes: claimed });
    return { ...next, lastTriedAt: new Date(nowMs).toISOString(), holdUntil };
  });
}

async function patchCode(
  code: string,
  patch: (current: PromoCode) => PromoCode,
  file = promoCodesFile()
): Promise<void> {
  await withLock(file, async () => {
    const existing = await readPromoFile(file);
    let hit = false;
    const codes = existing.codes.map((row) => {
      if (row.code.toUpperCase() !== code.toUpperCase()) return row;
      hit = true;
      return patch(row);
    });
    if (!hit) return;
    await writePromoFile(file, { updatedAt: new Date().toISOString(), codes });
  });
}

export async function markPromoUsed(code: string, file = promoCodesFile()): Promise<void> {
  await patchCode(
    code,
    (row) => ({ ...row, status: "used", holdUntil: null, rejectReason: null }),
    file
  );
}

export async function markPromoRejected(
  code: string,
  reason: string,
  file = promoCodesFile()
): Promise<void> {
  await patchCode(
    code,
    (row) => ({
      ...row,
      status: "rejected",
      holdUntil: null,
      rejectReason: (reason || promoRejectReason(reason)).slice(0, 180),
    }),
    file
  );
}

/** Payment did not consume the code. Leave it unused for a later order. */
export async function releasePromoHold(code: string, file = promoCodesFile()): Promise<void> {
  await patchCode(
    code,
    (row) => (row.status === "unused" ? { ...row, holdUntil: null } : row),
    file
  );
}
