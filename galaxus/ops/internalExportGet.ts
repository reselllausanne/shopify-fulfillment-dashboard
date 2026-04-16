/**
 * Run Galaxus export HTTP handlers in-process instead of `fetch(origin + path)`.
 * Self-calls often fail on VPS (hairpin NAT), wrong `NEXT_PUBLIC_*` origin, or short timeouts
 * while building large CSVs — that surfaces as undici "fetch failed" with no detail.
 */
export async function runGalaxusExportGET(requestUrl: string): Promise<Response> {
  let pathname: string;
  try {
    pathname = new URL(requestUrl).pathname;
  } catch {
    return fetch(requestUrl, { cache: "no-store" });
  }

  const req = new Request(requestUrl);

  switch (pathname) {
    case "/api/galaxus/export/master": {
      const { GET } = await import("@/app/api/galaxus/export/master/route");
      return (await GET(req)) as Response;
    }
    case "/api/galaxus/export/stock": {
      const { GET } = await import("@/app/api/galaxus/export/stock/route");
      return (await GET(req)) as Response;
    }
    case "/api/galaxus/export/offer": {
      const { GET } = await import("@/app/api/galaxus/export/offer/route");
      return (await GET(req)) as Response;
    }
    case "/api/galaxus/export/specifications": {
      const { GET } = await import("@/app/api/galaxus/export/specifications/route");
      return (await GET(req)) as Response;
    }
    case "/api/galaxus/export/check-all": {
      const { GET } = await import("@/app/api/galaxus/export/check-all/route");
      return (await GET(req)) as Response;
    }
    default:
      return fetch(requestUrl, { cache: "no-store" });
  }
}
