import { PrismaClient, ExpenseType } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // ============================================
  // Seed Expense Categories
  // ============================================
  const categories = [
    // Personal Categories
    { name: 'Food & Dining', type: ExpenseType.PERSONAL },
    { name: 'Transport', type: ExpenseType.PERSONAL },
    { name: 'Entertainment', type: ExpenseType.PERSONAL },
    { name: 'Healthcare', type: ExpenseType.PERSONAL },
    { name: 'Shopping', type: ExpenseType.PERSONAL },
    { name: 'Utilities', type: ExpenseType.PERSONAL },
    { name: 'Rent', type: ExpenseType.PERSONAL },
    { name: 'Insurance', type: ExpenseType.PERSONAL },
    { name: 'Education', type: ExpenseType.PERSONAL },
    { name: 'Gifts', type: ExpenseType.PERSONAL },
    { name: 'Other Personal', type: ExpenseType.PERSONAL },
    
    // Business Categories
    { name: 'Shopify Fees', type: ExpenseType.BUSINESS },
    { name: 'Shipping Costs', type: ExpenseType.BUSINESS },
    { name: 'StockX Purchases', type: ExpenseType.BUSINESS },
    { name: 'Marketing & Ads', type: ExpenseType.BUSINESS },
    { name: 'Business Taxes', type: ExpenseType.BUSINESS },
    { name: 'Software & Tools', type: ExpenseType.BUSINESS },
    { name: 'Packaging Materials', type: ExpenseType.BUSINESS },
    { name: 'Bank Fees', type: ExpenseType.BUSINESS },
    { name: 'Refunds', type: ExpenseType.BUSINESS },
    { name: 'Returns Processing', type: ExpenseType.BUSINESS },
    { name: 'Other Business', type: ExpenseType.BUSINESS },
  ]

  console.log('📂 Creating expense categories...')
  for (const category of categories) {
    const created = await prisma.expenseCategory.upsert({
      where: { name: category.name },
      update: {},
      create: category,
    })
    console.log(`  ✅ ${created.type}: ${created.name}`)
  }

  // ============================================
  // Seed Payment Accounts
  // ============================================
  const accounts = [
    { name: 'Amex', provider: 'American Express', currency: 'CHF' },
    { name: 'UBS Credit Card', provider: 'UBS', currency: 'CHF' },
    { name: 'Cornercard', provider: 'Cornercard', currency: 'CHF' },
    { name: 'Mastercard World Platinium', provider: 'Mastercard', currency: 'CHF' },
    { name: 'TWINT', provider: 'TWINT', currency: 'CHF' },
    { name: 'Cash', provider: 'Cash', currency: 'CHF' },
    { name: 'UBS Bank Account', provider: 'UBS', currency: 'CHF' },
    { name: 'Revolut', provider: 'Revolut', currency: 'CHF' },
    { name: 'Wise', provider: 'Wise', currency: 'CHF' },
    { name: 'Other', provider: 'Other', currency: 'CHF' },
  ]

  console.log('\n💳 Creating payment accounts...')
  for (const account of accounts) {
    const created = await prisma.paymentAccount.upsert({
      where: { name: account.name },
      update: {},
      create: account,
    })
    console.log(`  ✅ ${created.name} (${created.provider})`)
  }

  console.log('\n✅ Seeding completed successfully!')
  console.log('📊 Summary:')
  console.log(`  - ${categories.length} expense categories`)
  console.log(`  - ${accounts.length} payment accounts`)
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

