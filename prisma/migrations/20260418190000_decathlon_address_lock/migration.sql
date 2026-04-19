-- Add address lock flag for Decathlon orders
ALTER TABLE "public"."DecathlonOrder"
ADD COLUMN "recipientAddressLocked" BOOLEAN NOT NULL DEFAULT false;
