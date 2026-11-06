import { lookupScan } from "@/shopify/restock/scanRestockOrchestrator"

const gtins = [
  '4066758977373',  // Adidas Samba Decon - in KickDB + SV
  '4066755585779',  // Adidas Campus - in KickDB via EAN only
  '6941428241450',  // Onitsuka Tiger - in KickDB via EAN only
  '7615537299785',  // On Running - in SV only (no KickDB by gtin)
  '1150500',        // Truly absent
  '198726908486',   // Truly absent
]

async function main() {
  for (const gtin of gtins) {
    try {
      console.time(gtin)
      const result = await lookupScan(gtin)
      console.timeEnd(gtin)
      console.log(`${gtin} → status=${result.status}`, 
        result.status === 'not-found' ? `msg=${result.message}` :
        result.status === 'resolved' ? `slug=${result.slug}` :
        result.status === 'on-shopify' ? `sku=${result.variant?.sku}` :
        result.status === 'shopify-exists-no-gtin' ? `pid=${result.productId} slug=${result.slug}` : ''
      )
    } catch (e: any) {
      console.log(`${gtin} → THREW: ${e.message}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
