import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const gtins = ['1150500','4550457960007','888407326745','6941428241450','4067892055781','7615537299785','4068807161528','4066755585779','4067889011622','4066758977373','6942179514114','4067907605550','4067979220392','198726908486']

async function main() {
  // Check KickDBVariant with product join
  const kv = await (prisma as any).kickDBVariant.findMany({
    where: { OR: [{ gtin: { in: gtins } }, { ean: { in: gtins } }] },
    select: { 
      gtin: true, ean: true, sizeEu: true,
      product: { select: { urlKey: true, styleId: true, name: true } }
    }
  })
  console.log('KickDBVariant with product data:')
  kv.forEach((k: any) => {
    const matchedGtin = gtins.find(g => g === k.gtin || g === k.ean)
    console.log(`  scan=${matchedGtin} gtin=${k.gtin} ean=${k.ean} urlKey=${k.product?.urlKey} styleId=${k.product?.styleId}`)
  })

  // Check STX SupplierVariant
  const svIds = await prisma.supplierVariant.findMany({
    where: { gtin: { in: gtins }, supplierVariantId: { startsWith: 'stx_' } },
    select: { gtin: true, supplierSku: true, supplierVariantId: true }
  })
  console.log('\nSTX SupplierVariant (stx_ prefix only):')
  svIds.forEach((sv: any) => console.log(`  gtin=${sv.gtin} sku=${sv.supplierSku} id=${sv.supplierVariantId}`))

  // GTINs missing from everything
  const foundGtins = new Set([
    ...kv.map((k: any) => k.gtin).filter(Boolean),
    ...kv.map((k: any) => k.ean).filter(Boolean),
    ...svIds.map((sv: any) => sv.gtin).filter(Boolean),
  ])
  const missingGtins = gtins.filter(g => !foundGtins.has(g))
  console.log('\nGTINs missing from KickDB+SupplierVariant:', missingGtins)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
