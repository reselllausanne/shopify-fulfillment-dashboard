type SwissPostToken = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

type CachedToken = {
  token: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;

const DEFAULT_SCOPE = "DCAPI_BARCODE_READ";

function getTokenEndpoint() {
  return process.env.SWISS_POST_TOKEN_URL || "https://api.post.ch/OAuth/token";
}

function getLabelEndpoint() {
  return process.env.SWISS_POST_LABEL_ENDPOINT || "";
}

function getScope() {
  return process.env.SWISS_POST_SCOPE || DEFAULT_SCOPE;
}

export async function getSwissPostToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const clientId = process.env.SWISS_POST_CLIENT_ID;
  const clientSecret = process.env.SWISS_POST_CLIENT_SECRET;
  const scope = getScope();
  const tokenUrl = getTokenEndpoint();

  if (!clientId || !clientSecret) {
    throw new Error("Missing SWISS_POST_CLIENT_ID or SWISS_POST_CLIENT_SECRET");
  }

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("scope", scope);
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });

  const json = (await res.json().catch(() => ({}))) as SwissPostToken | Record<string, any>;
  if (!res.ok) {
    throw new Error(`Swiss Post token error ${res.status}: ${JSON.stringify(json)}`);
  }

  const token = (json as SwissPostToken).access_token;
  const expiresIn = (json as SwissPostToken).expires_in || 300;
  if (!token) {
    throw new Error("Swiss Post token missing access_token");
  }

  cachedToken = {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return token;
}

export async function requestSwissPostLabel(payload: Record<string, any>) {
  const endpoint = getLabelEndpoint();
  if (!endpoint) {
    throw new Error("Missing SWISS_POST_LABEL_ENDPOINT");
  }

  const token = await getSwissPostToken();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  return {
    ok: res.ok,
    status: res.status,
    data,
  };
}

