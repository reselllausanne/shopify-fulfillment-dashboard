-- Create Decathlon export run tracking
CREATE TABLE "public"."DecathlonExportRun" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "runId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "success" BOOLEAN NOT NULL DEFAULT false,
  "errorMessage" TEXT,
  "countsJson" JSONB,
  "exclusionsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DecathlonExportRun_pkey" PRIMARY KEY ("id")
);

-- Create Decathlon export file metadata
CREATE TABLE "public"."DecathlonExportFile" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "runId" TEXT NOT NULL,
  "fileType" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "checksum" TEXT,
  "storageUrl" TEXT,
  "publicUrl" TEXT,
  "sizeBytes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DecathlonExportFile_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "DecathlonExportRun_runId_key" ON "public"."DecathlonExportRun"("runId");
CREATE INDEX "DecathlonExportRun_startedAt_idx" ON "public"."DecathlonExportRun"("startedAt");
CREATE INDEX "DecathlonExportFile_runId_idx" ON "public"."DecathlonExportFile"("runId");
CREATE INDEX "DecathlonExportFile_fileType_idx" ON "public"."DecathlonExportFile"("fileType");
CREATE INDEX "DecathlonExportFile_runId_fileType_idx" ON "public"."DecathlonExportFile"("runId", "fileType");

-- Foreign keys
ALTER TABLE "public"."DecathlonExportFile"
ADD CONSTRAINT "DecathlonExportFile_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "public"."DecathlonExportRun"("runId")
ON DELETE CASCADE ON UPDATE CASCADE;
