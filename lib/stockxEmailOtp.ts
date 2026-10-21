import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const OTP_CONTEXT =
  /(?:verification|security|authentication|one[- ]time|two[- ]factor|2fa|login|sign[- ]?in|code)/i;

export function extractStockxOtp(text: string): string | null {
  const normalized = text.replace(/\u00a0/g, " ");
  const contextual = [
    /(?:verification|security|authentication|one[- ]time|two[- ]factor|2fa|login|sign[- ]?in|code)[^\d]{0,100}(\d{6})(?!\d)/gi,
    /(?:^|\D)(\d{6})(?!\d)[^\n]{0,100}(?:verification|security|authentication|one[- ]time|two[- ]factor|2fa|login|sign[- ]?in|code)/gi,
  ];
  for (const pattern of contextual) {
    const match = pattern.exec(normalized);
    if (match?.[1]) return match[1];
  }

  const codes = [...normalized.matchAll(/(?:^|\D)(\d{6})(?!\d)/g)].map((match) => match[1]);
  return codes.length === 1 && OTP_CONTEXT.test(normalized) ? codes[0] : null;
}

function mailboxCredentials(): { user: string; password: string } | null {
  const user = String(process.env.STOCKX_OTP_IMAP_USER ?? "").trim();
  const password = String(process.env.STOCKX_OTP_IMAP_PASSWORD ?? "").replace(/\s+/g, "");
  if (!user || !password) return null;
  return { user, password };
}

function isStockxSender(addresses: Array<{ name?: string; address?: string }> | undefined): boolean {
  return Boolean(
    addresses?.some((sender) => {
      const address = String(sender.address ?? "").toLowerCase();
      return /@(?:[\w-]+\.)*stockx\.com$/.test(address);
    })
  );
}

function normalizeEmail(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^<|>$/g, "");
}

function addressList(
  addresses: Array<{ name?: string; address?: string }> | undefined
): string[] {
  return (addresses ?? [])
    .map((entry) => normalizeEmail(entry.address))
    .filter(Boolean);
}

/** Collect To / Delivered-To / X-Original-To style targets from a forwarded StockX OTP. */
export function collectRecipientHints(params: {
  envelopeTo?: Array<{ name?: string; address?: string }>;
  envelopeCc?: Array<{ name?: string; address?: string }>;
  headers?: Map<string, string | string[]> | Record<string, unknown> | null;
  rawSource?: string | Buffer | null;
}): string[] {
  const out = new Set<string>();
  for (const addr of [...addressList(params.envelopeTo), ...addressList(params.envelopeCc)]) {
    out.add(addr);
  }

  const headerObj =
    params.headers instanceof Map
      ? Object.fromEntries(params.headers.entries())
      : (params.headers ?? {});
  for (const key of [
    "to",
    "delivered-to",
    "x-original-to",
    "x-forwarded-to",
    "x-gm-original-to",
    "resent-to",
  ]) {
    const raw = (headerObj as Record<string, unknown>)[key];
    const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    for (const value of values) {
      const matches = String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
      for (const match of matches) out.add(normalizeEmail(match));
    }
  }

  if (params.rawSource) {
    const text = Buffer.isBuffer(params.rawSource)
      ? params.rawSource.toString("utf8")
      : String(params.rawSource);
    // Forwarded StockX mails often keep "To: contact@…" in the body/headers.
    const matches = text.match(/(?:^|\n)(?:to|delivered-to|x-original-to):\s*([^\n]+)/gi) ?? [];
    for (const line of matches) {
      const emails = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
      for (const email of emails) out.add(normalizeEmail(email));
    }
    // Last resort: any email-looking token in the raw MIME (covers stripped forwards).
    const anyEmails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    for (const email of anyEmails) {
      const normalized = normalizeEmail(email);
      if (/resell-lausanne|reselllausanne|stockx/i.test(normalized)) out.add(normalized);
    }
  }

  return [...out];
}

export function recipientMatchesLogin(
  loginEmail: string | null | undefined,
  recipients: string[]
): boolean {
  const target = normalizeEmail(loginEmail);
  if (!target) return true;
  return recipients.some((recipient) => recipient === target);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type StockxOtpResult = {
  code: string | null;
  error: string | null;
};

/**
 * Polls Gmail read-only for a StockX code sent after the login attempt.
 * Messages stay unread and unmodified.
 *
 * `loginEmail` filters forwarded OTPs (e.g. StockX → contact@… → Gmail inbox).
 */
export async function waitForStockxEmailOtp(options: {
  after: Date;
  loginEmail?: string | null;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<StockxOtpResult> {
  const credentials = mailboxCredentials();
  if (!credentials) {
    return { code: null, error: "Missing STOCKX_OTP_IMAP_USER/STOCKX_OTP_IMAP_PASSWORD" };
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: credentials.user, pass: credentials.password },
    logger: false,
  });
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 90_000, 5_000), 180_000);
  const pollMs = Math.min(Math.max(options.pollMs ?? 3_000, 1_000), 10_000);
  const deadline = Date.now() + timeoutMs;
  // Envelope timestamps can differ by a few seconds from the browser submit time.
  const earliest = options.after.getTime() - 30_000;
  const seen = new Set<number>();
  const loginEmail = normalizeEmail(options.loginEmail);

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      while (Date.now() < deadline) {
        const searchResult = await client.search({ since: new Date(earliest) }, { uid: true });
        const uids = Array.isArray(searchResult) ? searchResult : [];
        const candidates = uids.slice(-100).reverse();
        for (const uid of candidates) {
          if (seen.has(uid)) continue;
          seen.add(uid);
          const message = await client.fetchOne(
            uid,
            { uid: true, envelope: true, source: true },
            { uid: true }
          );
          if (!message || !isStockxSender(message.envelope?.from)) continue;
          const envelopeDate = message.envelope?.date;
          const messageTime = envelopeDate ? new Date(envelopeDate).getTime() : 0;
          if (messageTime < earliest || !message.source) continue;

          const parsed = await simpleParser(message.source);
          const recipients = collectRecipientHints({
            envelopeTo: message.envelope?.to,
            envelopeCc: message.envelope?.cc,
            headers: parsed.headers as Map<string, string | string[]>,
            rawSource: message.source,
          });
          if (!recipientMatchesLogin(loginEmail, recipients)) {
            console.log(
              `[STOCKX-OTP] skip uid=${uid} recipients=${recipients.join(",") || "none"} want=${loginEmail}`
            );
            continue;
          }

          const content = `${parsed.subject ?? ""}\n${parsed.text ?? ""}\n${
            typeof parsed.html === "string" ? parsed.html.replace(/<[^>]+>/g, " ") : ""
          }`;
          const code = extractStockxOtp(content);
          if (code) {
            console.log(
              `[STOCKX-OTP] Gmail code found uid=${uid} loginEmail=${loginEmail || "any"}`
            );
            return { code, error: null };
          }
        }
        await sleep(pollMs);
      }
      return {
        code: null,
        error: loginEmail
          ? `Timed out waiting for StockX email code for ${loginEmail}`
          : "Timed out waiting for StockX email code",
      };
    } finally {
      lock.release();
    }
  } catch (error: any) {
    return { code: null, error: error?.message || "Gmail IMAP failure" };
  } finally {
    await client.logout().catch(() => undefined);
  }
}
