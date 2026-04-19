import { format } from "date-fns";

export function buildDocNumber(prefix: string, date = new Date()): string {
  const stamp = format(date, "yyyyMMdd-HHmmss");
  return `${prefix}-${stamp}`;
}
