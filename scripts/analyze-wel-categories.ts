import { prismaDirect } from "@/app/lib/prisma";
import { classifyGalaxusProductKind, resolveGalaxusProductCategoryPath } from "@/galaxus/exports/productClassification";

async function main() {
  const rows = await prismaDirect.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: "wel_" } },
    select: { supplierProductName: true, supplierBrand: true },
    take: 8341,
  });

  const pathCounts = new Map<string, number>();
  let sneakers = 0;
  for (const r of rows) {
    const kind = classifyGalaxusProductKind({
      supplierKey: "wel",
      title: r.supplierProductName,
      brand: r.supplierBrand,
    });
    const path = resolveGalaxusProductCategoryPath({
      supplierKey: "wel",
      title: r.supplierProductName,
      brand: r.supplierBrand,
    });
    if (path.includes("Sneakers")) sneakers += 1;
    pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
  }

  console.log("WEL rows:", rows.length);
  console.log("Still Sneakers path:", sneakers, `(${((sneakers / rows.length) * 100).toFixed(1)}%)`);
  console.log("\nTop paths:");
  for (const [p, n] of [...pathCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`${n}\t${p}`);
  }
}

main().finally(() => process.exit(0));
