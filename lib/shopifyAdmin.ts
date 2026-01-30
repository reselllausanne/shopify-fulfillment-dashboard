// lib/shopifyAdmin.ts

export type ShopifyGqlError = { message: string; extensions?: any };

export async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, any> = {}
): Promise<{ data: T; errors?: ShopifyGqlError[] }> {
  const shop = process.env.SHOP_NAME_SHOPIFY;
  const token = process.env.ACCESS_TOKEN_SHOPIFY;
  const version = process.env.API_VERSION_SHOPIFY || "2026-01";

  if (!shop || !token) {
    throw new Error("Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN env vars");
  }

  const url = `https://${shop}/admin/api/${version}/graphql.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Shopify response not JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }

  return json as { data: T; errors?: ShopifyGqlError[] };
}

export function extractEUSize(input?: string | null): string | null {
  if (!input) return null;
  
  // Try to match "EU XX" or "EU XX.X" format
  const euMatch = input.match(/EU\s*([0-9]{1,2}(?:\.[0-9])?)/i);
  if (euMatch?.[1]) return `EU ${euMatch[1]}`;
  
  // Fallback: If input is just a number (like "44.5" or "42"), treat as EU size
  const plainNumberMatch = input.trim().match(/^([0-9]{1,2}(?:\.[0-9])?)$/);
  if (plainNumberMatch?.[1]) {
    const size = parseFloat(plainNumberMatch[1]);
    // EU shoe sizes typically range from 35-50
    if (size >= 35 && size <= 50) {
      return `EU ${plainNumberMatch[1]}`;
    }
  }
  
  return null;
}

