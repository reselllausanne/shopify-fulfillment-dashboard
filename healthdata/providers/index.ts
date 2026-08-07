import { garminProvider } from "@/healthdata/providers/garmin";
import { mockGarminProvider } from "@/healthdata/providers/mockGarmin";
import { whoopProvider } from "@/healthdata/providers/whoop";
import type { HealthProvider } from "@/healthdata/providers/types";
import type { HealthProviderId } from "@/healthdata/types";
import { resolveHealthConfig } from "@/healthdata/config";

export function getProvider(id: HealthProviderId): HealthProvider {
  switch (id) {
    case "mock_garmin":
      return mockGarminProvider;
    case "garmin":
      return garminProvider;
    case "whoop":
      return whoopProvider;
    default:
      throw new Error(`No HealthProvider for ${id}`);
  }
}

/** Prefer real Garmin when credentials present; otherwise mock. */
export function resolveGarminProvider(): HealthProvider {
  const config = resolveHealthConfig();
  if (config.garminClientId && config.garminClientSecret) {
    return garminProvider;
  }
  return mockGarminProvider;
}

export function listProviders(): HealthProvider[] {
  return [mockGarminProvider, garminProvider, whoopProvider];
}
