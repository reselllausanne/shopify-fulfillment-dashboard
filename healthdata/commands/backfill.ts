import { HealthConfigError } from "@/healthdata/config";
import { hasTokenEncryptionKey } from "@/healthdata/crypto/tokens";
import { getProvider, resolveGarminProvider } from "@/healthdata/providers";
import {
  getAccountById,
  listIntegrationAccounts,
  upsertIntegrationAccount,
} from "@/healthdata/repository";
import { withSyncRun } from "@/healthdata/run";
import { runProviderSync } from "@/healthdata/sync";
import type { HealthProviderId, IntegrationAccountRef } from "@/healthdata/types";

function toAccountRef(row: {
  id: string;
  provider: string;
  providerUserId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  tokenExpiresAt: Date | null;
  watermarkAt: Date | null;
}): IntegrationAccountRef {
  return {
    id: row.id,
    provider: row.provider as HealthProviderId,
    providerUserId: row.providerUserId,
    accessTokenEnc: row.accessTokenEnc,
    refreshTokenEnc: row.refreshTokenEnc,
    tokenExpiresAt: row.tokenExpiresAt,
    watermarkAt: row.watermarkAt,
  };
}

export async function backfillCommand(opts: {
  days: number;
  provider?: string;
  accountId?: string;
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
    if (existing) {
      accountRow = await getAccountById(existing.id);
    }
  }

  if (!accountRow && provider.id === "mock_garmin") {
    const tokens = await provider.exchangeAuthorizationCode("mock", {
      codeVerifier: "x",
      codeChallenge: "y",
      codeChallengeMethod: "S256",
    });
    const created = await upsertIntegrationAccount({ provider: "mock_garmin", tokens });
    accountRow = await getAccountById(created.id);
  }

  if (!accountRow) {
    throw new Error(
      `No connected account for ${provider.id}. Connect via /health or use --provider=mock_garmin.`
    );
  }

  const to = new Date();
  const from = new Date(to.getTime() - opts.days * 86400_000);

  return withSyncRun(
    provider.id,
    "backfill",
    { days: opts.days, accountId: accountRow.id },
    async (run) => {
      const stats = await runProviderSync({
        provider,
        account: toAccountRef(accountRow!),
        mode: "backfill",
        range: { from, to },
        syncRunId: run.id,
      });
      await run.setStats(stats);
      return stats;
    },
    { accountId: accountRow.id }
  );
}
