ALTER TABLE "public"."Shipment"
ADD COLUMN "galaxusShippedAt" TIMESTAMP(3);

UPDATE "public"."Shipment"
SET "galaxusShippedAt" = "delrSentAt"
WHERE "galaxusShippedAt" IS NULL AND "delrSentAt" IS NOT NULL;
