/**
 * Applies SupplierVariant manual pricing columns with lock timeout (avoids hanging on pooler/locks).
 * Run: node scripts/apply-manual-pricing-columns.mjs
 * Then: npx prisma migrate resolve --applied "20260226120000_add_supplier_variant_manual_pricing" --schema prisma/schema.prisma
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '30s'`);
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '120s'`);
      await tx.$executeRawUnsafe(`
        ALTER TABLE "public"."SupplierVariant"
        ADD COLUMN IF NOT EXISTS "manualPrice" DECIMAL(10, 2),
        ADD COLUMN IF NOT EXISTS "manualStock" INTEGER,
        ADD COLUMN IF NOT EXISTS "manualLock" BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "manualNote" TEXT,
        ADD COLUMN IF NOT EXISTS "manualUpdatedAt" TIMESTAMP(3);
      `);
    },
    { maxWait: 60000, timeout: 180000 }
  );
  const rows = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'SupplierVariant'
      AND column_name IN ('manualPrice','manualStock','manualLock','manualNote','manualUpdatedAt')
    ORDER BY column_name;
  `;
  console.log("Columns:", rows);
  if (!Array.isArray(rows) || rows.length < 5) {
    throw new Error("Expected 5 columns; check output above.");
  }
  console.log("OK — run: npx prisma migrate resolve --applied \"20260226120000_add_supplier_variant_manual_pricing\" --schema prisma/schema.prisma");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
