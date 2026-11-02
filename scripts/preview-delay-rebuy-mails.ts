/**
 * Preview delay / cancel-rebuy customer + ops mails for 2 real delayed OrderMatches.
 *
 * ALL emails → STOCKX_ALERT_EMAIL (never the real customer).
 * Includes KickDB/SupplierVariant precheck + StockX /buy/?size= link on the ops buy mail.
 *
 * Usage:
 *   npx tsx scripts/preview-delay-rebuy-mails.ts
 *   npx tsx scripts/preview-delay-rebuy-mails.ts --orders=7447,7331
 *   npx tsx scripts/preview-delay-rebuy-mails.ts --dry-run
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { buildDelayRebuyCase } from "@/lib/stockxDelayRebuy/buildCase";
import { sendDelayRebuyPreviewForMatch } from "@/lib/stockxDelayRebuy/sendPreview";

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(`--${name}=`.length);
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

async function resolveMatchIds(orderNames: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of orderNames) {
    const name = raw.startsWith("#") ? raw : `#${raw}`;
    const row = await prisma.orderMatch.findFirst({
      where: {
        shopifyOrderName: name,
        stockxOrderNumber: { startsWith: "0" },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, shopifyOrderName: true, stockxOrderNumber: true },
    });
    if (!row) throw new Error(`No StockX OrderMatch for ${name}`);
    console.log(`[preview] resolved ${row.shopifyOrderName} → ${row.stockxOrderNumber} id=${row.id}`);
    ids.push(row.id);
  }
  return ids;
}

/** Default: #7447 (stuck ORDER_CREATED +9d) + #7331 (AC_RECEIVED past ETA). */
const DEFAULT_ORDERS = ["7447", "7331"];

async function main() {
  const dryRun = hasFlag("dry-run");
  const ordersArg = arg("orders");
  const orderNames = (ordersArg ? ordersArg.split(",") : DEFAULT_ORDERS)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!process.env.STOCKX_ALERT_EMAIL?.trim() && !dryRun) {
    throw new Error("STOCKX_ALERT_EMAIL missing — set it or use --dry-run");
  }
  if (!process.env.POSTMARK_SERVER_TOKEN?.trim() && !dryRun) {
    throw new Error("POSTMARK_SERVER_TOKEN missing");
  }

  const ids = await resolveMatchIds(orderNames);
  console.log(
    `[preview] to=${process.env.STOCKX_ALERT_EMAIL || "(dry)"} dryRun=${dryRun} orders=${orderNames.join(",")}`
  );

  for (const id of ids) {
    if (dryRun) {
      const c = await buildDelayRebuyCase(id);
      console.log(
        JSON.stringify(
          {
            shopifyOrderName: c.shopifyOrderName,
            stockxOrderNumber: c.stockxOrderNumber,
            stockxStatus: c.stockxStatus,
            daysPastEta: c.daysPastEta,
            rebuyLane: c.rebuyLane,
            precheck: {
              status: c.precheck.status,
              stock: c.precheck.stock,
              expectedBuyChf: c.precheck.expectedBuyChf,
              marginPct: c.precheck.marginPct,
              detail: c.precheck.detail,
              supplierVariantId: c.precheck.supplierVariantId,
            },
            slug: c.slug,
            sizeUS: c.sizeUS,
            stockxCheckoutUrl: c.stockxCheckoutUrl,
            announceEta: {
              start: c.announceEtaStart.toISOString(),
              end: c.announceEtaEnd.toISOString(),
            },
            rebuyEta: {
              start: c.rebuyEtaStart.toISOString(),
              end: c.rebuyEtaEnd.toISOString(),
            },
          },
          null,
          2
        )
      );
      continue;
    }

    const res = await sendDelayRebuyPreviewForMatch(id);
    console.log(
      `[preview] DONE ${res.shopifyOrderName} steps=${res.sent.map((s) => `${s.step}:${s.ok}`).join(",")}`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
