/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prisma must stay external: Turbopack bundling the query engine causes
  // intermittent "Response from the Engine was empty" crashes in `next dev`.
  serverExternalPackages: ["ssh2", "ssh2-sftp-client", "@prisma/client", "prisma"],
  experimental: {
    /**
     * Playwright login (GOAT/StockX) can sit on Cloudflare + manual login for minutes.
     * Default proxyTimeout is 30s and kills the request before orders arrive.
     */
    proxyTimeout: 600_000,
    /**
     * Router clones request bodies for handling; default is 10MB. Partner CSV
     * uploads (multipart) exceed that and fail or appear as "request too large".
     */
    proxyClientMaxBodySize: "50mb",
    serverActions: {
      /** Multipart POSTs may be inspected as possible Server Actions; align cap with uploads. */
      bodySizeLimit: "50mb",
    },
  },
}

module.exports = nextConfig

