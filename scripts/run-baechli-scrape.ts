/**
 * BAE scraper permanently killed.
 * Galaxus delist (after human dry-run validation):
 *   npx tsx scripts/kill-bae-galaxus-delist.ts
 *   npx tsx scripts/kill-bae-galaxus-delist.ts --apply --confirm=BAE_DELIST_GALAXUS
 */
console.error(
  "BAE_SCRAPER_KILLED — Bächli scrape removed. Use scripts/kill-bae-galaxus-delist.ts for Galaxus delist."
);
process.exit(1);
