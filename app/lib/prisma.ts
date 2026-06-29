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

function createPrismaClient(url?: string) {
  return new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
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
    inventoryEvent?: unknown;
    channelListingState?: unknown;
    orderLineSyncState?: unknown;
    inventorySyncRun?: unknown;
    inventoryReconcileDrift?: unknown;
  };
  return Boolean(
    c.decathlonOrder &&
      c.decathlonShipment &&
      c.decathlonShipmentLine &&
      c.decathlonReturn &&
      c.decathlonReturnLine &&
      c.inventoryEvent &&
      c.channelListingState &&
      c.orderLineSyncState &&
      c.inventorySyncRun &&
      c.inventoryReconcileDrift
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

declare global {
  // eslint-disable-next-line no-var
  var prismaDirect: PrismaClient | undefined;
}

const globalForPrismaDirect = globalThis as typeof globalThis & { prismaDirect?: PrismaClient };

/** Session-mode Postgres for long feed exports (avoids pooler disconnect mid-job). */
function resolvePrismaDirectClient(): PrismaClient {
  const directUrl = process.env.DIRECT_URL?.trim();
  if (!directUrl) {
    return resolvePrismaClient();
  }
  if (process.env.NODE_ENV !== "production" && globalForPrismaDirect.prismaDirect) {
    return globalForPrismaDirect.prismaDirect;
  }
  const client = createPrismaClient(directUrl);
  if (process.env.NODE_ENV !== "production") {
    globalForPrismaDirect.prismaDirect = client;
  }
  return client;
}

const prisma = resolvePrismaClient();
const prismaDirect = resolvePrismaDirectClient();

export { prisma, prismaDirect };

export {};
