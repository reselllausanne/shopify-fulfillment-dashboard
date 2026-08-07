import { describeHealthConfig, resolveHealthConfig } from "@/healthdata/config";
import { hasTokenEncryptionKey } from "@/healthdata/crypto/tokens";
import { listProviders } from "@/healthdata/providers";
import { listIntegrationAccounts } from "@/healthdata/repository";
import { EXIT_OK, EXIT_CONFIG_MISSING, log } from "@/healthdata/run";

export async function authCheckCommand(): Promise<number> {
  const config = resolveHealthConfig();
  log("auth_check_config", describeHealthConfig(config));

  if (!hasTokenEncryptionKey()) {
    log("auth_check_fail", { reason: "HEALTH_TOKEN_ENCRYPTION_KEY missing" });
    return EXIT_CONFIG_MISSING;
  }

  const capabilities = listProviders().map((p) => p.getCapabilities());
  const accounts = await listIntegrationAccounts();
  log("auth_check_ok", {
    encryption: "ok",
    providers: capabilities,
    connectedAccounts: accounts.length,
    accounts: accounts.map((a) => ({
      id: a.id,
      provider: a.provider,
      status: a.status,
      lastSyncAt: a.lastSyncAt,
    })),
  });
  return EXIT_OK;
}
