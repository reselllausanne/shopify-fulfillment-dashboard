import { prismaDirect } from "@/app/lib/prisma";
import { extractKickdbClassificationSignals } from "@/galaxus/kickdb/classificationSignals";
import { classifyGalaxusProductKind, requiresGalaxusSizeSpec } from "@/galaxus/exports/productClassification";

async function main() {
  const ids = ["STX_405500202303", "STX_196969706647", "STX_198322538377", "WEL_655471893943"];
  for (const pk of ids) {
    const m = await prismaDirect.variantMapping.findFirst({
      where: { providerKey: pk },
      include: { supplierVariant: true, kickdbVariant: { include: { product: true } } },
    });
    const v = m?.supplierVariant;
    const p = m?.kickdbVariant?.product;
    const sig = extractKickdbClassificationSignals(p?.rawJson);
    const kindNoBc = classifyGalaxusProductKind({
      title: v?.supplierProductName,
      brand: v?.supplierBrand ?? p?.brand,
      sizeRaw: v?.sizeRaw,
    });
    const kind = classifyGalaxusProductKind({
      title: v?.supplierProductName,
      brand: v?.supplierBrand ?? p?.brand,
      breadcrumbAliases: sig.breadcrumbAliases,
      productType: sig.productType,
      sizeRaw: v?.sizeRaw,
    });
    console.log("---", pk);
    console.log("title:", v?.supplierProductName?.slice(0, 70));
    console.log("sizeRaw:", v?.sizeRaw);
    console.log("aliases:", sig.breadcrumbAliases.join(" > ") || "(none)");
    console.log("kind without bc:", kindNoBc, "needsSize:", requiresGalaxusSizeSpec(kindNoBc));
    console.log("kind with bc:", kind, "needsSize:", requiresGalaxusSizeSpec(kind));
  }
}

main().finally(() => process.exit(0));
