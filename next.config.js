/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["ssh2", "ssh2-sftp-client"],
  experimental: {
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

