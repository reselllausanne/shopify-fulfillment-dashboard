const normalizeSegment = (value: string) =>
  value.trim().replace(/\s+/g, "_").replace(/:/g, "-");

export function buildOperatingEventKey(options: {
  sourceType: string;
  sourceRecordId: string | null | undefined;
  sourceLineId?: string | null;
  eventType: string;
}) {
  if (!options.sourceRecordId) return null;
  const parts = [
    normalizeSegment(options.sourceType),
    normalizeSegment(options.sourceRecordId),
  ];
  if (options.sourceLineId) {
    parts.push(normalizeSegment(options.sourceLineId));
  }
  parts.push(normalizeSegment(options.eventType));
  return parts.join(":");
}

export function buildExpectedCashEventKey(options: {
  operatingEventId?: string | null;
  manualFinanceEventId?: string | null;
  derivationMethod: string;
  suffix?: string | null;
}) {
  const source =
    options.operatingEventId ||
    options.manualFinanceEventId ||
    null;
  if (!source) return null;
  const parts = [normalizeSegment(source), normalizeSegment(options.derivationMethod)];
  if (options.suffix) {
    parts.push(normalizeSegment(options.suffix));
  }
  return parts.join(":");
}
