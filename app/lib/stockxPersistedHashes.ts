import fs from "node:fs/promises";
import path from "node:path";
import {
  STOCKX_GET_BUY_ORDER_OPERATION_NAME,
  STOCKX_GET_BUY_ORDER_PERSISTED_HASH,
  STOCKX_PERSISTED_OPERATION_NAME,
  STOCKX_PERSISTED_QUERY_HASH,
} from "@/app/lib/constants";

export const DEFAULT_STOCKX_PERSISTED_HASHES_FILE = path.join(
  process.cwd(),
  ".data",
  "stockx-persisted-hashes.json"
);

export type StockxPersistedHashes = Record<string, string>;

function normalizeHash(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(cleaned)) return null;
  return cleaned;
}

export async function readStockxPersistedHashes(
  filePath = DEFAULT_STOCKX_PERSISTED_HASHES_FILE
): Promise<StockxPersistedHashes> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as
      | { hashes?: Record<string, unknown> }
      | Record<string, unknown>
      | null;
    const source =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? ((parsed as any).hashes && typeof (parsed as any).hashes === "object"
            ? (parsed as any).hashes
            : parsed)
        : {};
    const hashes: StockxPersistedHashes = {};
    for (const [key, value] of Object.entries(source || {})) {
      const op = String(key || "").trim();
      const hash = normalizeHash(value);
      if (!op || !hash) continue;
      hashes[op] = hash;
    }
    return hashes;
  } catch {
    return {};
  }
}

export async function writeStockxPersistedHashes(
  hashes: StockxPersistedHashes,
  filePath = DEFAULT_STOCKX_PERSISTED_HASHES_FILE
): Promise<void> {
  const normalized: StockxPersistedHashes = {};
  for (const [key, value] of Object.entries(hashes || {})) {
    const op = String(key || "").trim();
    const hash = normalizeHash(value);
    if (!op || !hash) continue;
    normalized[op] = hash;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), hashes: normalized }, null, 2)}\n`,
    "utf8"
  );
}

export function resolveStockxPersistedHash(
  operationName: string,
  hashes?: StockxPersistedHashes | null
): string | null {
  const op = String(operationName || "").trim();
  if (!op) return null;
  const map = hashes || {};
  const fromFile = normalizeHash((map as Record<string, unknown>)[op]);
  if (fromFile) return fromFile;
  if (op === STOCKX_PERSISTED_OPERATION_NAME) {
    return normalizeHash(STOCKX_PERSISTED_QUERY_HASH);
  }
  if (op === STOCKX_GET_BUY_ORDER_OPERATION_NAME) {
    return normalizeHash(STOCKX_GET_BUY_ORDER_PERSISTED_HASH);
  }
  return null;
}

