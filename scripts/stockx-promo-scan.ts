/**
 * One IMAP pass: StockX promo / reward mails → .data/stockx-promo-codes.json.
 * Does not rewrite status of codes already stored. Read-only on the mailbox (BODY.PEEK).
 *
 *   npx tsx scripts/stockx-promo-scan.ts
 */
import { config as loadEnv } from "dotenv";
import { scanAndMergePromoCodes } from "../lib/stockxPromo/scan";

loadEnv();

async function main() {
  const days = Number(process.env.STOCKX_PROMO_SCAN_DAYS ?? 90);
  const result = await scanAndMergePromoCodes(Number.isFinite(days) && days > 0 ? days : 90);
  const lines = result.found
    .filter((code) => code.status === "unused")
    .map((code) => ({
      code: code.code,
      account: code.account,
      emailDate: code.emailDate,
      expires: code.expires,
    }));
  console.log(
    JSON.stringify({
      file: result.file,
      added: result.added,
      total: result.total,
      unused: result.unused,
      fresh: lines,
    })
  );
}

main().catch((error) => {
  const err = error as Error;
  console.error("[STOCKX-PROMO] scan failed", err?.stack || err?.message || error);
  process.exitCode = 1;
});
