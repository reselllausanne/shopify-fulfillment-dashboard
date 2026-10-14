/**
 * Bulk-operation export of every product variant (price, custom metafields,
 * optional online-location stock). A bulk query costs a handful of points no
 * matter the catalogue size, versus ~50-300 points per product read.
 */
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const BULK_RUN = /* GraphQL */ `
mutation VariantSnapshotBulk($query: String!) {
  bulkOperationRunQuery(query: $query) {
    bulkOperation { id }
    userErrors { message }
  }
}`;

const BULK_NODE = /* GraphQL */ `
query VariantSnapshotBulkPoll($id: ID!) {
  node(id: $id) { ... on BulkOperation { status errorCode url objectCount } }
}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type VariantSnapshot = {
  id: string;
  productId: string;
  price: string | null;
  title: string | null;
  barcode: string | null;
  /** `custom` namespace metafields by key (price_locked, express_price, us_size, …). */
  metafields: Record<string, string | null>;
  inventoryItemId: string | null;
  /** "available" at the requested location; null = not stocked there / not requested. */
  available: number | null;
};

export function buildVariantSnapshotQuery(locationId?: string): string {
  const inventory = locationId
    ? `inventoryItem {
          id
          inventoryLevel(locationId: "${locationId}") {
            quantities(names: ["available"]) { quantity }
          }
        }`
    : "";
  return `{
  productVariants {
    edges {
      node {
        id
        price
        title
        barcode
        product { id }
        ${inventory}
        metafields(namespace: "custom", first: 25) {
          edges { node { key value } }
        }
      }
    }
  }
}`;
}

/** One bulk query per shop/app at a time: wait for the slot when another job holds it. */
export async function startBulkQuery(query: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await shopifyGraphQL<{
      bulkOperationRunQuery: { bulkOperation: { id: string } | null; userErrors: Array<{ message: string }> };
    }>(BULK_RUN, { query });
    if (res.errors?.length) throw new Error(`bulk start: ${res.errors.map((e) => e.message).join("; ")}`);
    const ue = res.data?.bulkOperationRunQuery?.userErrors ?? [];
    const id = res.data?.bulkOperationRunQuery?.bulkOperation?.id;
    if (id && ue.length === 0) return id;
    const busy = ue.some((e) => /already in progress/i.test(e.message));
    if (!busy || Date.now() > deadline) throw new Error(`bulk start: ${ue.map((e) => e.message).join("; ")}`);
    await sleep(30_000);
  }
}

export async function waitBulkQuery(id: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await shopifyGraphQL<{
      node: { status: string; errorCode: string | null; url: string | null } | null;
    }>(BULK_NODE, { id });
    const op = res.data?.node;
    if (op?.status === "COMPLETED") return op.url;
    if (op && ["FAILED", "CANCELED", "EXPIRED"].includes(op.status)) {
      throw new Error(`bulk ${op.status}: ${op.errorCode ?? "unknown"}`);
    }
    await sleep(5_000);
  }
  throw new Error("bulk timed out");
}

export async function streamJsonl(url: string, onLine: (obj: any) => void): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`bulk download HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handle = (line: string) => {
    if (line.trim()) onLine(JSON.parse(line));
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      handle(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  }
  handle(buffer);
}

/** Folds bulk JSONL lines (variant rows + child metafield rows) into snapshots. */
export function createVariantSnapshotCollector(metafieldKeys?: readonly string[]): {
  add(obj: any): void;
  result: Map<string, VariantSnapshot>;
} {
  const keep = metafieldKeys ? new Set(metafieldKeys) : null;
  const result = new Map<string, VariantSnapshot>();
  // Children normally follow their parent, but don't rely on file order.
  const orphans = new Map<string, Record<string, string | null>>();
  return {
    result,
    add(obj: any) {
      if (obj?.__parentId) {
        if (typeof obj.key !== "string" || (keep && !keep.has(obj.key))) return;
        const parent = result.get(obj.__parentId);
        if (parent) {
          parent.metafields[obj.key] = obj.value ?? null;
        } else {
          const pending = orphans.get(obj.__parentId) ?? {};
          pending[obj.key] = obj.value ?? null;
          orphans.set(obj.__parentId, pending);
        }
        return;
      }
      if (!obj?.id || !obj?.product?.id) return;
      const level = obj.inventoryItem?.inventoryLevel;
      const pending = orphans.get(obj.id);
      if (pending) orphans.delete(obj.id);
      result.set(obj.id, {
        id: obj.id,
        productId: obj.product.id,
        price: obj.price ?? null,
        title: obj.title ?? null,
        barcode: obj.barcode ?? null,
        metafields: pending ?? {},
        inventoryItemId: obj.inventoryItem?.id ?? null,
        available: level ? Number(level.quantities?.[0]?.quantity ?? 0) : null,
      });
    },
  };
}

export async function exportVariantSnapshot(
  options: { locationId?: string; metafieldKeys?: readonly string[] } = {}
): Promise<Map<string, VariantSnapshot>> {
  // Shares the shop's single bulk slot with the location mirror / stock reconcile.
  const id = await startBulkQuery(buildVariantSnapshotQuery(options.locationId), 45 * 60_000);
  const url = await waitBulkQuery(id, 90 * 60_000);
  const collector = createVariantSnapshotCollector(options.metafieldKeys);
  if (url) await streamJsonl(url, collector.add);
  return collector.result;
}

/** Same shape as a per-product `variants { nodes { … } }` read. */
export type SnapshotVariantNode = {
  id: string;
  title: string | null;
  barcode: string | null;
  price: string | null;
  priceLocked: { value: string | null } | null;
  usSize: { value: string | null } | null;
  expressPrice: { value: string | null } | null;
};

export function groupSnapshotByProduct(snapshot: Map<string, VariantSnapshot>): Map<string, SnapshotVariantNode[]> {
  const out = new Map<string, SnapshotVariantNode[]>();
  const mf = (v: string | null | undefined) => (v === undefined ? null : { value: v });
  for (const v of snapshot.values()) {
    let list = out.get(v.productId);
    if (!list) {
      list = [];
      out.set(v.productId, list);
    }
    list.push({
      id: v.id,
      title: v.title,
      barcode: v.barcode,
      price: v.price,
      priceLocked: mf(v.metafields.price_locked),
      usSize: mf(v.metafields.us_size),
      expressPrice: mf(v.metafields.express_price),
    });
  }
  return out;
}
