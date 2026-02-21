-- CreateTable
CREATE TABLE "public"."GalaxusSchedulerConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GalaxusSchedulerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GalaxusJobRun" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "runId" TEXT,
    "supplierKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GalaxusJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GalaxusExportManifest" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "exportType" TEXT NOT NULL,
    "supplierKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "productCount" INTEGER NOT NULL,
    "checksum" TEXT,
    "storagePointer" TEXT,
    "destination" TEXT,
    "uploadStatus" TEXT NOT NULL,
    "responseJson" JSONB,
    "validationIssuesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GalaxusExportManifest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GalaxusJobRun_jobName_startedAt_idx" ON "public"."GalaxusJobRun"("jobName", "startedAt");

-- CreateIndex
CREATE INDEX "GalaxusJobRun_runId_idx" ON "public"."GalaxusJobRun"("runId");

-- CreateIndex
CREATE INDEX "GalaxusExportManifest_runId_idx" ON "public"."GalaxusExportManifest"("runId");

-- CreateIndex
CREATE INDEX "GalaxusExportManifest_exportType_idx" ON "public"."GalaxusExportManifest"("exportType");
