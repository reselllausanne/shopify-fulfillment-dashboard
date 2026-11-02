/**
 * TEST Shopify customer delay + cancel-rebuy mails → STOCKX_ALERT_EMAIL
 * (never the real customer).
 *
 * Usage:
 *   npx tsx scripts/send-customer-delay-mails-test.ts
 *   npx tsx scripts/send-customer-delay-mails-test.ts --order=7447
 *   npx tsx scripts/send-customer-delay-mails-test.ts --dry-run
 *   npx tsx scripts/send-customer-delay-mails-test.ts --kind=delay
 *   npx tsx scripts/send-customer-delay-mails-test.ts --kind=cancel-rebuy
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { buildDelayRebuyCase } from "@/lib/stockxDelayRebuy/buildCase";
import { sendCustomerDelayMail } from "@/lib/stockxDelayRebuy/sendCustomer";
import type { DelayNarrativeKind } from "@/lib/stockxDelayRebuy/types";

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(`--${name}=`.length);
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

async function findRecentDelayedMatchId(): Promise<{
  id: string;
  shopifyOrderName: string;
  stockxOrderNumber: string | null;
  stockxStatus: string | null;
  etaEnd: Date | null;
}> {
  const now = new Date();
  const since = new Date(now.getTime() - 60 * 86_400_000); // last 60d Shopify
  const row = await prisma.orderMatch.findFirst({
    where: {
      stockxOrderNumber: { startsWith: "0" },
      shopifyCustomerEmail: { not: null },
      shopifyCreatedAt: { gte: since },
      stockxStatus: {
        notIn: [
          "CANCELED",
          "CANCELLED",
          "REFUNDED",
          "COMPLETED",
          "DELIVERED",
          "BUYER_RECEIVED",
        ],
      },
      OR: [
        { stockxLatestEstimatedDelivery: { lt: now } },
        {
          AND: [
            { stockxLatestEstimatedDelivery: null },
            { stockxEstimatedDelivery: { lt: now } },
          ],
        },
      ],
    },
    orderBy: [{ shopifyCreatedAt: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      shopifyOrderName: true,
      stockxOrderNumber: true,
      stockxStatus: true,
      stockxLatestEstimatedDelivery: true,
      stockxEstimatedDelivery: true,
    },
  });
  if (!row) throw new Error("No recent (60d) delayed Shopify OrderMatch with customer email");
  return {
    id: row.id,
    shopifyOrderName: row.shopifyOrderName,
    stockxOrderNumber: row.stockxOrderNumber,
    stockxStatus: row.stockxStatus,
    etaEnd: row.stockxLatestEstimatedDelivery || row.stockxEstimatedDelivery,
  };
}

async function resolveMatchId(orderRaw?: string): Promise<{
  id: string;
  shopifyOrderName: string;
  stockxOrderNumber: string | null;
  stockxStatus: string | null;
  etaEnd: Date | null;
}> {
  if (!orderRaw) return findRecentDelayedMatchId();
  const name = orderRaw.startsWith("#") ? orderRaw : `#${orderRaw}`;
  const row = await prisma.orderMatch.findFirst({
    where: {
      shopifyOrderName: name,
      stockxOrderNumber: { startsWith: "0" },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      shopifyOrderName: true,
      stockxOrderNumber: true,
      stockxStatus: true,
      stockxLatestEstimatedDelivery: true,
      stockxEstimatedDelivery: true,
    },
  });
  if (!row) throw new Error(`No StockX OrderMatch for ${name}`);
  return {
    id: row.id,
    shopifyOrderName: row.shopifyOrderName,
    stockxOrderNumber: row.stockxOrderNumber,
    stockxStatus: row.stockxStatus,
    etaEnd: row.stockxLatestEstimatedDelivery || row.stockxEstimatedDelivery,
  };
}

function kindsToSend(kindArg?: string): Array<Exclude<DelayNarrativeKind, "CANCEL_NO_REBUY">> {
  if (kindArg === "delay") return ["SUPPLIER_CHANGE_DELAY"];
  if (kindArg === "cancel-rebuy" || kindArg === "cancel_rebuy") return ["CANCEL_REBUY_LEGIT"];
  return ["SUPPLIER_CHANGE_DELAY", "CANCEL_REBUY_LEGIT"];
}

async function main() {
  const dryRun = hasFlag("dry-run");
  const to =
    (process.env.STOCKX_ALERT_EMAIL || "").trim() ||
    (process.env.POSTMARK_OVERRIDE_TO || "").trim();
  if (!to && !dryRun) {
    throw new Error("STOCKX_ALERT_EMAIL (or POSTMARK_OVERRIDE_TO) required for TEST send");
  }
  if (!process.env.POSTMARK_SERVER_TOKEN?.trim() && !dryRun) {
    throw new Error("POSTMARK_SERVER_TOKEN missing");
  }

  const match = await resolveMatchId(arg("order"));
  const kinds = kindsToSend(arg("kind"));

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "TEST",
        to: to || null,
        order: match.shopifyOrderName,
        stockx: match.stockxOrderNumber,
        status: match.stockxStatus,
        etaEnd: match.etaEnd?.toISOString() ?? null,
        kinds,
      },
      null,
      2
    )
  );

  if (dryRun) {
    const c = await buildDelayRebuyCase(match.id);
    console.log(
      JSON.stringify(
        {
          customerEmail: c.customerEmail,
          rebuyLane: c.rebuyLane,
          announceEta: {
            start: c.announceEtaStart.toISOString(),
            end: c.announceEtaEnd.toISOString(),
          },
          rebuyEta: {
            start: c.rebuyEtaStart.toISOString(),
            end: c.rebuyEtaEnd.toISOString(),
          },
          daysPastEta: c.daysPastEta,
          precheck: c.precheck.status,
        },
        null,
        2
      )
    );
    return;
  }

  for (const kind of kinds) {
    const res = await sendCustomerDelayMail({
      orderMatchId: match.id,
      kind,
      toOverride: to,
      testMode: true,
      force: true,
    });
    console.log(
      JSON.stringify(
        {
          kind: res.kind,
          ok: res.ok,
          sent: res.sent,
          skipped: res.skipped,
          reason: res.reason,
          error: res.error,
          to: res.to,
          order: res.shopifyOrderName,
          etaLine: res.etaLine,
          providerMessageId: res.providerMessageId,
        },
        null,
        2
      )
    );
    if (!res.ok) process.exitCode = 1;
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
