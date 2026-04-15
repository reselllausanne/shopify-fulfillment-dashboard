-- Decathlon shipments can carry multiple order lines (partial shipments).

-- CreateTable
CREATE TABLE "public"."DecathlonShipmentLine" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecathlonShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DecathlonShipmentLine_shipmentId_idx" ON "public"."DecathlonShipmentLine"("shipmentId");

-- CreateIndex
CREATE INDEX "DecathlonShipmentLine_orderLineId_idx" ON "public"."DecathlonShipmentLine"("orderLineId");

-- AddForeignKey
ALTER TABLE "public"."DecathlonShipmentLine" ADD CONSTRAINT "DecathlonShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "public"."DecathlonShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DecathlonShipmentLine" ADD CONSTRAINT "DecathlonShipmentLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "public"."DecathlonOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
