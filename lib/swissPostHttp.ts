import dns from "node:dns";
import https from "node:https";
import { URL } from "node:url";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // ignore older runtimes
}

export function isSwissPostConnectTimeout(err: unknown): boolean {
  const anyErr = err as {
    name?: string;
    code?: string;
    message?: string;
    cause?: { code?: string; name?: string; message?: string };
  };
  const code = String(anyErr?.cause?.code ?? anyErr?.code ?? "");
  const name = String(anyErr?.cause?.name ?? anyErr?.name ?? "");
  const message = String(anyErr?.cause?.message ?? anyErr?.message ?? "");
  return (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN" ||
    name.includes("Timeout") ||
    name.includes("ConnectTimeout") ||
    /timeout|fetch failed|network/i.test(message)
  );
}

export function formatSwissPostNetworkError(err: unknown): string {
  if (isSwissPostConnectTimeout(err)) {
    return "Swiss Post API unreachable (connect timeout to api.post.ch / dcapi). Retry in a few seconds.";
  }
  if (err instanceof Error && err.message) return err.message;
  return String(err ?? "Swiss Post request failed");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SwissPostHttpResult = {
  ok: boolean;
  status: number;
  data: any;
};

/**
 * Raw HTTPS to Swiss Post with forced IPv4 + explicit connect/socket timeouts.
 * Global fetch/undici uses a 10s connect timeout that intermittently fails from the VPS.
 */
export async function swissPostHttpsJson(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<SwissPostHttpResult> {
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs ?? 30_000));
  const method = String(options.method || "GET").toUpperCase();
  const target = new URL(options.url);
  const body = options.body ?? null;

  return await new Promise<SwissPostHttpResult>((resolve, reject) => {
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method,
        family: 4,
        servername: target.hostname,
        headers: {
          ...(options.headers ?? {}),
          ...(body
            ? {
                "content-length": Buffer.byteLength(body).toString(),
              }
            : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data: any = {};
          if (raw) {
            try {
              data = JSON.parse(raw);
            } catch {
              data = { raw };
            }
          }
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            data,
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Swiss Post HTTPS timeout after ${timeoutMs}ms (${target.hostname})`));
    });
    req.on("error", (err) => reject(err));

    if (body) req.write(body);
    req.end();
  });
}

export async function swissPostHttpsJsonWithRetry(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  attempts?: number;
  label?: string;
}): Promise<SwissPostHttpResult> {
  const attempts = Math.max(1, Number(options.attempts ?? 2));
  const label = options.label || "swiss-post-http";
  const startedAt = Date.now();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const attemptStartedAt = Date.now();
    try {
      const result = await swissPostHttpsJson(options);
      console.log(`[SWISS POST] ${label}`, {
        attempt,
        ok: result.ok,
        status: result.status,
        ms: Date.now() - attemptStartedAt,
        totalMs: Date.now() - startedAt,
        host: new URL(options.url).hostname,
      });
      return result;
    } catch (err) {
      lastError = err;
      console.error(`[SWISS POST] ${label} failed`, {
        attempt,
        ms: Date.now() - attemptStartedAt,
        totalMs: Date.now() - startedAt,
        message: err instanceof Error ? err.message : String(err),
        code: (err as any)?.code ?? null,
        host: (() => {
          try {
            return new URL(options.url).hostname;
          } catch {
            return null;
          }
        })(),
      });
      if (attempt >= attempts || !isSwissPostConnectTimeout(err)) {
        break;
      }
      await sleep(400 * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(formatSwissPostNetworkError(lastError));
}
