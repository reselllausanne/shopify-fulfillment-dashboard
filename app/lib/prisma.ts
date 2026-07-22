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

function isDeadEngineError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return (
    /Response from the Engine was empty/i.test(msg) ||
    /Engine is not yet connected/i.test(msg) ||
    /Prisma Client could not locate the Query Engine/i.test(msg)
  );
}

function resetPrismaClient() {
  if (globalForPrisma.prisma) {
    void globalForPrisma.prisma.$disconnect().catch(() => {});
    globalForPrisma.prisma = undefined;
  }
}

/**
 * Turbopack HMR can kill the Prisma query-engine child process, which then
 * surfaces as "Response from the Engine was empty". Always resolve the live
 * singleton, and on dead-engine errors drop it + retry once.
 */
function withEngineRecovery(): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_t, prop) {
      const client = resolvePrismaClient() as unknown as Record<string | symbol, any>;
      const value = client[prop];
      if (typeof prop === "symbol" || prop === "then") return value;
      if (typeof prop === "string" && prop.startsWith("$")) {
        return typeof value === "function" ? value.bind(client) : value;
      }
      if (!value || typeof value !== "object") return value;

      return new Proxy(value as object, {
        get(modelTarget, method) {
          const fn = (modelTarget as Record<string | symbol, any>)[method];
          if (typeof fn !== "function") return fn;
          return (...args: unknown[]) => {
            const invoke = (model: any, name: string | symbol) => {
              const methodFn = model?.[name];
              if (typeof methodFn !== "function") {
                throw new Error(`Prisma method missing: ${String(prop)}.${String(name)}`);
              }
              return methodFn.apply(model, args);
            };

            try {
              const result = invoke(modelTarget, method);
              if (result && typeof (result as Promise<unknown>).then === "function") {
                return (result as Promise<unknown>).catch(async (error: unknown) => {
                  if (!isDeadEngineError(error)) throw error;
                  console.warn("[PRISMA] Engine empty — recreating client, retry once", {
                    model: String(prop),
                    method: String(method),
                  });
                  resetPrismaClient();
                  const fresh = resolvePrismaClient() as unknown as Record<string, any>;
                  return invoke(fresh[String(prop)], method);
                });
              }
              return result;
            } catch (error) {
              if (!isDeadEngineError(error)) throw error;
              console.warn("[PRISMA] Engine empty — recreating client, retry once", {
                model: String(prop),
                method: String(method),
              });
              resetPrismaClient();
              const fresh = resolvePrismaClient() as unknown as Record<string, any>;
              return invoke(fresh[String(prop)], method);
            }
          };
        },
      });
    },
  }) as PrismaClient;
}

const prisma = withEngineRecovery();
const prismaDirect = resolvePrismaDirectClient();

export { prisma, prismaDirect };

export {};
