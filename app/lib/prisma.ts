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

function parseSupplierKeyFromVariantId(supplierVariantId: string | null | undefined): string | null {
  const id = String(supplierVariantId ?? "").trim();
  if (!id) return null;
  const colon = id.indexOf(":");
  const underscore = id.indexOf("_");
  if (colon > 0 && (underscore < 0 || colon < underscore)) return id.slice(0, colon).toLowerCase();
  if (underscore > 0) return id.slice(0, underscore).toLowerCase();
  return null;
}

function applySupplierKey(data: any): any {
  if (!data || typeof data !== "object") return data;
  const supplierVariantId =
    typeof data.supplierVariantId === "string" ? data.supplierVariantId : null;
  if (!supplierVariantId) return data;
  const supplierKey = parseSupplierKeyFromVariantId(supplierVariantId);
  return { ...data, supplierKey };
}

function withVariantMappingSupplierKey(data: any, action: string): any {
  if (!data || typeof data !== "object") return data;
  if (action === "create" || action === "update") {
    return { ...data, data: applySupplierKey(data.data) };
  }
  if (action === "upsert") {
    return {
      ...data,
      create: applySupplierKey(data.create),
      update: applySupplierKey(data.update),
    };
  }
  if (action === "createMany" || action === "updateMany") {
    if (Array.isArray(data.data)) {
      return { ...data, data: data.data.map((item: any) => applySupplierKey(item)) };
    }
    return { ...data, data: applySupplierKey(data.data) };
  }
  return data;
}

/** Prisma 6 removed `$use` middleware — use query extension instead. */
function attachVariantMappingSupplierKeyMiddleware(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      variantMapping: {
        async $allOperations({ args, query, operation }) {
          return query(withVariantMappingSupplierKey(args, operation));
        },
      },
    },
  }) as unknown as PrismaClient;
}

function createPrismaClient(url?: string) {
  const client = new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  return attachVariantMappingSupplierKeyMiddleware(client);
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
    marketplaceReturn?: unknown;
    marketplaceReturnSyncCursor?: unknown;
    inventoryEvent?: unknown;
    channelListingState?: unknown;
    orderLineSyncState?: unknown;
    inventorySyncRun?: unknown;
    inventoryReconcileDrift?: unknown;
    shopifyVariantLocationStock?: unknown;
  };
  return Boolean(
    c.decathlonOrder &&
      c.decathlonShipment &&
      c.decathlonShipmentLine &&
      c.decathlonReturn &&
      c.decathlonReturnLine &&
      c.marketplaceReturn &&
      c.marketplaceReturnSyncCursor &&
      c.inventoryEvent &&
      c.channelListingState &&
      c.orderLineSyncState &&
      c.inventorySyncRun &&
      c.inventoryReconcileDrift &&
      c.shopifyVariantLocationStock
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
