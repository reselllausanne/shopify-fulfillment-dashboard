#!/usr/bin/env npx tsx
/**
 * Backfill KickDB brand/images onto supplier rows that fail isGalaxusCatalogReady.
 *
 * Usage:
 *   npx tsx scripts/hydrate-galaxus-catalog-identity.ts
 *   npx tsx scripts/hydrate-galaxus-catalog-identity.ts --dry-run
 *   npx tsx scripts/hydrate-galaxus-catalog-identity.ts --prefix=stx_ --limit=200
 */
import { hydrateSupplierVariantsMissingCatalog } from "@/galaxus/jobs/hydrateCatalogIdentity";

function readArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limit = Number.parseInt(readArg("limit") ?? "500", 10);
  const prefix = readArg("prefix") ?? "stx_";

  const result = await hydrateSupplierVariantsMissingCatalog({
    dryRun,
    limit: Number.isFinite(limit) ? limit : 500,
    supplierVariantIdPrefix: prefix,
  });

  console.log(JSON.stringify({ ok: true, dryRun, prefix, ...result }, null, 2));
}

main().catch((error) => {
  console.error("[hydrate-catalog] fatal", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
