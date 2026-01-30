/**
 * Clear all Shopify orders and Order matches
 * 
 * This script clears:
 * - All ShopifyOrder records (synced Shopify orders)
 * - All OrderMatch records (supplier order matches)
 * 
 * It KEEPS:
 * - Expenses (PersonalExpense)
 * - Ads Spend (DailyAdSpend)
 * - Variable Costs (MonthlyVariableCosts)
 * - StockX tokens
 * - Other configuration data
 * 
 * Usage: npx tsx scripts/clear-orders-and-matches.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🗑️  CLEARING ORDERS AND MATCHES");
  console.log("================================\n");

  // Count records before deletion
  const shopifyOrderCount = await prisma.shopifyOrder.count();
  const orderMatchCount = await prisma.orderMatch.count();

  console.log(`📊 Current records:`);
  console.log(`   - Shopify Orders: ${shopifyOrderCount}`);
  console.log(`   - Order Matches: ${orderMatchCount}\n`);

  if (shopifyOrderCount === 0 && orderMatchCount === 0) {
    console.log("✅ Database is already empty. Nothing to clear.");
    return;
  }

  // Confirmation prompt (for safety)
  console.log("⚠️  WARNING: This will delete ALL Shopify orders and order matches!");
  console.log("   This action cannot be undone.\n");

  // In a script, we'll proceed (you can add readline if you want interactive confirmation)
  console.log("🗑️  Deleting records...\n");

  try {
    // Delete in correct order (matches first, then orders)
    console.log("1️⃣  Deleting Order Matches...");
    const deletedMatches = await prisma.orderMatch.deleteMany({});
    console.log(`   ✅ Deleted ${deletedMatches.count} order matches\n`);

    console.log("2️⃣  Deleting Shopify Orders...");
    const deletedOrders = await prisma.shopifyOrder.deleteMany({});
    console.log(`   ✅ Deleted ${deletedOrders.count} Shopify orders\n`);

    console.log("✅ CLEAR COMPLETE!");
    console.log("================================\n");
    console.log("📊 Summary:");
    console.log(`   - Deleted ${deletedMatches.count} order matches`);
    console.log(`   - Deleted ${deletedOrders.count} Shopify orders\n`);
    console.log("🔄 Next steps:");
    console.log("   1. Go to /dashboard");
    console.log("   2. Click '🔄 Sync Orders (From Jan 1)' to sync Shopify orders");
    console.log("   3. Run your supplier sync to match orders");
    console.log("\n✨ Database is now clean and ready for fresh sync!");

  } catch (error: any) {
    console.error("❌ Error clearing database:", error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

