ALTER TABLE "public"."SupplierVariant"
ADD COLUMN "sourceImageUrl" TEXT,
ADD COLUMN "hostedImageUrl" TEXT,
ADD COLUMN "imageSyncStatus" TEXT,
ADD COLUMN "imageVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "imageLastSyncedAt" TIMESTAMP WITH TIME ZONE,
ADD COLUMN "imageSyncError" TEXT;
