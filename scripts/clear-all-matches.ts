/**
 * Clear all OrderMatch records from the database
 * 
 * USE WITH CAUTION: This will delete ALL existing matches!
 * After running this, you'll need to re-sync orders to get fresh data with correct dates.
 * 
 * Run with: npx tsx scripts/clear-all-matches.ts
 */

import { PrismaClient } from '@prisma/client';
import * as readline from 'readline';

const prisma = new PrismaClient();

async function askConfirmation(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('\n⚠️  WARNING: This will DELETE ALL order matches!\n\nAre you sure? Type "yes" to confirm: ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

async function main() {
  console.log('🗑️  Order Match Deletion Script\n');
  
  // Count existing records
  const count = await prisma.orderMatch.count();
  
  if (count === 0) {
    console.log('✅ Database is already empty. No matches to delete.');
    return;
  }
  
  console.log(`📊 Found ${count} order matches in the database`);
  
  // Ask for confirmation
  const confirmed = await askConfirmation();
  
  if (!confirmed) {
    console.log('\n❌ Deletion cancelled. No changes made.');
    return;
  }
  
  console.log('\n🔄 Deleting all order matches...');
  
  try {
    const result = await prisma.orderMatch.deleteMany({});
    
    console.log(`\n✅ Successfully deleted ${result.count} order matches!`);
    console.log('\n📝 Next steps:');
    console.log('  1. Go to http://localhost:3000');
    console.log('  2. Click "Sync Orders" to re-match with fresh data');
    console.log('  3. New matches will have correct stockxPurchaseDate from StockX API');
    console.log('\n✨ Your dashboard will then show accurate date-based reporting!\n');
    
  } catch (error) {
    console.error('\n❌ Error deleting matches:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error('❌ Script failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

