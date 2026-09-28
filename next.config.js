/** @type {import('next').NextConfig} */
const path = require("path");

const NATIVE_SERVER_ONLY = [
  "ssh2",
  "ssh2-sftp-client",
  "cpu-features",
  "@prisma/client",
  "prisma",
  "sharp",
  "playwright",
  "playwright-core",
];

const nextConfig = {
  // Worktree: pin tracing root so parent lockfile is not preferred.
  outputFileTracingRoot: path.join(__dirname),
  // Prisma / ssh2 / sharp must stay external: bundling native addons crashes
  // `next dev` (cpu-features.node "not supported in the browser").
  serverExternalPackages: NATIVE_SERVER_ONLY,
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
  webpack: (config, { isServer }) => {
    // Never ship native Node addons to the browser graph.
    if (!isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        ssh2: false,
        "ssh2-sftp-client": false,
        "cpu-features": false,
        sharp: false,
        playwright: false,
        "playwright-core": false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
