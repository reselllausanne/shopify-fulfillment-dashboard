ALTER TABLE "public"."SupplierVariant"
ADD COLUMN "manualPrice" DECIMAL(10, 2),
ADD COLUMN "manualStock" INTEGER,
ADD COLUMN "manualLock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "manualNote" TEXT,
ADD COLUMN "manualUpdatedAt" TIMESTAMP(3);
