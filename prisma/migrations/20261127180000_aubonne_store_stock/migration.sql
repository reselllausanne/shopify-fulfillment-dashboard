CREATE TABLE "AubonneStoreStock" (
    "styleColor" TEXT NOT NULL,
    "gtin" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "nikeModifiedAt" TIMESTAMP(3),
    "name" TEXT,
    "imageUrl" TEXT,
    "sizeEu" TEXT,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AubonneStoreStock_pkey" PRIMARY KEY ("styleColor","gtin")
);

CREATE INDEX "AubonneStoreStock_level_idx" ON "AubonneStoreStock"("level");
CREATE INDEX "AubonneStoreStock_lastCheckedAt_idx" ON "AubonneStoreStock"("lastCheckedAt");

CREATE TABLE "AubonneScanState" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "found" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AubonneScanState_pkey" PRIMARY KEY ("id")
);
