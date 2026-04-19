-- Drop the old unique constraint on galaxusOrderLineId alone
ALTER TABLE "public"."GalaxusStockxMatch" DROP CONSTRAINT IF EXISTS "GalaxusStockxMatch_galaxusOrderLineId_key";

-- Add unitIndex column (default 0 for existing single-unit rows)
ALTER TABLE "public"."GalaxusStockxMatch"
  ADD COLUMN IF NOT EXISTS "unitIndex" integer NOT NULL DEFAULT 0;

-- New composite unique: one match per (line, unit)
CREATE UNIQUE INDEX IF NOT EXISTS "GalaxusStockxMatch_galaxusOrderLineId_unitIndex_key"
  ON "public"."GalaxusStockxMatch" ("galaxusOrderLineId", "unitIndex");
