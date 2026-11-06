import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const gtins = ['1150500','4550457960007','888407326745','6941428241450','4067892055781','7615537299785','4068807161528','4066755585779','4067889011622','4066758977373','6942179514114','4067907605550','4067979220392','198726908486']

async function main() {
  const sv = await prisma.supplierVariant.findMany({
    where: { gtin: { in: gtins } },
    select: { gtin: true, supplierSku: true, supplierProductName: true, supplierVariantId: true }
  })
  console.log('SupplierVariant hits:', JSON.stringify(sv, null, 2))

  const kv = await (prisma as any).kickDBVariant.findMany({
    where: { OR: [{ gtin: { in: gtins } }, { ean: { in: gtins } }] },
    select: { gtin: true, ean: true, productId: true, sizeEu: true }
  })
  console.log('KickDBVariant hits:', JSON.stringify(kv, null, 2))

  const shopv = await prisma.shopifyVariant.findMany({
    where: { barcode: { in: gtins } },
    select: { barcode: true, sku: true, productTitle: true }
  })
  console.log('ShopifyVariant hits:', JSON.stringify(shopv, null, 2))

  // Also check with GTIN-14 padding (prepend 0) for 13-digit GTINs
  const padded = gtins.filter(g => g.length === 13).map(g => '0' + g)
  const svPadded = await prisma.supplierVariant.findMany({
    where: { gtin: { in: padded } },
    select: { gtin: true, supplierSku: true, supplierProductName: true }
  })
  console.log('SupplierVariant padded hits:', JSON.stringify(svPadded, null, 2))

  const shopvPadded = await prisma.shopifyVariant.findMany({
    where: { barcode: { in: padded } },
    select: { barcode: true, sku: true, productTitle: true }
  })
  console.log('ShopifyVariant padded hits:', JSON.stringify(shopvPadded, null, 2))

  // Check all candidates for 12-digit GTINs (prepend 0 to get EAN-13)
  const twelveDigit = gtins.filter(g => g.length === 12)
  const twelve_padded = twelveDigit.map(g => '0' + g)
  const svTwelve = await prisma.shopifyVariant.findMany({
    where: { barcode: { in: [...twelveDigit, ...twelve_padded] } },
    select: { barcode: true, sku: true, productTitle: true }
  })
  console.log('ShopifyVariant 12-digit + padded hits:', JSON.stringify(svTwelve, null, 2))

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
