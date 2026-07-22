import { prismaDirect } from "@/app/lib/prisma";

async function main() {
  const rows = await prismaDirect.supplierVariant.findMany({
    where: {
      OR: [
        { supplierBrand: { contains: "ugg", mode: "insensitive" } },
        { supplierProductName: { contains: " ugg ", mode: "insensitive" } },
      ],
    },
    select: { supplierVariantId: true, supplierBrand: true, supplierProductName: true, sizeRaw: true },
    take: 30,
  });
  console.log("UGG-like rows:", rows.length);
  for (const r of rows) {
    console.log(r.supplierVariantId.slice(0, 4), r.supplierBrand, "|", r.supplierProductName?.slice(0, 70), "|", r.sizeRaw);
  }
}

main().finally(() => process.exit(0));
