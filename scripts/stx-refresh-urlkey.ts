/**
 * One-shot: DB lookup + StockX price/stock refresh for a single slug (same logic as stx sync for one product).
 * Usage: npx tsx scripts/stx-refresh-urlkey.ts [urlKey]
 */
import "dotenv/config";

import { prisma } from "../app/lib/prisma";
import { refreshStxProductByUrlKey } from "../galaxus/jobs/stxSync";

const DEFAULT_SLUG = "new-balance-9060-asos-exclusive-beige-brown-leopard-print";

async function main() {
  const slug = (process.argv[2] ?? DEFAULT_SLUG).trim();
  console.log("[stx-refresh-urlkey] slug:", slug);

  const exact = await prisma.kickDBProduct.findMany({
    where: {
      OR: [{ urlKey: slug }, { kickdbProductId: slug }],
    },
    select: {
      kickdbProductId: true,
      urlKey: true,
      name: true,
      notFound: true,
    },
  });
  console.log("[stx-refresh-urlkey] KickDBProduct exact urlKey or id match:", JSON.stringify(exact, null, 2));

  const partial = await prisma.kickDBProduct.findMany({
    where: {
      urlKey: { contains: "9060-asos-exclusive", mode: "insensitive" },
    },
    select: { kickdbProductId: true, urlKey: true, name: true, notFound: true },
    take: 20,
  });
  console.log("[stx-refresh-urlkey] KickDBProduct partial (9060-asos-exclusive):", JSON.stringify(partial, null, 2));

  const result = await refreshStxProductByUrlKey(slug);
  console.log("[stx-refresh-urlkey] refresh result:", JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
