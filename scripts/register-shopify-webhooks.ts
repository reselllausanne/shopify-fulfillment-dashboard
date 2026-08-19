/**
 * Register Shopify app webhooks.
 *
 *   npx tsx scripts/register-shopify-webhooks.ts
 *   npx tsx scripts/register-shopify-webhooks.ts --dry-run
 */
import { resolveShopifyAdminEnv } from "@/lib/shopifyEnv";

const WEBHOOKS = [
  { topic: "orders/paid", path: "/api/shopify/webhooks/orders-paid" },
  { topic: "fulfillments/create", path: "/api/shopify/webhooks/fulfillments-create" },
  { topic: "fulfillments/update", path: "/api/shopify/webhooks/fulfillments-update" },
] as const;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { shop, token, version } = resolveShopifyAdminEnv();
  if (!shop || !token) {
    throw new Error("Missing SHOP_NAME_SHOPIFY / SHOPIFY_ADMIN_ACCESS_TOKEN");
  }

  const appUrl = String(process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? "").trim();
  if (!appUrl) {
    throw new Error("Missing SHOPIFY_APP_URL (public host for webhook callback)");
  }
  const origin = `https://${appUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;

  const listUrl = `https://${shop}/admin/api/${version}/webhooks.json`;
  const listRes = await fetch(listUrl, { headers: { "X-Shopify-Access-Token": token } });
  const listJson = (await listRes.json()) as { webhooks?: Array<{ id: number; topic: string; address: string }> };
  const existing = listJson.webhooks ?? [];

  for (const hook of WEBHOOKS) {
    const address = `${origin}${hook.path}`;
    const already = existing.filter((w) => w.topic === hook.topic);
    console.log(JSON.stringify({ topic: hook.topic, address, existing: already }, null, 2));

    if (already.some((w) => w.address === address)) {
      console.log(`${hook.topic} already registered.`);
      continue;
    }

    if (dryRun) {
      console.log("dry-run — would POST webhook", { topic: hook.topic, address });
      continue;
    }

    const createRes = await fetch(listUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ webhook: { topic: hook.topic, address, format: "json" } }),
    });
    const createText = await createRes.text();
    console.log("create", hook.topic, createRes.status, createText);
    if (!createRes.ok) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
