#!/usr/bin/env npx tsx
/**
 * Daily GOAT cookie sync: refresh AWB on linked matches + auto-link unmatched Shopify lines.
 * No Playwright. Needs `.data/goat-cookie.json` (dashboard paste) or goat-session cookies.
 *
 *   npx tsx scripts/goat-awb-sync.ts --days=21
 *   npx tsx scripts/goat-awb-sync.ts --days=21 --dry-run
 */
import "dotenv/config";
import { autoLinkGoatBuysForShopifyOrders } from "@/shopify/orders/autoLinkGoatBuys";

function argFlag(name: string, fallback?: string): string | undefined {
  const p = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(p));
  if (hit) return hit.slice(p.length);
  return process.argv.includes(`--${name}`) ? "" : fallback;
}
function argInt(name: string, fallback: number): number {
  const v = argFlag(name);
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function main() {
  const days = argInt("days", 21);
  const apply = !process.argv.includes("--dry-run");
  const result = await autoLinkGoatBuysForShopifyOrders({ days, apply, limit: 300 });
  console.log(JSON.stringify({ days, apply, ...result }, null, 2));
  if (result.error === "no_goat_cookie" || result.error === "goat_auth_failed") {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[goat-awb-sync] fatal", err);
  process.exit(1);
});
