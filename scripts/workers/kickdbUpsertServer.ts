#!/usr/bin/env npx tsx
/**
 * Internal KickDB upsert HTTP server — keeps heavy ingest off the Next.js web process.
 * SSE listener / sweeper POST here instead of /api/kickdb/upsert on :3000.
 */
import http from "node:http";
import { upsertKickdbProductPayload } from "@/galaxus/kickdb/upsertProduct";

const PORT = Number(process.env.KICKDB_UPSERT_PORT ?? 3002);
const HOST = process.env.KICKDB_UPSERT_HOST ?? "0.0.0.0";

function checkAuth(req: http.IncomingMessage): boolean {
  const expected = process.env.KICKDB_INTERNAL_TOKEN;
  if (!expected) return true;
  return req.headers["x-internal-token"] === expected;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url?.split("?")[0] ?? "";

  if (req.method === "GET" && (url === "/health" || url === "/")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "kickdb-upsert" }));
    return;
  }

  if (req.method !== "POST" || url !== "/upsert") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
    return;
  }

  if (!checkAuth(req)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
    return;
  }

  try {
    const result = await upsertKickdbProductPayload(body as { data?: unknown; notFound?: boolean });
    const status = result.ok ? 200 : result.error === "missing_data_or_id" ? 400 : 500;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[kickdb-upsert-server] error", err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: message }));
  }
});

server.listen(PORT, HOST, () => {
  console.info("[kickdb-upsert-server] listening", { host: HOST, port: PORT });
});
