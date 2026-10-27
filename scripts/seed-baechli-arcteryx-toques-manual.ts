/**
 * One-shot: seed the 8 Arc'teryx toques from Bächli cart as warehouse stock.
 *
 * Buy ~CHF 59 on Bächli → Galaxus shelf CHF 89 incl VAT
 *   → PurchasePriceExclVat = 89 / 1.081 ≈ 82.33 (manualLock).
 * Stock: 1 each (manualStock + stock).
 *
 *   npx tsx scripts/seed-baechli-arcteryx-toques-manual.ts
 *   npx tsx scripts/seed-baechli-arcteryx-toques-manual.ts --apply
 */
import "dotenv/config";
import { prisma } from "../app/lib/prisma";

const VAT = 0.081;
const SHELF_INCL_CHF = 89;
const MANUAL_PRICE_EXCL = Math.round((SHELF_INCL_CHF / (1 + VAT)) * 100) / 100; // 82.33
const BUY_CHF = 59;
const NOTE =
  "baechli-cart:arcteryx-toque warehouse qty1 lock 89incl→82.33ex 2026-10-27";

type SeedRow = {
  gtin: string;
  sku: string;
  model: string;
  color: string;
  productUrl: string;
  imageUrl: string;
};

/** Cart colorways mapped from Bächli JSON-LD (gtin12 + sku + color). */
const ROWS: SeedRow[] = [
  {
    gtin: "686487948198",
    sku: "109555-003",
    model: "Bird Head Toque",
    color: "orca",
    productUrl:
      "https://www.baechli-bergsport.ch/de/damen/kopfbedeckung/mutzen/arcteryx-109555-bird-head-toque?v1=109555-003",
    imageUrl:
      "https://www.baechli-bergsport.ch/files/v250806064137/Images/shop/Products/109555_orca.jpg",
  },
  {
    gtin: "623555897811",
    sku: "109555-004",
    model: "Bird Head Toque",
    color: "blurple-kasumi",
    productUrl:
      "https://www.baechli-bergsport.ch/de/damen/kopfbedeckung/mutzen/arcteryx-109555-bird-head-toque?v1=109555-004",
    imageUrl:
      "https://www.baechli-bergsport.ch/files/v261021071845/Images/shop/Products/109555_blurple-kasumi.jpg",
  },
  {
    gtin: "623555897859",
    sku: "109555-005",
    model: "Bird Head Toque",
    color: "nucleus-mongoose",
    productUrl:
      "https://www.baechli-bergsport.ch/de/damen/kopfbedeckung/mutzen/arcteryx-109555-bird-head-toque?v1=109555-005",
    imageUrl:
      "https://www.baechli-bergsport.ch/files/v260901064326/Images/shop/Products/109555_nucleus-mongoose.jpg",
  },
  {
    gtin: "623555897309",
    sku: "112687-001",
    model: "Bird Word Toque",
    color: "dark jade-mantis",
    productUrl:
      "https://www.baechli-bergsport.ch/de/damen/kopfbedeckung/mutzen/arcteryx-112687-bird-word-toque?v1=112687-001",
    imageUrl:
      "https://www.baechli-bergsport.ch/files/v261027072744/Images/shop/Products/112687_dark jade-mantis.jpg",
  },
  {
    gtin: "623555897323",
    sku: "112687-002",
    model: "Bird Word Toque",
    color: "mongoose-sea salt",
    productUrl:
      "https://www.baechli-bergsport.ch/de/damen/kopfbedeckung/mutzen/arcteryx-112687-bird-word-toque?v1=112687-002",
    imageUrl:
      "https://www.baechli-bergsport.ch/files/v260909065307/Images/shop/Products/112687_mongoose-sea salt.jpg",
  },
  {
    gtin: "623555897330",
    sku: "112687-003",
    model: "Bird Word Toque",
    color: "orca",
    productUrl:
      "https://www.baechli-bergsport.ch/de/damen/kopfbedeckung/mutzen/arcteryx-112687-bird-word-toque?v1=112687-003",
    imageUrl:
      "https://www.baechli-bergsport.ch/files/v260909065307/Images/shop/Products/112687_orca.jpg",
  },
  {
    gtin: "623555897026",
    sku: "112688-001",
    model: "Grotto Toque",
    color: "black-void",
    productUrl:
      "https://www.baechli-bergsport.ch/de/damen/kopfbedeckung/mutzen/arcteryx-112688-grotto-toque?v1=112688-001",
    imageUrl:
      "https://www.baechli-bergsport.ch/files/v260909065308/Images/shop/Products/112688_black-void.jpg",
  },
  {
    gtin: "623555897033",
    sku: "112688-002",
    model: "Grotto Toque",
    color: "bracken-sea salt",
    productUrl:
      "https://www.baechli-bergsport.ch/de/damen/kopfbedeckung/mutzen/arcteryx-112688-grotto-toque?v1=112688-002",
    imageUrl:
      "https://www.baechli-bergsport.ch/files/v260909065308/Images/shop/Products/112688_bracken-sea salt.jpg",
  },
];

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    `[bae-toques] shelfIncl=${SHELF_INCL_CHF} manualPriceExcl=${MANUAL_PRICE_EXCL} buy=${BUY_CHF} apply=${apply}`
  );

  for (const row of ROWS) {
    const supplierVariantId = `bae_${row.gtin}`;
    const providerKey = `BAE_${row.gtin}`;
    const name = `${row.model} — ${row.color}`;
    const data = {
      supplierVariantId,
      providerKey,
      supplierSku: row.sku,
      gtin: row.gtin,
      supplierBrand: "Arc'teryx",
      supplierProductName: name,
      supplierProductType: "Mützen",
      supplierColorway: row.color,
      supplierGender: "unisex",
      sizeRaw: "one size",
      sizeNormalized: "ONE SIZE",
      price: BUY_CHF,
      stock: 1,
      manualLock: true,
      manualPrice: MANUAL_PRICE_EXCL,
      manualStock: 1,
      manualNote: `${NOTE} url=${row.productUrl}`,
      manualUpdatedAt: new Date(),
      sourceImageUrl: row.imageUrl,
      images: [row.imageUrl],
      leadTimeDays: 2,
      deliveryType: "standard",
      lastSyncAt: new Date(),
    };

    const existing = await prisma.supplierVariant.findUnique({
      where: { supplierVariantId },
      select: {
        supplierVariantId: true,
        manualPrice: true,
        manualLock: true,
        manualStock: true,
        stock: true,
        sizeRaw: true,
        hostedImageUrl: true,
      },
    });

    console.log(
      `${apply ? "UPSERT" : "DRY"} ${supplierVariantId} ${name} gtin=${row.gtin}` +
        (existing
          ? ` (was lock=${existing.manualLock} mp=${existing.manualPrice} stock=${existing.stock}/${existing.manualStock} size=${existing.sizeRaw})`
          : " (new)")
    );

    if (!apply) continue;

    const updatePayload = {
      ...data,
      ...(existing?.hostedImageUrl
        ? { hostedImageUrl: existing.hostedImageUrl }
        : { hostedImageUrl: null as string | null, imageSyncStatus: "PENDING" }),
    };

    await prisma.supplierVariant.upsert({
      where: { supplierVariantId },
      create: {
        ...data,
        hostedImageUrl: null,
        imageSyncStatus: "PENDING",
      },
      update: updatePayload,
    });

    await prisma.variantMapping.upsert({
      where: { supplierVariantId },
      create: {
        supplierVariantId,
        providerKey,
        gtin: row.gtin,
        supplierKey: "bae",
        status: "SUPPLIER_GTIN",
      },
      update: {
        providerKey,
        gtin: row.gtin,
        supplierKey: "bae",
        status: "SUPPLIER_GTIN",
      },
    });
  }

  if (!apply) {
    console.log("[bae-toques] dry-run only. Re-run with --apply to write.");
  } else {
    console.log(`[bae-toques] wrote ${ROWS.length} rows.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
