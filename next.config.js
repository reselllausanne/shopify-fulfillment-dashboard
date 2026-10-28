/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prisma must stay external: Turbopack bundling the query engine causes
  // intermittent "Response from the Engine was empty" crashes in `next dev`.
  // Patchright (StockX stealth browser) must stay external: webpack cannot bundle
  // patchright-core/coreBundle.js (dynamic requires), same reason Playwright is
  // auto-externalized by Next. Without this, `next build` fails module-not-found.
  serverExternalPackages: [
    "ssh2",
    "ssh2-sftp-client",
    "@prisma/client",
    "prisma",
    "patchright",
    "patchright-core",
  ],
  experimental: {
    /**
     * Playwright login (GOAT/StockX) can sit on Cloudflare + manual login for minutes.
     * Default proxyTimeout is 30s and kills the request before orders arrive.
     */
    proxyTimeout: 600_000,
    /**
     * Router clones request bodies for handling; default is 10MB. NER multi_sync
     * partner CSVs are ~200–400MB (~1.7M lines). At 50mb Next truncated the body
     * → "Failed to parse body as FormData" / HTTP 500 (after nginx 413 was raised).
     * Keep in sync with deploy/nginx/solution.resell-lausanne.ch.conf (512m).
     */
    proxyClientMaxBodySize: "512mb",
    middlewareClientMaxBodySize: "512mb",
    serverActions: {
      /** Multipart POSTs may be inspected as possible Server Actions; align cap with uploads. */
      bodySizeLimit: "512mb",
    },
  },
}

module.exports = nextConfig

