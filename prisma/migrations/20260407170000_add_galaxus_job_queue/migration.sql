CREATE TABLE IF NOT EXISTS "public"."GalaxusJobQueue" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "jobType" text NOT NULL,
    "status" text NOT NULL DEFAULT 'PENDING',
    "payloadJson" jsonb,
    "priority" integer NOT NULL DEFAULT 0,
    "attempts" integer NOT NULL DEFAULT 0,
    "maxAttempts" integer NOT NULL DEFAULT 5,
    "lockedAt" timestamp(3),
    "lockedBy" text,
    "startedAt" timestamp(3),
    "finishedAt" timestamp(3),
    "errorMessage" text,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GalaxusJobQueue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GalaxusJobQueue_jobType_status_priority_createdAt_idx"
  ON "public"."GalaxusJobQueue" ("jobType", "status", "priority", "createdAt");

CREATE INDEX IF NOT EXISTS "GalaxusJobQueue_status_idx"
  ON "public"."GalaxusJobQueue" ("status");
