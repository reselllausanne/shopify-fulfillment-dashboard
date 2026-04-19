-- AlterEnum
ALTER TYPE "public"."DecathlonImportFlow" ADD VALUE 'P41';

-- AlterTable
ALTER TABLE "public"."DecathlonOfferSync" ADD COLUMN     "productStatus" TEXT;
ALTER TABLE "public"."DecathlonOfferSync" ADD COLUMN     "productStatusCheckedAt" TIMESTAMP(3);
ALTER TABLE "public"."DecathlonOfferSync" ADD COLUMN     "lastProductSyncAt" TIMESTAMP(3);
