/**
 * BAE Galaxus delist — dry-run by default; apply only with explicit confirm.
 *
 * Usage:
 *   npx tsx scripts/kill-bae-galaxus-delist.ts
 *   npx tsx scripts/kill-bae-galaxus-delist.ts --out=tmp/bae-active.json
 *   npx tsx scripts/kill-bae-galaxus-delist.ts --apply --confirm=BAE_DELIST_GALAXUS
 *
 * Dry-run is read-only: lists every GALAXUS ChannelListingState row for BAE
 * that still has lastPushedStock > 0 (or status ACTIVE), with providerKey + GTIN.
 *
 * --apply NEVER runs on merge/deploy. It:
 *   1. Writes a stock CSV (ProviderKey,QuantityOnStock=0) for manual Galaxus upload
 *   2. Sets local SupplierVariant.stock = 0 for bae_* rows
 *   3. Marks matching ChannelListingState rows SOLD_OUT / lastPushedStock=0
 * It does NOT upload feeds and does NOT set SUPPLIER_STOCK_PUBLISH_ENFORCED.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/app/lib/prisma";
import {
  BAE_DELIST_CONFIRM_TOKEN,
  buildBaeDelistStockCsv,
  summarizeBaeActiveListings,
  type BaeActiveListingRow,
} from "@/galaxus/exports/baeKill";

const APPLY = process.argv.includes("--apply");
const confirmArg = process.argv.find((a) => a.startsWith("--confirm="));
const confirm = confirmArg ? confirmArg.slice("--confirm=".length) : "";
const outArg = process.argv.find((a) => a.startsWith("--out="));
const outPath = outArg ? outArg.slice("--out=".length) : "";

async function loadActiveBaeGalaxusListings(): Promise<BaeActiveListingRow[]> {
  const rows = await prisma.channelListingState.findMany({
    where: {
      channel: "GALAXUS",
      OR: [
        { providerKey: { startsWith: "BAE_" } },
        { supplierVariantId: { startsWith: "bae_" } },
      ],
      AND: [
        {
          OR: [{ lastPushedStock: { gt: 0 } }, { status: "ACTIVE" }],
        },
      ],
    },
    select: {
      providerKey: true,
      gtin: true,
      supplierVariantId: true,
      lastPushedStock: true,
      status: true,
      channel: true,
    },
    orderBy: { providerKey: "asc" },
  });

  return rows.map((r) => ({
    providerKey: String(r.providerKey ?? ""),
    gtin: r.gtin ? String(r.gtin) : null,
    supplierVariantId: r.supplierVariantId ? String(r.supplierVariantId) : null,
    lastPushedStock:
      r.lastPushedStock === null || r.lastPushedStock === undefined
        ? null
        : Number(r.lastPushedStock),
    status: r.status ? String(r.status) : null,
    channel: String(r.channel),
  }));
}

async function main() {
  const rows = await loadActiveBaeGalaxusListings();
  const summary = summarizeBaeActiveListings(rows);

  const report = {
    mode: APPLY ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    note:
      "Merge/deploy of kill-bae does NOT zero these offers. Apply requires --confirm=BAE_DELIST_GALAXUS.",
    total: summary.total,
    byStatus: summary.byStatus,
    rows: rows.map((r) => ({
      providerKey: r.providerKey,
      gtin: r.gtin,
      supplierVariantId: r.supplierVariantId,
      lastPushedStock: r.lastPushedStock,
      status: r.status,
    })),
  };

  console.log(
    JSON.stringify(
      {
        mode: report.mode,
        generatedAt: report.generatedAt,
        total: report.total,
        byStatus: report.byStatus,
        sample: report.rows.slice(0, 10),
      },
      null,
      2
    )
  );

  if (outPath) {
    const abs = path.resolve(outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(report, null, 2));
    console.error(`[kill-bae] wrote full list → ${abs}`);
  }

  if (!APPLY) {
    console.error(
      `[kill-bae] dry-run only — ${summary.total} Galaxus BAE listing(s) still active/stock>0. No writes.`
    );
    return;
  }

  if (confirm !== BAE_DELIST_CONFIRM_TOKEN) {
    console.error(
      `[kill-bae] REFUSED apply: pass --confirm=${BAE_DELIST_CONFIRM_TOKEN} after validating the dry-run list.`
    );
    process.exitCode = 2;
    return;
  }

  const providerKeys = summary.providerKeys.filter(Boolean);
  const csvDir = path.resolve("tmp");
  fs.mkdirSync(csvDir, { recursive: true });
  const csvPath = path.join(csvDir, `bae-galaxus-delist-stock-${Date.now()}.csv`);
  fs.writeFileSync(csvPath, buildBaeDelistStockCsv(providerKeys));
  console.error(`[kill-bae] wrote delist stock CSV → ${csvPath}`);
  console.error(
    "[kill-bae] Upload this CSV via Galaxus stock feed manually. This script does not upload."
  );

  const variantIds = [
    ...new Set(
      rows
        .map((r) => r.supplierVariantId)
        .filter((id): id is string => Boolean(id && id.startsWith("bae_")))
    ),
  ];

  let stockZeroed = 0;
  const chunk = 500;
  for (let i = 0; i < variantIds.length; i += chunk) {
    const batch = variantIds.slice(i, i + chunk);
    const res = await prisma.supplierVariant.updateMany({
      where: { supplierVariantId: { in: batch } },
      data: { stock: 0 },
    });
    stockZeroed += res.count;
  }

  let listingsUpdated = 0;
  for (let i = 0; i < providerKeys.length; i += chunk) {
    const batch = providerKeys.slice(i, i + chunk);
    const res = await prisma.channelListingState.updateMany({
      where: {
        channel: "GALAXUS",
        providerKey: { in: batch },
      },
      data: {
        lastPushedStock: 0,
        status: "SOLD_OUT",
        soldOutAt: new Date(),
      },
    });
    listingsUpdated += res.count;
  }

  console.log(
    JSON.stringify(
      {
        applied: true,
        confirm: confirm,
        csvPath,
        providerKeys: providerKeys.length,
        supplierVariantsStockZeroed: stockZeroed,
        channelListingStatesUpdated: listingsUpdated,
        uploaded: false,
      },
      null,
      2
    )
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
