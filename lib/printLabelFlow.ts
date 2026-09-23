/**
 * Post-fulfill print decisions. Pure — no DOM, no network.
 * Backend already created the label; this only chooses how to print it.
 */

import {
  decideStationAutoPrint,
  type ExistingLabelRef,
  type PrintFlowEvent,
  type PrintStationConfig,
} from "@/lib/printStation";

export type PostLabelPrintPlan =
  | {
      action: "silent";
      event: "SILENT_PRINT_SUCCEEDED"; // aspirational until client confirms
      label: ExistingLabelRef;
    }
  | {
      action: "browser_fallback";
      event: "SILENT_PRINT_FAILED_FALLBACK_OPENED" | "BROWSER_PRINT_OPENED";
      label: ExistingLabelRef;
      reason: string;
    }
  | {
      action: "skip_already_cups";
      event: "LABEL_CREATED";
      label: ExistingLabelRef;
    }
  | {
      action: "reprint_existing";
      event: "REPRINT_EXISTING_LABEL";
      label: ExistingLabelRef;
      preferSilent: boolean;
    };

export function planAfterLabelCreated(params: {
  label: ExistingLabelRef;
  config: PrintStationConfig;
  qzConnected: boolean;
  printerFound: boolean;
  /** Server CUPS already printed successfully. */
  cupsPrintedOk?: boolean;
}): PostLabelPrintPlan {
  if (params.cupsPrintedOk) {
    return {
      action: "skip_already_cups",
      event: "LABEL_CREATED",
      label: params.label,
    };
  }

  const decision = decideStationAutoPrint({
    config: params.config,
    qzConnected: params.qzConnected,
    printerFound: params.printerFound,
  });

  if (decision.shouldAutoPrint) {
    return {
      action: "silent",
      event: "SILENT_PRINT_SUCCEEDED",
      label: params.label,
    };
  }

  return {
    action: "browser_fallback",
    event: "BROWSER_PRINT_OPENED",
    label: params.label,
    reason: decision.reason,
  };
}

/** Silent print failed → always a browser fallback plan (carries `reason`). */
export type BrowserFallbackPlan = Extract<PostLabelPrintPlan, { action: "browser_fallback" }>;

export function planAfterSilentFailure(params: {
  label: ExistingLabelRef;
  error: string;
}): BrowserFallbackPlan {
  return {
    action: "browser_fallback",
    event: "SILENT_PRINT_FAILED_FALLBACK_OPENED",
    label: params.label,
    reason: params.error || "silent_print_failed",
  };
}

export function planReprintExisting(params: {
  label: ExistingLabelRef;
  config: PrintStationConfig;
  qzConnected: boolean;
  printerFound: boolean;
}): PostLabelPrintPlan {
  const decision = decideStationAutoPrint({
    config: params.config,
    qzConnected: params.qzConnected,
    printerFound: params.printerFound,
  });
  return {
    action: "reprint_existing",
    event: "REPRINT_EXISTING_LABEL",
    label: params.label,
    preferSilent: decision.shouldAutoPrint,
  };
}

/** Test print is always local-only — never a fulfill path. */
export function assertTestPrintIsLocalOnly(events: PrintFlowEvent[]): boolean {
  return events.every((e) => e === "TEST_PRINT_ONLY") && events.length >= 1;
}

export function assertNoSecondLabelCreate(params: {
  fulfillCallCount: number;
  swissPostCallCount: number;
  delrCallCount: number;
}): boolean {
  return (
    params.fulfillCallCount === 0 &&
    params.swissPostCallCount === 0 &&
    params.delrCallCount === 0
  );
}
