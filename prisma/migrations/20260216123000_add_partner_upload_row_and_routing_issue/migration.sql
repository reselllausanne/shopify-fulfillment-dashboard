-- CreateTable
CREATE TABLE "public"."PartnerUploadRow" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "uploadId" TEXT,
    "partnerId" TEXT,
    "providerKey" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "sizeRaw" TEXT NOT NULL,
    "sizeNormalized" TEXT NOT NULL,
    "rawStock" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL,
    "gtinResolved" TEXT,
    "gtinCandidatesJson" JSONB,
    "errorsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerUploadRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderRoutingIssue" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "orderId" TEXT,
    "orderLineId" TEXT NOT NULL,
    "galaxusOrderId" TEXT,
    "gtin" TEXT,
    "providerKey" TEXT,
    "status" TEXT NOT NULL,
    "rule" TEXT,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderRoutingIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerUploadRow_uploadId_idx" ON "public"."PartnerUploadRow"("uploadId");

-- CreateIndex
CREATE INDEX "PartnerUploadRow_partnerId_idx" ON "public"."PartnerUploadRow"("partnerId");

-- CreateIndex
CREATE INDEX "PartnerUploadRow_providerKey_idx" ON "public"."PartnerUploadRow"("providerKey");

-- CreateIndex
CREATE INDEX "PartnerUploadRow_status_idx" ON "public"."PartnerUploadRow"("status");

-- CreateIndex
CREATE INDEX "PartnerUploadRow_providerKey_sku_sizeNormalized_idx" ON "public"."PartnerUploadRow"("providerKey", "sku", "sizeNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRoutingIssue_orderLineId_key" ON "public"."OrderRoutingIssue"("orderLineId");

-- CreateIndex
CREATE INDEX "OrderRoutingIssue_orderId_idx" ON "public"."OrderRoutingIssue"("orderId");

-- CreateIndex
CREATE INDEX "OrderRoutingIssue_status_idx" ON "public"."OrderRoutingIssue"("status");

-- CreateIndex
CREATE INDEX "OrderRoutingIssue_gtin_idx" ON "public"."OrderRoutingIssue"("gtin");

-- AddForeignKey
ALTER TABLE "public"."PartnerUploadRow" ADD CONSTRAINT "PartnerUploadRow_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "public"."PartnerUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PartnerUploadRow" ADD CONSTRAINT "PartnerUploadRow_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "public"."Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrderRoutingIssue" ADD CONSTRAINT "OrderRoutingIssue_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."GalaxusOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
