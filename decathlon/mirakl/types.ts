export type MiraklImportFlow = "OF01" | "STO01" | "PRI01" | "P41";

export type MiraklImportMode = "NORMAL" | "REPLACE" | "TEST";

export type MiraklImportStatus = "CREATED" | "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";

export type MiraklImportSummary = {
  importId?: string | null;
  status?: string | null;
  /** P51: human-readable reason for current import_status (e.g. AI / operator sync). */
  reasonStatus?: string | null;
  /** P51: operator sync / timing details when present. */
  integrationDetails?: unknown;
  linesInError?: number | null;
  linesRead?: number | null;
  linesInSuccess?: number | null;
  raw?: unknown;
};

export type MiraklErrorSummary = {
  totalErrors: number;
  topReasons: Array<{ reason: string; count: number; sampleSkus: string[] }>;
  sampleRows: Array<{ sku?: string; message?: string; raw?: Record<string, string> }>;
};

export type MiraklErrorReport = {
  summary: MiraklErrorSummary;
  failedSkus: Set<string>;
  csvText: string;
  delimiter: string;
};

export type MiraklImportPayload = {
  importId: string | null;
  summary: MiraklImportSummary | null;
  status: MiraklImportStatus;
  linesInError: number;
};
