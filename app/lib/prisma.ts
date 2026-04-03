import { PrismaClient } from "@prisma/client";

/**
 * Prisma Client singleton
 * Prevents multiple instances in development (hot reload)
 */

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const globalForPrisma = globalThis as typeof globalThis & { prisma?: PrismaClient };

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

/**
 * After `prisma generate`, Next.js dev / HMR can keep a PrismaClient from an older bundle
 * that does not expose newer models — then `prisma.decathlonOrder` is undefined and
 * `.upsert` throws. Drop that cached instance in non-production and create a fresh client.
 */
function resolvePrismaClient(): PrismaClient {
  if (process.env.NODE_ENV !== "production" && globalForPrisma.prisma) {
    const cached = globalForPrisma.prisma as { decathlonOrder?: unknown };
    if (!cached.decathlonOrder) {
      void globalForPrisma.prisma.$disconnect().catch(() => {});
      globalForPrisma.prisma = undefined;
    }
  }

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }

  return globalForPrisma.prisma;
}

const prisma = resolvePrismaClient();

export { prisma };

export {};
