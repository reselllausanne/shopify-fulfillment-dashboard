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
 * `.upsert` throws. Same for Decathlon shipment tables added later.
 * Drop that cached instance in non-production and create a fresh client.
 */
function prismaClientLooksCurrent(client: PrismaClient): boolean {
  const c = client as unknown as {
    decathlonOrder?: unknown;
    decathlonShipment?: unknown;
    decathlonShipmentLine?: unknown;
    decathlonReturn?: unknown;
    decathlonReturnLine?: unknown;
  };
  return Boolean(
    c.decathlonOrder &&
      c.decathlonShipment &&
      c.decathlonShipmentLine &&
      c.decathlonReturn &&
      c.decathlonReturnLine
  );
}

function resolvePrismaClient(): PrismaClient {
  if (process.env.NODE_ENV !== "production" && globalForPrisma.prisma) {
    if (!prismaClientLooksCurrent(globalForPrisma.prisma)) {
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
