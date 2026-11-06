import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const gtins = ['1150500','4550457960007','888407326745','6941428241450','4067892055781','7615537299785','4068807161528','4066755585779','4067889011622','4066758977373','6942179514114','4067907605550','4067979220392','198726908486']

async function main() {
  const svls = await prisma.shopifyVariantLocationStock.findMany({
    where: { gtin: { in: gtins } },
    select: { gtin: true, sku: true, shopifyVariantId: true, locationName: true, available: true },
    distinct: ['shopifyVariantId']
  })
  console.log('ShopifyVariantLocationStock hits:')
  svls.forEach((s: any) => console.log(`  gtin=${s.gtin} sku=${s.sku} variantId=${s.shopifyVariantId} loc=${s.locationName} avail=${s.available}`))
  
  const missingGtins = gtins.filter(g => !svls.some((s: any) => s.gtin === g))
  console.log('\nMissing from SVLS:', missingGtins)
  
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
