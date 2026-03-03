-- CreateEnum
CREATE TYPE "public"."StxImportSlugStatus" AS ENUM ('PENDING', 'IMPORTED', 'ERROR');

-- CreateTable
CREATE TABLE "public"."StxImportSlug" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3),
    "input" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "public"."StxImportSlugStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,

    CONSTRAINT "StxImportSlug_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StxImportSlug_slug_key" ON "public"."StxImportSlug"("slug");

-- CreateIndex
CREATE INDEX "StxImportSlug_status_createdAt_idx" ON "public"."StxImportSlug"("status", "createdAt");
