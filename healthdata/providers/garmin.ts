import { resolveHealthConfig } from "@/healthdata/config";
import type { HealthProvider } from "@/healthdata/providers/types";
import type {
  DateRange,
  IntegrationAccountRef,
  NormalizedActivity,
  NormalizedHealthDaily,
  Pkce,
  ProviderCapabilities,
  RawProviderBatch,
  TokenBundle,
  WebhookResult,
} from "@/healthdata/types";

/**
 * Official Garmin Connect Developer Program adapter (skeleton).
 *
 * DO NOT invent REST endpoints here. After program approval, wire paths and
 * schemas exclusively from the Garmin Developer Portal OpenAPI / docs.
 *
 * Publicly confirmed:
 * - OAuth 2.0 PKCE
 * - Health API + Activity API (Ping/Pull or Push)
 * - FIT/GPX/TCX for activities
 * - Training API = publish workouts/plans (NOT calendar READ on public docs)
 */
export class GarminProvider implements HealthProvider {
  readonly id = "garmin" as const;

  getCapabilities(): ProviderCapabilities {
    return {
      provider: this.id,
      oauth: "supported",
      backfill: "supported",
      incrementalSync: "supported",
      webhooks: "supported",
      sleep: "supported",
      activities: "supported",
      recovery: "unconfirmed",
      bodyComposition: "supported",
      fitFiles: "supported",
      calendarRead: "unsupported",
      notes: [
        "Endpoints and field schemas require Developer Portal access after approval.",
        "Training API calendar READ is unsupported on public docs.",
        "Use MockGarminProvider until GARMIN_CLIENT_ID/SECRET are configured.",
      ],
    };
  }

  getAuthorizationUrl(state: string, pkce: Pkce): string {
    const config = resolveHealthConfig();
    if (!config.garminClientId || !config.garminRedirectUri) {
      throw new Error(
        "Garmin OAuth not configured. Set GARMIN_CLIENT_ID and GARMIN_REDIRECT_URI after portal approval."
      );
    }
    // Authorization host/path must be taken from official Garmin OAuth docs in the portal.
    // Placeholder query shape only — do not call until portal URL is confirmed.
    const url = new URL("https://connect.garmin.com/oauth2Confirm");
    url.searchParams.set("client_id", config.garminClientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", config.garminRedirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", pkce.codeChallenge);
    url.searchParams.set("code_challenge_method", pkce.codeChallengeMethod);
    return url.toString();
  }

  async exchangeAuthorizationCode(_code: string, _pkce: Pkce): Promise<TokenBundle> {
    throw new Error(
      "GarminProvider.exchangeAuthorizationCode: wire token endpoint from official portal docs after approval. Do not invent URLs."
    );
  }

  async refreshAuthorization(_account: IntegrationAccountRef): Promise<TokenBundle> {
    throw new Error(
      "GarminProvider.refreshAuthorization: wire refresh from official portal docs after approval."
    );
  }

  async revokeAuthorization(_account: IntegrationAccountRef): Promise<void> {
    throw new Error(
      "GarminProvider.revokeAuthorization: wire revoke from official portal docs after approval."
    );
  }

  async *backfill(
    _account: IntegrationAccountRef,
    _range: DateRange
  ): AsyncIterable<RawProviderBatch> {
    throw new Error(
      "GarminProvider.backfill: wire Health/Activity pull from portal OpenAPI after approval."
    );
    yield { resourceType: "noop", records: [] }; // unreachable; keeps generator typing
  }

  async *incrementalSync(
    _account: IntegrationAccountRef,
    _since: Date
  ): AsyncIterable<RawProviderBatch> {
    throw new Error(
      "GarminProvider.incrementalSync: wire Health/Activity pull from portal OpenAPI after approval."
    );
    yield { resourceType: "noop", records: [] };
  }

  async handleWebhook(_headers: Headers, _body: unknown): Promise<WebhookResult> {
    return {
      acknowledged: false,
      shouldPull: false,
      resourceHints: [],
      message: "Garmin webhook handling not wired — confirm Ping/Push schema in portal.",
    };
  }

  normalizeHealthData(_raw: {
    resourceType: string;
    payload: unknown;
    providerUserId: string;
    providerRecordId: string;
    sourceUpdatedAt: Date | null;
  }): NormalizedHealthDaily[] {
    // Map portal JSON → NormalizedHealthDaily after schema review.
    return [];
  }

  normalizeActivities(_raw: {
    resourceType: string;
    payload: unknown;
    providerUserId: string;
    providerRecordId: string;
    sourceUpdatedAt: Date | null;
  }): NormalizedActivity[] {
    return [];
  }
}

export const garminProvider = new GarminProvider();
