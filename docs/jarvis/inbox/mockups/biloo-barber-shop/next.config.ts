import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  // Projet autonome imbriqué dans un repo qui a sa propre app Next.js :
  // sans ça, Next remonte au lockfile racine et charge proxy.ts / postcss.config.js du parent.
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
