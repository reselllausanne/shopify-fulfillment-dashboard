/**
 * Verifies Cloud Agent secrets are present without printing values.
 * Usage: npx tsx scripts/cloud-agent-preflight.ts
 */

const REQUIRED = [
  "DATABASE_URL",
  "SHOP_NAME_SHOPIFY",
  "ACCESS_TOKEN_SHOPIFY",
] as const;

const RECOMMENDED = [
  "DIRECT_URL",
  "API_VERSION_SHOPIFY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "JWT_SECRET",
  "KICKSDB_API_KEY",
] as const;

const OPTIONAL = ["SSH_PRIVATE_KEY", "SSH_HOST", "SSH_USER"] as const;

function status(name: string): "ok" | "missing" {
  const v = process.env[name];
  return v && String(v).trim() ? "ok" : "missing";
}

let failed = false;

console.log("Cloud Agent preflight\n");

for (const name of REQUIRED) {
  const s = status(name);
  if (s === "missing") failed = true;
  console.log(`  [${s === "ok" ? "OK" : "MISSING"}] ${name} (required)`);
}

for (const name of RECOMMENDED) {
  const s = status(name);
  console.log(`  [${s === "ok" ? "OK" : "warn"}] ${name} (recommended)`);
}

const sshOk = OPTIONAL.every((n) => status(n) === "ok");
console.log(
  `  [${sshOk ? "OK" : "skip"}] VPS SSH (${OPTIONAL.join(", ")}) — optional`
);

console.log("");
if (failed) {
  console.error(
    "Missing required secrets. Add them at https://cursor.com/dashboard/cloud-agents → Secrets"
  );
  process.exit(1);
}

console.log("Required secrets present. Cloud agent can reach DB + Shopify.");
process.exit(0);
