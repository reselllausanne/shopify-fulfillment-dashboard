export const SWEAT_FORMULA_VERSION = "sweat_loss_v1";

export type SweatTestInput = {
  weightBeforeKg: number;
  weightAfterKg: number;
  fluidConsumedL: number;
  urineProducedL: number;
  durationHours: number;
  /** Optional measured/parameterized — never inferred from volume alone. */
  sweatSodiumMgPerL?: number | null;
};

export type SweatTestResult = {
  sweatLossL: number;
  sweatRateLPerHour: number;
  formulaVersion: string;
};

/**
 * sweat_loss_liters = weight_before - weight_after + fluid_consumed - urine
 * sweat_rate_l_per_hour = sweat_loss / duration_hours
 */
export function computeSweatTest(input: SweatTestInput): SweatTestResult {
  if (!(input.durationHours > 0)) {
    throw new Error("durationHours must be > 0");
  }
  const sweatLossL =
    input.weightBeforeKg -
    input.weightAfterKg +
    input.fluidConsumedL -
    input.urineProducedL;
  return {
    sweatLossL,
    sweatRateLPerHour: sweatLossL / input.durationHours,
    formulaVersion: SWEAT_FORMULA_VERSION,
  };
}
