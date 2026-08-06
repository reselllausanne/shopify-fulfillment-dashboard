/** BigInt is not JSON-serialisable; every log and debug dump goes through this. */
export function toJsonSafe<T>(value: T): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item));
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toJsonSafe(item);
    }
    return out;
  }
  return value;
}

export function stringifySafe(value: unknown, space?: number): string {
  return JSON.stringify(toJsonSafe(value), null, space);
}
