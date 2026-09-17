/**
 * Dry-run audit: recent STX supplier updates → HALF formula breakdown.
 * Never writes Shopify prices. Manual overrides / fixed hoodies are flagged.
 *
 *   npx tsx scripts/audit-shopify-pricing-half.ts
 *   npx tsx scripts/audit-shopify-pricing-half.ts --limit=10
 */
import "dotenv/config";
import { prisma } from "../app/lib/prisma";
import { deriveStockxRawAskFromStoredBuyPrice } from "../galaxus/pricing/suggestedSellPrice";
import {
  ESSENTIALS_HOODIE_SELL_CHF,
  resolveInStockFixedPriceRule,
} from "../shopify/inventory/inStockFixedPrice";
import {
  explainShopifySellPrice,
  type ShopifyPricingRule,
} from "../shopify/pricing/calcShopifySellPrice";

type Row = {
  gtin: string | null;
  sku: string | null;
  title: string | null;
  brand: string | null;
  buyPrice: number | null;
  standardBuy: number | null;
  expressBuy: number | null;
  updatedAt: Date;
  manualLock: boolean;
  manualPrice: number | null;
  manualNote: string | null;
  shopifyProductId: string | null;
  shopifyHandle: string | null;
  channelPrice: number | null;
  channelUpdatedAt: Date | null;
};

function parseLimit(argv: string[]): number {
  for (const a of argv) {
    if (a.startsWith("--limit=")) {
      const n = Number.parseInt(a.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) return Math.min(n, 100);
    }
  }
  return 10;
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number(n).toFixed(2);
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      sv."gtin"                         AS gtin,
      sv."supplierSku"                  AS sku,
      sv."supplierProductName"          AS title,
      sv."supplierBrand"                AS brand,
      sv."price"::float8                AS "buyPrice",
      sv."standardBuyPrice"::float8     AS "standardBuy",
      sv."expressBuyPrice"::float8      AS "expressBuy",
      sv."updatedAt"                    AS "updatedAt",
      COALESCE(sv."manualLock", false)  AS "manualLock",
      sv."manualPrice"::float8          AS "manualPrice",
      sv."manualNote"                   AS "manualNote",
      cls."externalProductId"           AS "shopifyProductId",
      kp."shopifyHandle"                AS "shopifyHandle",
      cls."lastPushedPrice"::float8     AS "channelPrice",
      cls."updatedAt"                   AS "channelUpdatedAt"
    FROM "public"."SupplierVariant" sv
    LEFT JOIN LATERAL (
      SELECT
        c."externalProductId",
        c."lastPushedPrice",
        c."updatedAt"
      FROM "public"."ChannelListingState" c
      WHERE c."supplierVariantId" = sv."supplierVariantId"
        AND c."channel" = 'SHOPIFY'
      ORDER BY c."updatedAt" DESC NULLS LAST
      LIMIT 1
    ) cls ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(ss."shopifyHandle", kp."urlKey") AS "shopifyHandle"
      FROM "public"."KickDBVariant" kv
      JOIN "public"."KickDBProduct" kp ON kp."id" = kv."productId"
      LEFT JOIN "public"."ShopifySyncState" ss ON ss."kickdbProductId" = kp."kickdbProductId"
      WHERE sv."gtin" IS NOT NULL
        AND (
          kv."gtin" = sv."gtin"
          OR kv."gtin" = ltrim(sv."gtin", '0')
        )
      ORDER BY kp."updatedAt" DESC NULLS LAST
      LIMIT 1
    ) kp ON true
    WHERE sv."supplierVariantId" LIKE 'stx_%'
      AND sv."price" IS NOT NULL
      AND sv."price" > 0
    ORDER BY sv."updatedAt" DESC
    LIMIT ${limit}
  `;

  const examples: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const fixed = resolveInStockFixedPriceRule({
      productId: row.shopifyProductId,
      sku: row.sku,
      title: row.title,
    });

    const buyForCalc = Number(row.standardBuy ?? row.buyPrice);
    const stockxRaw =
      deriveStockxRawAskFromStoredBuyPrice(buyForCalc, {
        slug: row.shopifyHandle,
        urlKey: row.shopifyHandle,
        name: row.title,
      }) ?? buyForCalc;

    let rule: ShopifyPricingRule = "half";
    let override: number | null = null;
    let calculated: number | null = null;
    let costChf: number | null = null;
    let costPlusShip: number | null = null;
    let cpaCap: number | null = null;
    let source = "calcShopifySellPrice/HALF";

    if (fixed?.sellChf != null) {
      rule = "manual_override";
      override = fixed.sellChf;
      calculated = fixed.sellChf;
      source = `inStockFixedPrice:${fixed.label}`;
    } else if (row.manualLock && row.manualPrice != null && Number(row.manualPrice) > 0) {
      rule = "manual_override";
      override = Number(row.manualPrice);
      calculated = override;
      source = `SupplierVariant.manualLock (${row.manualNote ?? "no note"})`;
    } else {
      const explained = explainShopifySellPrice({
        stockxRaw,
        productHandle: row.shopifyHandle,
        productName: row.title,
        brand: row.brand,
        productCategory: "sneakers",
      });
      rule = explained.rule;
      calculated = explained.calculatedSell;
      costChf = explained.costChf;
      costPlusShip = explained.costPlusShip;
      cpaCap = explained.cpaCap;
      source = `calcShopifySellPrice/${explained.rule.toUpperCase()}`;
    }

    examples.push({
      gtin: row.gtin,
      sku: row.sku,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
      stockxBuyChf: buyForCalc,
      stockxRawAskChf: Math.round(stockxRaw * 100) / 100,
      costChf,
      costPlusShip,
      rule,
      cpaCap,
      calculatedSellChf: calculated,
      lastPushedShopifyChf: row.channelPrice,
      overrideChf: override,
      source,
      hoodie129Guard:
        fixed?.sellChf === ESSENTIALS_HOODIE_SELL_CHF
          ? `OK fixed ${ESSENTIALS_HOODIE_SELL_CHF}`
          : null,
    });
  }

  console.log(JSON.stringify({ limit, formula: "half-only (CPA 24)", examples }, null, 2));

  console.log("\n--- table ---");
  console.log(
    [
      "updatedAt",
      "rule",
      "buy",
      "rawAsk",
      "cost+ship",
      "calc",
      "override",
      "pushed",
      "source",
      "title",
    ].join("\t")
  );
  for (const e of examples) {
    console.log(
      [
        String(e.updatedAt).slice(0, 19),
        e.rule,
        money(e.stockxBuyChf as number),
        money(e.stockxRawAskChf as number),
        money(e.costPlusShip as number | null),
        money(e.calculatedSellChf as number | null),
        money(e.overrideChf as number | null),
        money(e.lastPushedShopifyChf as number | null),
        e.source,
        String(e.title ?? "").slice(0, 48),
      ].join("\t")
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
