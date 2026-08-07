import { readFile } from "node:fs/promises";
import path from "node:path";

import { normalizeActivityPayload } from "@/healthdata/normalize/activities";
import { normalizeBodyPayload } from "@/healthdata/normalize/body";
import { normalizeHealthDailyPayload } from "@/healthdata/normalize/health";
import { normalizeSleepPayload } from "@/healthdata/normalize/sleep";
import type { HealthProvider } from "@/healthdata/providers/types";
import type {
  DateRange,
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

type FixtureDay = {
  localDate: string;
  sleep?: Record<string, unknown>;
  health?: Record<string, unknown>;
  body?: Record<string, unknown>;
  activities?: Array<Record<string, unknown>>;
};

type FixtureFile = {
  providerUserId: string;
  days: FixtureDay[];
};

async function loadFixture(): Promise<FixtureFile> {
  const filePath = path.join(process.cwd(), "healthdata/fixtures/garmin/sample-days.json");
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as FixtureFile;
}

function inRange(localDate: string, range: DateRange): boolean {
  const t = Date.parse(`${localDate}T12:00:00.000Z`);
  return t >= range.from.getTime() && t <= range.to.getTime();
}

async function* emitBatches(
  account: IntegrationAccountRef,
  range: DateRange
): AsyncGenerator<RawProviderBatch> {
  const fixture = await loadFixture();
  const userId = account.providerUserId || fixture.providerUserId;

  for (const day of fixture.days) {
    if (!inRange(day.localDate, range)) continue;

    if (day.sleep) {
      yield {
        resourceType: "sleep",
        records: [
          {
            providerRecordId: String(day.sleep.id ?? `sleep-${day.localDate}`),
            sourceUpdatedAt: new Date(`${day.localDate}T12:00:00.000Z`),
            occurredAt: new Date(String(day.sleep.endAt ?? `${day.localDate}T06:00:00.000Z`)),
            payload: { ...day.sleep, localDate: day.localDate, providerUserId: userId },
          },
        ],
      };
    }

    if (day.health) {
      yield {
        resourceType: "health_daily",
        records: [
          {
            providerRecordId: String(day.health.id ?? `health-${day.localDate}`),
            sourceUpdatedAt: new Date(`${day.localDate}T12:00:00.000Z`),
            occurredAt: new Date(`${day.localDate}T12:00:00.000Z`),
            payload: { ...day.health, localDate: day.localDate, providerUserId: userId },
          },
        ],
      };
    }

    if (day.body) {
      yield {
        resourceType: "body",
        records: [
          {
            providerRecordId: String(day.body.id ?? `body-${day.localDate}`),
            sourceUpdatedAt: new Date(`${day.localDate}T12:00:00.000Z`),
            occurredAt: new Date(String(day.body.measuredAt ?? `${day.localDate}T06:00:00.000Z`)),
            payload: { ...day.body, localDate: day.localDate, providerUserId: userId },
          },
        ],
      };
    }

    if (day.activities?.length) {
      yield {
        resourceType: "activity",
        records: day.activities.map((act) => ({
          providerRecordId: String(act.id),
          sourceUpdatedAt: new Date(`${day.localDate}T12:00:00.000Z`),
          occurredAt: new Date(String(act.startAt)),
          payload: { ...act, localDate: day.localDate, providerUserId: userId },
        })),
      };
    }
  }
}

export class MockGarminProvider implements HealthProvider {
  readonly id = "mock_garmin" as const;

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
      fitFiles: "unsupported",
      calendarRead: "unsupported",
      notes: [
        "Fixture-backed mock for local POC. No real Garmin endpoints.",
        "Replace with GarminProvider after Connect Developer Program approval.",
      ],
    };
  }

  getAuthorizationUrl(state: string, _pkce: Pkce): string {
    // Local mock "consent" — UI redirects straight to callback with code=mock.
    return `/api/health/integrations/garmin/callback?code=mock&state=${encodeURIComponent(state)}&provider=mock_garmin`;
  }

  async exchangeAuthorizationCode(_code: string, _pkce: Pkce): Promise<TokenBundle> {
    const fixture = await loadFixture();
    return {
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      expiresAt: new Date(Date.now() + 3600_000),
      providerUserId: fixture.providerUserId,
      scope: "HEALTH_EXPORT ACTIVITY_EXPORT",
    };
  }

  async refreshAuthorization(account: IntegrationAccountRef): Promise<TokenBundle> {
    return {
      accessToken: "mock-access-token-refreshed",
      refreshToken: "mock-refresh-token",
      expiresAt: new Date(Date.now() + 3600_000),
      providerUserId: account.providerUserId,
      scope: "HEALTH_EXPORT ACTIVITY_EXPORT",
    };
  }

  async revokeAuthorization(_account: IntegrationAccountRef): Promise<void> {
    return;
  }

  backfill(account: IntegrationAccountRef, range: DateRange): AsyncIterable<RawProviderBatch> {
    return emitBatches(account, range);
  }

  incrementalSync(account: IntegrationAccountRef, since: Date): AsyncIterable<RawProviderBatch> {
    return emitBatches(account, { from: since, to: new Date() });
  }

  async handleWebhook(_headers: Headers, body: unknown): Promise<WebhookResult> {
    return {
      acknowledged: true,
      shouldPull: true,
      resourceHints: ["sleep", "health_daily", "activity"],
      message: typeof body === "object" ? "mock webhook" : "mock webhook empty",
    };
  }

  normalizeHealthData(raw: {
    resourceType: string;
    payload: unknown;
    providerUserId: string;
    providerRecordId: string;
    sourceUpdatedAt: Date | null;
  }): NormalizedHealthDaily[] {
    if (raw.resourceType !== "health_daily") return [];
    const row = normalizeHealthDailyPayload({
      provider: this.id,
      providerUserId: raw.providerUserId,
      providerRecordId: raw.providerRecordId,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      payload: raw.payload,
    });
    return row ? [row] : [];
  }

  normalizeActivities(raw: {
    resourceType: string;
    payload: unknown;
    providerUserId: string;
    providerRecordId: string;
    sourceUpdatedAt: Date | null;
  }): NormalizedActivity[] {
    if (raw.resourceType !== "activity") return [];
    const row = normalizeActivityPayload({
      provider: this.id,
      providerUserId: raw.providerUserId,
      providerRecordId: raw.providerRecordId,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      payload: raw.payload,
    });
    return row ? [row] : [];
  }

  normalizeSleep(raw: {
    resourceType: string;
    payload: unknown;
    providerUserId: string;
    providerRecordId: string;
    sourceUpdatedAt: Date | null;
  }): NormalizedSleep[] {
    if (raw.resourceType !== "sleep") return [];
    const row = normalizeSleepPayload({
      provider: this.id,
      providerUserId: raw.providerUserId,
      providerRecordId: raw.providerRecordId,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      payload: raw.payload,
    });
    return row ? [row] : [];
  }

  normalizeBody(raw: {
    resourceType: string;
    payload: unknown;
    providerUserId: string;
    providerRecordId: string;
    sourceUpdatedAt: Date | null;
  }): NormalizedBodyMeasurement[] {
    if (raw.resourceType !== "body") return [];
    const row = normalizeBodyPayload({
      provider: this.id,
      providerUserId: raw.providerUserId,
      providerRecordId: raw.providerRecordId,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      payload: raw.payload,
    });
    return row ? [row] : [];
  }
}

export const mockGarminProvider = new MockGarminProvider();
