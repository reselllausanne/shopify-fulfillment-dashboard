import { HealthConfigError } from "@/healthdata/config";
import { hasTokenEncryptionKey } from "@/healthdata/crypto/tokens";
import { getProvider, resolveGarminProvider } from "@/healthdata/providers";
import { getAccountById, listIntegrationAccounts } from "@/healthdata/repository";
import { withSyncRun } from "@/healthdata/run";
import { runProviderSync } from "@/healthdata/sync";
import type { HealthProviderId, IntegrationAccountRef } from "@/healthdata/types";

export async function syncCommand(opts: {
  provider?: string;
  accountId?: string;
  lookbackDays?: number;
}): Promise<number> {
  if (!hasTokenEncryptionKey()) {
    throw new HealthConfigError(["HEALTH_TOKEN_ENCRYPTION_KEY"]);
  }

  const provider =
    opts.provider === "whoop"
      ? getProvider("whoop")
      : opts.provider === "garmin"
        ? getProvider("garmin")
        : opts.provider === "mock_garmin"
          ? getProvider("mock_garmin")
          : resolveGarminProvider();

  let accountRow = opts.accountId ? await getAccountById(opts.accountId) : null;
  if (!accountRow) {
    const existing = (await listIntegrationAccounts()).find((a) => a.provider === provider.id);
    if (existing) accountRow = await getAccountById(existing.id);
  }
  if (!accountRow) {
    throw new Error(`No connected account for ${provider.id}`);
  }

  const lookback = opts.lookbackDays ?? 3;
  const since =
    accountRow.watermarkAt ??
    new Date(Date.now() - lookback * 86400_000);

  const account: IntegrationAccountRef = {
    id: accountRow.id,
    provider: accountRow.provider as HealthProviderId,
    providerUserId: accountRow.providerUserId,
    accessTokenEnc: accountRow.accessTokenEnc,
    refreshTokenEnc: accountRow.refreshTokenEnc,
    tokenExpiresAt: accountRow.tokenExpiresAt,
    watermarkAt: accountRow.watermarkAt,
  };

  return withSyncRun(
    provider.id,
    "incremental",
    { accountId: accountRow.id, since: since.toISOString() },
    async (run) => {
      const stats = await runProviderSync({
        provider,
        account,
        mode: "incremental",
        range: { from: since, to: new Date() },
        syncRunId: run.id,
      });
      await run.setStats(stats);
      return stats;
    },
    { accountId: accountRow.id }
  );
}
