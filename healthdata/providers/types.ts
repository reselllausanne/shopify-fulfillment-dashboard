import { createHash, randomBytes } from "node:crypto";

import type {
  DateRange,
  HealthProviderId,
  IntegrationAccountRef,
  NormalizedActivity,
  NormalizedBodyMeasurement,
  NormalizedHealthDaily,
  NormalizedSleep,
  Pkce,
  ProviderCapabilities,
  RawProviderBatch,
  TokenBundle,
  WebhookResult,
} from "@/healthdata/types";

export interface HealthProvider {
  readonly id: HealthProviderId;

  getCapabilities(): ProviderCapabilities;

  getAuthorizationUrl(state: string, pkce: Pkce): string;

  exchangeAuthorizationCode(code: string, pkce: Pkce): Promise<TokenBundle>;

  refreshAuthorization(account: IntegrationAccountRef): Promise<TokenBundle>;

  revokeAuthorization(account: IntegrationAccountRef): Promise<void>;

  backfill(
    account: IntegrationAccountRef,
    range: DateRange
  ): AsyncIterable<RawProviderBatch>;

  incrementalSync(
    account: IntegrationAccountRef,
    since: Date
  ): AsyncIterable<RawProviderBatch>;

  handleWebhook(headers: Headers, body: unknown): Promise<WebhookResult>;

  normalizeHealthData(raw: {
    resourceType: string;
    payload: unknown;
    providerUserId: string;
    providerRecordId: string;
    sourceUpdatedAt: Date | null;
  }): NormalizedHealthDaily[];

  normalizeActivities(raw: {
    resourceType: string;
    payload: unknown;
    providerUserId: string;
    providerRecordId: string;
    sourceUpdatedAt: Date | null;
  }): NormalizedActivity[];

  normalizeSleep?(raw: {
    resourceType: string;
    payload: unknown;
    providerUserId: string;
    providerRecordId: string;
    sourceUpdatedAt: Date | null;
  }): NormalizedSleep[];

  normalizeBody?(raw: {
    resourceType: string;
    payload: unknown;
    providerUserId: string;
    providerRecordId: string;
    sourceUpdatedAt: Date | null;
  }): NormalizedBodyMeasurement[];
}

export function createPkce(): Pkce {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
}
