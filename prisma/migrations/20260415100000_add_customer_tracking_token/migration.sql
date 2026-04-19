-- AlterTable
ALTER TABLE "public"."OrderMatch" ADD COLUMN IF NOT EXISTS "customerTrackingToken" TEXT;

-- CreateIndex (unique, nullable-safe in Postgres: multiple NULLs allowed)
CREATE UNIQUE INDEX IF NOT EXISTS "OrderMatch_customerTrackingToken_key" ON "public"."OrderMatch"("customerTrackingToken");
