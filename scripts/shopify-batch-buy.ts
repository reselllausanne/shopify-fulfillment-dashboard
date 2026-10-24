/**
 * Shopify StockX batch buy (STANDARD lane, sticky-first, fail-fast).
 *
 * Usage:
 *   npx tsx scripts/shopify-batch-buy.ts              # dry-run (default)
 *   npx tsx scripts/shopify-batch-buy.ts --list        # print plan table only
 *   npx tsx scripts/shopify-batch-buy.ts --go          # LIVE Place Order (explicit)
 *
 * Env: STOCKX_PROXY_FILE / STOCKX_PROXY_* required for sticky-first.
 */
import "dotenv/config";
import {
  runShopifyBatchBuy,
  SHOPIFY_BUY_OK_9,
  SHOPIFY_STANDARD_BATCH_13,
  type ShopifyBatchBuyItem,
} from "@/lib/stockxAutoCheckout/shopifyBatchBuy";

function printList() {
  console.log("| # | Title (KickDB) | EU | Ship | Link |");
  console.log("|---|---|---|---|---|");
  const titles: Record<string, string> = {
    "nike-air-max-270-react-eng-watermelon": "Nike Air Max 270 React Eng Watermelon",
    "nike-air-max-plus-triple-black-gs": "Nike Air Max Plus Triple Black (GS)",
    "nike-air-max-pulse-black-grey-laser-blue": "Nike Air Max Pulse Black Grey Laser Blue",
    "adidas-sl-72-rs-grey-cloud-white-crystal-white":
      "adidas SL 72 RS Grey Cloud White Crystal White",
    "nike-dunk-low-retro-khaki-team-red-pearl-white-womens":
      "Nike Dunk Low Retro Khaki Team Red Pearl White (Women's)",
    "adidas-adi-racer-lo-core-black-silver-metallic-womens":
      "adidas Adi Racer Lo Core Black Silver Metallic (Women's)",
    "puma-stewie-4-timeless-womens": "Puma Stewie 4 Timeless (Women's)",
    "adidas-handball-spezial-aurora-ivy-ash-green-womens":
      "adidas Handball Spezial Aurora Ivy Ash Green (Women's)",
    "nike-air-force-1-low-cow-print-field-brown-womens":
      "Nike Air Force 1 '07 Field Brown Gum (Women's)",
    "adidas-la-trainer-weave-triple-black": "adidas LA Trainer Weave Triple Black",
    "saucony-progrid-omni-9-white-black-silver-pink": "Saucony ProGrid Omni 9 Silver Pink",
    "adidas-ultra-boost-4-0-running-white": "adidas Ultra Boost 4.0 Running White",
    "supreme-backpack-ss26-red-camo": "Supreme Logo Backpack (SS26) Red Camo",
  };
  for (const item of SHOPIFY_STANDARD_BATCH_13) {
    const num = item.orderName.replace("#", "");
    const title = titles[item.slug] || item.slug;
    const link = `https://stockx.com/fr-fr/${item.slug}`;
    console.log(`| ${num} | ${title} | ${item.sizeEU} | STANDARD | ${link} |`);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--list") || args.has("-l")) {
    printList();
    return;
  }

  const confirmLive = args.has("--go") || args.has("--live");
  if (confirmLive) {
    console.warn("[SHOPIFY-BATCH-BUY] LIVE mode — will Place Order on easy path");
  } else {
    console.log("[SHOPIFY-BATCH-BUY] dry-run (pass --go for live)");
  }

  const want9 = args.has("--buy-ok-9") || args.has("--9");
  let items: ShopifyBatchBuyItem[] = want9 ? SHOPIFY_BUY_OK_9 : SHOPIFY_STANDARD_BATCH_13;
  const ordersArg = [...args].find((a) => a.startsWith("--orders="));
  if (ordersArg) {
    const want = new Set(
      ordersArg
        .slice("--orders=".length)
        .split(",")
        .map((s) => s.trim().replace(/^#/, ""))
        .filter(Boolean)
    );
    items = items.filter((i) => want.has(i.orderName.replace(/^#/, "")));
    if (!items.length) {
      // Allow orders from BUY_OK_9 even when default cohort is BATCH_13
      items = SHOPIFY_BUY_OK_9.filter((i) => want.has(i.orderName.replace(/^#/, "")));
    }
    if (!items.length) {
      console.error(`[SHOPIFY-BATCH-BUY] --orders matched nothing: ${[...want].join(",")}`);
      process.exit(2);
    }
  }
  console.log(
    `[SHOPIFY-BATCH-BUY] items=${items.length} cohort=${want9 ? "BUY_OK_9" : "BATCH_13"} orders=${items
      .map((i) => i.orderName)
      .join(",")}`
  );

  const summary = await runShopifyBatchBuy({
    items,
    dryRun: !confirmLive,
    confirmLive,
  });

  console.log(JSON.stringify(summary, null, 2));
  const fatal = summary.aborted > 0 && summary.bought === 0 && summary.needsHuman === 0;
  process.exit(fatal ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
