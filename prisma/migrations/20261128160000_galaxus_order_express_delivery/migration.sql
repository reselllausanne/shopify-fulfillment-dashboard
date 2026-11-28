-- Orders already promised on the 48h route this week (arrival by 6 Dec, gap <= 5 days).
-- Later short lead times are not express unless the offer is on route 7609999696817 at ingest.
ALTER TABLE "GalaxusOrder" ADD COLUMN "expressDelivery" BOOLEAN NOT NULL DEFAULT false;

UPDATE "GalaxusOrder" o
SET "expressDelivery" = true
WHERE o."orderDate" >= TIMESTAMP '2026-11-20 00:00:00'
  AND EXISTS (
    SELECT 1
    FROM "GalaxusOrderLine" l
    WHERE l."orderId" = o.id
      AND l."arrivalDateEnd" IS NOT NULL
      AND l."arrivalDateEnd" < TIMESTAMP '2026-12-07 00:00:00'
      AND (l."arrivalDateEnd"::date - o."orderDate"::date) BETWEEN 0 AND 5
  );
