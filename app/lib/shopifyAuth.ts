const SHOP_NAME = process.env.SHOP_NAME_SHOPIFY;
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES;
const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL;

export type AuthRedirect = {
  state: string;
  url: string;
};

const ensureCrypto = () => {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Edge runtime requires crypto.getRandomValues");
  }
};

export function buildAuthRedirect(): AuthRedirect {
  if (!SHOP_NAME || !SHOPIFY_API_KEY || !SHOPIFY_SCOPES || !SHOPIFY_APP_URL) {
    throw new Error("Missing Shopify OAuth configuration");
  }

  ensureCrypto();
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const state = Array.from(randomBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const redirectUri = `${SHOPIFY_APP_URL.replace(/\/$/, "")}/auth/callback`;
  const url =
    `https://${SHOP_NAME}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  return { state, url };
}

export async function exchangeAuthCode(shop: string, code: string) {
  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    throw new Error("Missing Shopify app credentials");
  }

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  const payload = await tokenRes.json();
  return payload?.access_token;
}

