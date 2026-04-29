/**
 * Ensures `.env*` from the project root are merged into `process.env` on the Node
 * server runtime (same behaviour as `next dev`, but explicit for `next start` /
 * Docker cwd edge cases).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadEnvConfig } = await import("@next/env");
  // Avoid direct Node API call that Edge analyzer flags in shared instrumentation file.
  loadEnvConfig(".");
}
