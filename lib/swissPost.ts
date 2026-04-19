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

type TokenOptions = {
  scope?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  cacheKey?: string;
};

const tokenCache = new Map<string, CachedToken>();

const DEFAULT_SCOPE = "DCAPI_BARCODE_READ";
const DEFAULT_TRACKING_SCOPE = "MYSB_MAILPIECE_TRACKING_B2B_READ";

function getTokenEndpoint() {
  return process.env.SWISS_POST_TOKEN_URL || "https://api.post.ch/OAuth/token";
}

function getLabelEndpoint() {
  return process.env.SWISS_POST_LABEL_ENDPOINT || "";
}

function getScope() {
  return process.env.SWISS_POST_SCOPE || DEFAULT_SCOPE;
}

function resolveTrackingEndpoint() {
  return (
    process.env.SWISS_POST_TRACKING_ENDPOINT ||
    "https://mysb.apis.post.ch/logistics/mailpiece/tracking/business/v1"
  );
}

function resolveTrackingScope() {
  return process.env.SWISS_POST_TRACKING_SCOPE || DEFAULT_TRACKING_SCOPE;
}

function resolveTrackingClientId() {
  return process.env.SWISS_POST_TRACKING_CLIENT_ID || process.env.SWISS_POST_CLIENT_ID;
}

function resolveTrackingClientSecret() {
  return process.env.SWISS_POST_TRACKING_CLIENT_SECRET || process.env.SWISS_POST_CLIENT_SECRET;
}

function resolveCacheKey({
  cacheKey,
  scope,
  clientId,
  tokenUrl,
}: {
  cacheKey?: string;
  scope: string;
  clientId: string;
  tokenUrl: string;
}) {
  if (cacheKey) return cacheKey;
  return `${clientId}|${scope}|${tokenUrl}`;
}

export async function getSwissPostToken(options: TokenOptions = {}) {
  const scope = options.scope || getScope();
  const tokenUrl = options.tokenUrl || getTokenEndpoint();
  const clientId = options.clientId || process.env.SWISS_POST_CLIENT_ID;
  const clientSecret = options.clientSecret || process.env.SWISS_POST_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing SWISS_POST_CLIENT_ID or SWISS_POST_CLIENT_SECRET");
  }

  const cacheKey = resolveCacheKey({ cacheKey: options.cacheKey, scope, clientId, tokenUrl });
  const cachedToken = tokenCache.get(cacheKey);
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
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

  tokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  });

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

type SwissPostTrackingResponse = {
  ok: boolean;
  status: number;
  data: any;
};

async function swissPostTrackingFetch(path: string, language: string): Promise<SwissPostTrackingResponse> {
  const endpoint = resolveTrackingEndpoint();
  const clientId = resolveTrackingClientId();
  const clientSecret = resolveTrackingClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error("Missing SWISS_POST_TRACKING_CLIENT_ID or SWISS_POST_TRACKING_CLIENT_SECRET");
  }
  const scope = resolveTrackingScope();
  const token = await getSwissPostToken({
    scope,
    clientId,
    clientSecret,
    cacheKey: `tracking:${scope}:${clientId}`,
  });
  const baseUrl = endpoint.replace(/\/$/, "");
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "accept-language": language,
    },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function fetchSwissPostMailpieceDetail(
  mailpieceKey: string,
  language = "fr"
): Promise<SwissPostTrackingResponse> {
  const key = encodeURIComponent(String(mailpieceKey || "").trim());
  if (!key) {
    throw new Error("Missing Swiss Post mailpieceKey");
  }
  return swissPostTrackingFetch(`/mailpieces/${key}/detail`, language);
}

export async function fetchSwissPostMailpieceEvents(
  mailpieceKey: string,
  language = "fr"
): Promise<SwissPostTrackingResponse> {
  const key = encodeURIComponent(String(mailpieceKey || "").trim());
  if (!key) {
    throw new Error("Missing Swiss Post mailpieceKey");
  }
  return swissPostTrackingFetch(`/mailpieces/${key}/events/`, language);
}

