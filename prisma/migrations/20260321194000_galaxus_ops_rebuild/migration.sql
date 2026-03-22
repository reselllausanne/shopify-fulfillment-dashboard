-- Add ORDR status fields
ALTER TABLE "public"."GalaxusOrder"
ADD COLUMN "ingestedAt" TIMESTAMP(3),
ADD COLUMN "ordrStatus" TEXT,
ADD COLUMN "ordrLastAttemptAt" TIMESTAMP(3),
ADD COLUMN "ordrLastError" TEXT;

-- Create job definitions
CREATE TABLE "public"."GalaxusJobDefinition" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "jobKey" TEXT NOT NULL,
  "intervalMs" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastRunAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GalaxusJobDefinition_pkey" PRIMARY KEY ("id")
);

-- Create feed runs
CREATE TABLE "public"."GalaxusFeedRun" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "runId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "triggerSource" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "success" BOOLEAN NOT NULL DEFAULT false,
  "errorMessage" TEXT,
  "countsJson" JSONB,
  "manifestIds" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GalaxusFeedRun_pkey" PRIMARY KEY ("id")
);

-- Create feed trigger queue
CREATE TABLE "public"."GalaxusFeedTrigger" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "scope" TEXT NOT NULL,
  "triggerSource" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GalaxusFeedTrigger_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "GalaxusJobDefinition_jobKey_key" ON "public"."GalaxusJobDefinition"("jobKey");
CREATE INDEX "GalaxusFeedRun_runId_idx" ON "public"."GalaxusFeedRun"("runId");
CREATE INDEX "GalaxusFeedRun_scope_startedAt_idx" ON "public"."GalaxusFeedRun"("scope", "startedAt");
CREATE INDEX "GalaxusFeedTrigger_scope_requestedAt_idx" ON "public"."GalaxusFeedTrigger"("scope", "requestedAt");
CREATE INDEX "GalaxusFeedTrigger_status_idx" ON "public"."GalaxusFeedTrigger"("status");

-- Drop legacy scheduler config table
DROP TABLE "public"."GalaxusSchedulerConfig";
