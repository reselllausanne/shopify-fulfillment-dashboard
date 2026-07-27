/**
 * Register Shopify app webhooks (orders/paid → convergence).
 *
 *   npx tsx scripts/register-shopify-webhooks.ts
 *   npx tsx scripts/register-shopify-webhooks.ts --dry-run
 */
import { resolveShopifyAdminEnv } from "@/lib/shopifyEnv";

const TOPIC = "orders/paid";
const PATH = "/api/shopify/webhooks/orders-paid";

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
  const address = `https://${appUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}${PATH}`;

  const listUrl = `https://${shop}/admin/api/${version}/webhooks.json`;
  const listRes = await fetch(listUrl, { headers: { "X-Shopify-Access-Token": token } });
  const listJson = (await listRes.json()) as { webhooks?: Array<{ id: number; topic: string; address: string }> };
  const existing = (listJson.webhooks ?? []).filter((w) => w.topic === TOPIC);

  console.log(JSON.stringify({ shop, address, existing }, null, 2));

  if (existing.some((w) => w.address === address)) {
    console.log("orders/paid webhook already registered for this app.");
    return;
  }

  if (dryRun) {
    console.log("dry-run — would POST webhook", { topic: TOPIC, address });
    return;
  }

  const createRes = await fetch(listUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ webhook: { topic: TOPIC, address, format: "json" } }),
  });
  const createText = await createRes.text();
  console.log("create", createRes.status, createText);

  if (!createRes.ok) {
    process.exit(1);
  }

  console.log(
    "\nIf you still see hmac mismatch in logs, delete legacy webhooks under\n" +
      "Shopify Admin → Settings → Notifications → Webhooks (old app secret).\n" +
      "Only the ALLIN-ONE-code app webhook above should remain."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
