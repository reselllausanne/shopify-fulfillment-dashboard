// Prints "<entry>\t<local file>" for every local source file each worker entry imports.
// Run inside the built image (cwd /app): node scripts/vps-worker-closure.mjs <entry.ts>...
// Used by vps-deploy-from-github.sh to redeploy only workers whose code changed.
// Any failure => exit 1 => deploy script falls back to redeploying ALL workers.
import { buildSync } from "esbuild";

const entries = process.argv.slice(2);
if (entries.length === 0) {
  console.error("no entries");
  process.exit(1);
}
const empty = Object.fromEntries(
  [".css", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".node", ".woff", ".woff2", ".txt", ".csv"].map(
    (e) => [e, "empty"],
  ),
);
for (const entry of entries) {
  const res = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    packages: "external",
    metafile: true,
    logLevel: "silent",
    loader: empty,
    outfile: "/tmp/_closure.mjs",
  });
  for (const file of Object.keys(res.metafile.inputs)) {
    if (file.startsWith("node_modules/") || file.includes(":")) continue;
    console.log(`${entry}\t${file}`);
  }
}
