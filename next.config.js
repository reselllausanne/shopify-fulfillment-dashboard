/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["ssh2", "ssh2-sftp-client"],
}

module.exports = nextConfig

