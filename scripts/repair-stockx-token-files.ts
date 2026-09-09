/**
 * Rewrite `.data/stockx-token*.json` keeping only the StockX JWT (drop glued Supabase tail).
 *
 *   npx tsx scripts/repair-stockx-token-files.ts
 */
import fs from "node:fs/promises";
import {
  GALAXUS_STOCKX_TOKEN_FILE,
  sanitizeStockxBearerToken,
  writeGalaxusStockxToken,
} from "../lib/stockxGalaxusAuth";
import { DASHBOARD_STOCKX_TOKEN_FILE } from "../lib/stockxServerToken";

async function repairFile(path: string) {
  try {
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { token?: string };
    const before = String(parsed?.token ?? "").length;
    const cleaned = sanitizeStockxBearerToken(parsed?.token ?? "");
    if (!cleaned) {
      console.log("[repair] skip (no StockX JWT)", path);
      return false;
    }
    if (cleaned === parsed.token) {
      console.log("[repair] ok already", path, "len", before);
      return true;
    }
    await writeGalaxusStockxToken(cleaned, path);
    console.log("[repair] fixed", path, "before", before, "after", cleaned.length);
    return true;
  } catch (e: any) {
    console.warn("[repair] failed", path, e?.message ?? e);
    return false;
  }
}

async function main() {
  await repairFile(GALAXUS_STOCKX_TOKEN_FILE);
  await repairFile(DASHBOARD_STOCKX_TOKEN_FILE);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
