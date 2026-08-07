import { resolveHealthConfig } from "@/healthdata/config";
import { decryptSecret } from "@/healthdata/crypto/tokens";
import { normalizeActivityPayload } from "@/healthdata/normalize/activities";
import { normalizeHealthDailyPayload } from "@/healthdata/normalize/health";
import { normalizeSleepPayload } from "@/healthdata/normalize/sleep";
import type { HealthProvider } from "@/healthdata/providers/types";
import type {
  DateRange,
  IntegrationAccountRef,
  NormalizedActivity,
  NormalizedHealthDaily,
  NormalizedSleep,
  Pkce,
  ProviderCapabilities,
  RawProviderBatch,
  TokenBundle,
  WebhookResult,
} from "@/healthdata/types";

const WHOOP_AUTH = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_TOKEN = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_API = "https://api.prod.whoop.com/developer/v2";

const DEFAULT_SCOPES = [
  "read:sleep",
  "read:recovery",
  "read:cycles",
  "read:workout",
  "read:profile",
  "read:body_measurement",
  "offline",
].join(" ");

type WhoopCollection<T> = {
  records?: T[];
  next_token?: string | null;
};

async function whoopFetch<T>(
  accessToken: string,
  path: string,
  query: Record<string, string>
): Promise<T> {
  const url = new URL(`${WHOOP_API}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`WHOOP API ${path} failed: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function* paginateCollection<T extends { id?: number | string }>(
  accessToken: string,
  path: string,
  range: DateRange,
  resourceType: string
): AsyncGenerator<RawProviderBatch> {
  let nextToken: string | null | undefined = undefined;
  do {
    const query: Record<string, string> = {
      start: range.from.toISOString(),
      end: range.to.toISOString(),
      limit: "25",
    };
    if (nextToken) query.nextToken = nextToken;

    const page = await whoopFetch<WhoopCollection<T>>(accessToken, path, query);
    const records = page.records ?? [];
    if (records.length > 0) {
      yield {
        resourceType,
        records: records.map((row) => {
          const rec = row as Record<string, unknown>;
          const id = String(rec.id ?? `${resourceType}-${JSON.stringify(rec).slice(0, 40)}`);
          return {
            providerRecordId: id,
            sourceUpdatedAt: null,
            occurredAt: null,
            payload: row,
          };
        }),
      };
    }
    nextToken = page.next_token ?? null;
  } while (nextToken);
}

export class WhoopProvider implements HealthProvider {
  readonly id = "whoop" as const;

  getCapabilities(): ProviderCapabilities {
    return {
      provider: this.id,
      oauth: "supported",
      backfill: "supported",
      incrementalSync: "supported",
      webhooks: "supported",
      sleep: "supported",
      activities: "supported",
      recovery: "supported",
      bodyComposition: "supported",
      fitFiles: "unsupported",
      calendarRead: "unsupported",
      notes: [
        "Official WHOOP Developer API. Webhooks for sleep/recovery/workout; reconcile via poll.",
        "No cycle webhooks — poll /v2/cycle. Continuous HR via REST unsupported.",
      ],
    };
  }

  getAuthorizationUrl(state: string, _pkce: Pkce): string {
    const config = resolveHealthConfig();
    if (!config.whoopClientId || !config.whoopRedirectUri) {
      throw new Error("WHOOP OAuth not configured. Set WHOOP_CLIENT_ID and WHOOP_REDIRECT_URI.");
    }
    // Official WHOOP OAuth = confidential client (client_secret). No PKCE in docs.
    // state must be exactly 8 characters (WHOOP OAuth docs).
    if (state.length !== 8) {
      throw new Error("WHOOP OAuth state must be exactly 8 characters");
    }
    const url = new URL(WHOOP_AUTH);
    url.searchParams.set("client_id", config.whoopClientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", config.whoopRedirectUri);
    url.searchParams.set("scope", DEFAULT_SCOPES);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string, _pkce: Pkce): Promise<TokenBundle> {
    const config = resolveHealthConfig();
    if (!config.whoopClientId || !config.whoopClientSecret || !config.whoopRedirectUri) {
      throw new Error("WHOOP OAuth env incomplete.");
    }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.whoopRedirectUri,
      client_id: config.whoopClientId,
      client_secret: config.whoopClientSecret,
    });
    const res = await fetch(WHOOP_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`WHOOP token exchange failed: HTTP ${res.status}`);
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const profile = await whoopFetch<{ user_id: number }>(json.access_token, "/user/profile/basic", {});
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
      providerUserId: String(profile.user_id),
      scope: DEFAULT_SCOPES,
    };
  }

  async refreshAuthorization(account: IntegrationAccountRef): Promise<TokenBundle> {
    const config = resolveHealthConfig();
    if (!config.whoopClientId || !config.whoopClientSecret || !account.refreshTokenEnc) {
      throw new Error("WHOOP refresh unavailable.");
    }
    const refreshToken = decryptSecret(account.refreshTokenEnc);
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.whoopClientId,
      client_secret: config.whoopClientSecret,
      scope: DEFAULT_SCOPES,
    });
    const res = await fetch(WHOOP_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`WHOOP refresh failed: HTTP ${res.status}`);
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? refreshToken,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
      providerUserId: account.providerUserId,
      scope: DEFAULT_SCOPES,
    };
  }

  async revokeAuthorization(_account: IntegrationAccountRef): Promise<void> {
    // WHOOP docs: delete tokens client-side / disconnect in dashboard.
    return;
  }

  private async accessToken(account: IntegrationAccountRef): Promise<string> {
    return decryptSecret(account.accessTokenEnc);
  }

  async *backfill(
    account: IntegrationAccountRef,
    range: DateRange
  ): AsyncIterable<RawProviderBatch> {
    const token = await this.accessToken(account);
    yield* paginateCollection(token, "/activity/sleep", range, "sleep");
    yield* paginateCollection(token, "/recovery", range, "recovery");
    yield* paginateCollection(token, "/cycle", range, "cycle");
    yield* paginateCollection(token, "/activity/workout", range, "workout");
  }

  incrementalSync(account: IntegrationAccountRef, since: Date): AsyncIterable<RawProviderBatch> {
    return this.backfill(account, { from: since, to: new Date() });
  }

  async handleWebhook(headers: Headers, body: unknown): Promise<WebhookResult> {
    const event = headers.get("X-WHOOP-Event") ?? headers.get("x-whoop-event") ?? "";
    const hints: string[] = [];
    if (event.includes("sleep")) hints.push("sleep");
    if (event.includes("recovery")) hints.push("recovery");
    if (event.includes("workout")) hints.push("workout");
    return {
      acknowledged: true,
      shouldPull: true,
      resourceHints: hints.length ? hints : ["sleep", "recovery", "workout"],
      message: typeof body === "object" ? "whoop webhook" : "whoop webhook",
    };
  }

  normalizeHealthData(raw: {
    resourceType: string;
    payload: unknown;
    providerUserId: string;
    providerRecordId: string;
    sourceUpdatedAt: Date | null;
  }): NormalizedHealthDaily[] {
    if (raw.resourceType !== "recovery" && raw.resourceType !== "cycle") return [];
    const payload = raw.payload as Record<string, unknown>;
    const score = (payload.score as Record<string, unknown> | undefined) ?? payload;
    const mapped = {
      localDate: String(payload.created_at ?? payload.start ?? "").slice(0, 10),
      restingHr: score.resting_heart_rate,
      hrvMs: score.hrv_rmssd_milli,
      recoveryScore: score.recovery_score,
      spo2Avg: score.spo2_percentage,
      respirationAvg: score.respiratory_rate,
    };
    const row = normalizeHealthDailyPayload({
      provider: this.id,
      providerUserId: raw.providerUserId,
      providerRecordId: raw.providerRecordId,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      payload: mapped,
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
    if (raw.resourceType !== "workout") return [];
    const payload = raw.payload as Record<string, unknown>;
    const score = (payload.score as Record<string, unknown> | undefined) ?? {};
    const mapped = {
      sport: payload.sport_name ?? payload.sport_id ?? "workout",
      startAt: payload.start,
      endAt: payload.end,
      distanceM: score.distance_meter,
      caloriesKcal: score.kilojoule != null ? Number(score.kilojoule) / 4.184 : null,
      hrAvg: score.average_heart_rate,
      hrMax: score.max_heart_rate,
      elevationGainM: score.altitude_gain_meter,
      trainingLoad: score.strain,
    };
    const row = normalizeActivityPayload({
      provider: this.id,
      providerUserId: raw.providerUserId,
      providerRecordId: raw.providerRecordId,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      payload: mapped,
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
    const payload = raw.payload as Record<string, unknown>;
    const score = (payload.score as Record<string, unknown> | undefined) ?? {};
    const stages = (score.stage_summary as Record<string, unknown> | undefined) ?? {};
    const mapped = {
      startAt: payload.start,
      endAt: payload.end,
      sleepScore: score.sleep_performance_percentage,
      lightMin:
        stages.total_light_sleep_time_milli != null
          ? Number(stages.total_light_sleep_time_milli) / 60000
          : null,
      deepMin:
        stages.total_slow_wave_sleep_time_milli != null
          ? Number(stages.total_slow_wave_sleep_time_milli) / 60000
          : null,
      remMin:
        stages.total_rem_sleep_time_milli != null
          ? Number(stages.total_rem_sleep_time_milli) / 60000
          : null,
      awakeMin:
        stages.total_awake_time_milli != null
          ? Number(stages.total_awake_time_milli) / 60000
          : null,
      timeInBedMin:
        stages.total_in_bed_time_milli != null
          ? Number(stages.total_in_bed_time_milli) / 60000
          : null,
    };
    const row = normalizeSleepPayload({
      provider: this.id,
      providerUserId: raw.providerUserId,
      providerRecordId: raw.providerRecordId,
      sourceUpdatedAt: raw.sourceUpdatedAt,
      payload: mapped,
    });
    return row ? [row] : [];
  }
}

export const whoopProvider = new WhoopProvider();
