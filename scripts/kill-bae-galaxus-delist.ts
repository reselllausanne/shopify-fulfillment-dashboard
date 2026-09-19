/**
 * BAE Galaxus delist — dry-run then confirmed apply.
 *
 * Usage:
 *   npx tsx scripts/kill-bae-galaxus-delist.ts
 *   npx tsx scripts/kill-bae-galaxus-delist.ts --confirm=BAE_DELIST
 *
 * Dry-run: lists active BAE_* ChannelListingState rows (providerKey, GTIN, pushed stock, DB stock).
 * Apply: writes a marker file + prints env arm instructions. Does NOT upload feeds.
 * After apply review: set BAE_GALAXUS_STOCK_ZERO=1 on VPS, upload Galaxus stock feed.
 *
 * Merge/deploy alone never delists.
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/app/lib/prisma";
import {
  BAE_DELIST_CONFIRM_TOKEN,
  BAE_STOCK_ZERO_ENV,
  summarizeBaeActiveListings,
  type BaeActiveListingRow,
} from "@/galaxus/exports/baeKill";

const CONFIRM = process.argv.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length) ?? "";
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice("--limit=".length) ?? "0");

async function loadRows(): Promise<BaeActiveListingRow[]> {
  const p = prisma as any;
  const listings = await p.channelListingState.findMany({
    where: {
      OR: [{ providerKey: { startsWith: "BAE_" } }, { supplierVariantId: { startsWith: "bae_" } }],
    },
    select: {
      providerKey: true,
      gtin: true,
      supplierVariantId: true,
      lastPushedStock: true,
      status: true,
      channel: true,
    },
    take: LIMIT > 0 ? LIMIT : undefined,
  });

  const variantIds = [
    ...new Set(
      listings
        .map((r: { supplierVariantId: string | null }) => r.supplierVariantId)
        .filter(Boolean) as string[]
    ),
  ];
  const stockById = new Map<string, number>();
  const chunk = 500;
  for (let i = 0; i < variantIds.length; i += chunk) {
    const batch = variantIds.slice(i, i + chunk);
    const variants = await p.supplierVariant.findMany({
      where: { supplierVariantId: { in: batch } },
      select: { supplierVariantId: true, stock: true },
    });
    for (const v of variants) {
      stockById.set(v.supplierVariantId, Number(v.stock) || 0);
    }
  }

  return listings.map(
    (r: {
      providerKey: string;
      gtin: string | null;
      supplierVariantId: string | null;
      lastPushedStock: number | null;
      status: string | null;
      channel: string;
    }) => ({
      providerKey: r.providerKey,
      gtin: r.gtin,
      supplierVariantId: r.supplierVariantId,
      lastPushedStock: r.lastPushedStock,
      dbStock: r.supplierVariantId ? (stockById.get(r.supplierVariantId) ?? null) : null,
      status: r.status,
      channel: String(r.channel),
    })
  );
}

async function main() {
  const rows = await loadRows();
  const summary = summarizeBaeActiveListings(rows);
  const positive = rows.filter((r) => (r.lastPushedStock ?? 0) > 0 || (r.dbStock ?? 0) > 0);

  const report = {
    mode: CONFIRM === BAE_DELIST_CONFIRM_TOKEN ? "apply_arm" : "dry_run",
    armed: false,
    summary: {
      totalListings: summary.total,
      withPositivePushedStock: summary.withPositivePushedStock,
      withPositiveDbStock: summary.withPositiveDbStock,
      byStatus: summary.byStatus,
      byChannel: summary.byChannel,
      feedImpact:
        "Next Galaxus stock upload will emit QuantityOnStock=0 for these ProviderKeys ONLY after BAE_GALAXUS_STOCK_ZERO=1",
    },
    sample: positive.slice(0, 50).map((r) => ({
      providerKey: r.providerKey,
      gtin: r.gtin,
      supplierVariantId: r.supplierVariantId,
      lastPushedStock: r.lastPushedStock,
      dbStock: r.dbStock,
      status: r.status,
      channel: r.channel,
    })),
    providerKeys: summary.providerKeys.slice(0, 200),
    gtins: [...new Set(summary.gtins)].slice(0, 200),
  };

  console.log(JSON.stringify(report, null, 2));

  if (CONFIRM !== BAE_DELIST_CONFIRM_TOKEN) {
    console.error(
      `[kill-bae-delist] DRY-RUN only. Review counts above, then:\n` +
        `  npx tsx scripts/kill-bae-galaxus-delist.ts --confirm=${BAE_DELIST_CONFIRM_TOKEN}\n` +
        `Merge/deploy does NOT delist.`
    );
    return;
  }

  mkdirSync("tmp", { recursive: true });
  const markerPath = join("tmp", "bae-galaxus-delist-armed.json");
  writeFileSync(
    markerPath,
    JSON.stringify(
      {
        armedAt: new Date().toISOString(),
        confirm: BAE_DELIST_CONFIRM_TOKEN,
        summary: report.summary,
        providerKeyCount: summary.providerKeys.length,
      },
      null,
      2
    )
  );

  console.error(
    `[kill-bae-delist] APPLY armed locally → ${markerPath}\n` +
      `Next ops steps (human):\n` +
      `  1. Set ${BAE_STOCK_ZERO_ENV}=1 on VPS web/.env\n` +
      `  2. docker compose up -d --force-recreate web  (or wait next deploy with env)\n` +
      `  3. Upload Galaxus STOCK feed\n` +
      `  4. Optional DB wipe: npx tsx scripts/kill-bae-delete.ts --confirm=BAE_DELETE\n` +
      `Without step 1, stock feed still does NOT force BAE to 0.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
