/** Strip credentials from text before it reaches logs, the ledger or Slack. */
export function redactSecrets(input: string | null | undefined): string {
  return String(input ?? "")
    .replace(/(\w+:\/\/)[^\/\s:@]+:[^@\s]+@/g, "$1***@") // proxy / basic-auth urls
    .replace(/(authorization["']?\s*[:=]\s*["']?)(bearer\s+)?[A-Za-z0-9._~+\/-]{12,}=*/gi, "$1***")
    .replace(/bearer\s+[A-Za-z0-9._~+\/-]{12,}=*/gi, "Bearer ***")
    .replace(/(cookie["']?\s*[:=]\s*["']?)[^"'\n]{12,}/gi, "$1***");
}
