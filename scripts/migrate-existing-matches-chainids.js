/**
 * Script de migration ONE-TIME pour mettre à jour les matches existants
 * avec chainId/orderId depuis le prochain sync StockX.
 * 
 * COMMENT UTILISER:
 * 1. Sur l'UI, cliquez "Load Supplier Orders" (cela va fetch avec chainId/orderId)
 * 2. AVANT de confirmer les matches, run ce script:
 *    node scripts/migrate-existing-matches-chainids.js
 * 3. Le script va lire les supplier orders en cache et mettre à jour les matches
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrateMatchesFromCache() {
  console.log("🔄 MIGRATION: Mise à jour chainId/orderId depuis cache\n");
  
  try {
    // 1. Trouver tous les matches sans chainId
    const matchesNeedingUpdate = await prisma.orderMatch.findMany({
      where: {
        supplierSource: "STOCKX",
        stockxChainId: null,
        stockxOrderNumber: { not: "" }
      },
      select: {
        id: true,
        stockxOrderNumber: true,
        shopifyOrderName: true,
      }
    });
    
    console.log(`📊 Trouvé ${matchesNeedingUpdate.length} matches sans chainId\n`);
    
    if (matchesNeedingUpdate.length === 0) {
      console.log("✅ Tous les matches ont déjà un chainId!");
      await prisma.$disconnect();
      return;
    }
    
    // 2. Créer un mapping orderNumber -> IDs
    // Ces valeurs viennent de la réponse StockX que vous avez partagée
    const knownOrders = {
      "03-D4HM9J5R71": {
        chainId: "14830299582160227660",
        orderId: "03-D4HM9J5R71"
      },
      "03-ZNUW6705TP": {
        chainId: "14830299582160227660", // À compléter avec la vraie valeur
        orderId: "03-ZNUW6705TP"
      },
      // Ajoutez vos autres orders ici depuis la réponse StockX...
    };
    
    let updated = 0;
    let notFound = 0;
    
    for (const match of matchesNeedingUpdate) {
      const orderData = knownOrders[match.stockxOrderNumber];
      
      if (!orderData) {
        console.log(`⚠️ ${match.stockxOrderNumber} - Pas dans le cache (skip)`);
        notFound++;
        continue;
      }
      
      // Update le match
      await prisma.orderMatch.update({
        where: { id: match.id },
        data: {
          stockxChainId: orderData.chainId,
          stockxOrderId: orderData.orderId,
        }
      });
      
      console.log(`✅ ${match.shopifyOrderName} (${match.stockxOrderNumber})`);
      console.log(`   chainId: ${orderData.chainId.substring(0, 15)}...`);
      console.log(`   orderId: ${orderData.orderId}\n`);
      
      updated++;
    }
    
    console.log(`\n╔═══════════════════════════════════════════╗`);
    console.log(`║  ✅ MIGRATION COMPLETE!                   ║`);
    console.log(`╚═══════════════════════════════════════════╝\n`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Not Found: ${notFound}\n`);
    
    console.log(`📝 PROCHAINES ÉTAPES:`);
    console.log(`   1. Vérifier sur /dashboard que tracking fonctionne`);
    console.log(`   2. Cliquer "📦 Fetch All Tracking" sur /`);
    console.log(`   3. Les AWB seront récupérés pour ces orders!\n`);
    
    await prisma.$disconnect();
    
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

migrateMatchesFromCache();

