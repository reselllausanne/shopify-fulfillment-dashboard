import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";

const DEFAULT_ITERATIONS = 120000;
const KEY_LENGTH = 32;

function toHex(buffer: Buffer) {
  return buffer.toString("hex");
}

export function hashPassword(password: string, salt?: string) {
  const actualSalt = salt ?? randomBytes(16).toString("hex");
  const derived = pbkdf2Sync(password, actualSalt, DEFAULT_ITERATIONS, KEY_LENGTH, "sha256");
  return `pbkdf2$${DEFAULT_ITERATIONS}$${actualSalt}$${toHex(derived)}`;
}

export function verifyPassword(password: string, stored: string) {
  if (!stored) return false;
  if (stored.startsWith("plain:")) {
    return password === stored.slice("plain:".length);
  }
  if (stored.startsWith("pbkdf2$")) {
    const [, iterRaw, salt, hash] = stored.split("$");
    const iterations = Number.parseInt(iterRaw ?? "", 10);
    if (!iterations || !salt || !hash) return false;
    const derived = pbkdf2Sync(password, salt, iterations, KEY_LENGTH, "sha256");
    return timingSafeEqual(Buffer.from(hash, "hex"), derived);
  }
  if (stored.includes(":")) {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const derived = pbkdf2Sync(password, salt, DEFAULT_ITERATIONS, KEY_LENGTH, "sha256");
    return timingSafeEqual(Buffer.from(hash, "hex"), derived);
  }
  return password === stored;
}
