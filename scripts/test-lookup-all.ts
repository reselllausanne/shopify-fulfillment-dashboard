import { lookupScan } from "@/shopify/restock/scanRestockOrchestrator"

const gtins = ['1150500','4550457960007','888407326745','6941428241450','4067892055781','7615537299785','4068807161528','4066755585779','4067889011622','4066758977373','6942179514114','4067907605550','4067979220392','198726908486']

async function main() {
  for (const gtin of gtins) {
    try {
      const result = await lookupScan(gtin)
      const extra = result.status === 'not-found' ? '' :
        result.status === 'on-shopify' ? ` sku=${result.variant?.sku}` :
        result.status === 'resolved' ? ` slug=${result.slug}` :
        result.status === 'shopify-exists-no-gtin' ? ` slug=${result.slug} confirmed=${result.gtinConfirmed}` : ''
      console.log(`${gtin} → ${result.status}${extra}`)
    } catch (e: any) {
      console.log(`${gtin} → ERROR: ${e.message}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
