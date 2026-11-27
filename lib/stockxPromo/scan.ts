import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { collectRecipientHints } from "@/lib/stockxEmailOtp";
import { promosFromMail, extractReceiptCodes, stripHtml, type PromoCode } from "@/lib/stockxPromo/codes";
import { mergeScannedPromos, promoCodesFile } from "@/lib/stockxPromo/store";

const SKIP_SUBJECT =
  /order (?:confirmed|shipped)|commande (?:confirm|exp[ée]di)|shipped|livr[ée]e?|out for delivery|tracking number|password|verification code|code de connexion|security code|ask (?:was )?expired|bid (?:was )?expired|price drop|xpress ship|authenticated|we (?:received|got) your/i;

const KEEP_SUBJECT = /promo|discount|reward|\boff\b|%|coupon|offre|r[ée]duction|welcome|cr[ée]dit|code promo|use code/i;

function imapAuth(): { user: string; password: string } | null {
  const user = String(process.env.STOCKX_OTP_IMAP_USER ?? "").trim();
  const password = String(process.env.STOCKX_OTP_IMAP_PASSWORD ?? "").replace(/\s+/g, "");
  if (!user || !password) return null;
  return { user, password };
}

function sinceDate(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const PROMO_TEXT = [
  "promo",
  "discount",
  "reward",
  "coupon",
  "reduction",
  "réduction",
  "use code",
  "code promo",
  "récompense",
  "recompense",
  "remise",
];

async function searchUids(client: ImapFlow, since: Date): Promise<number[]> {
  const ids = new Set<number>();
  const add = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const uid of list) ids.add(Number(uid));
  };
  // Phrase search, not every StockX mail (order + OTP traffic is tens of thousands).
  for (const phrase of PROMO_TEXT) {
    add(await client.search({ since, from: "stockx.com", text: phrase }, { uid: true }));
    add(await client.search({ seen: false, from: "stockx.com", text: phrase }, { uid: true }));
  }
  return [...ids];
}

function wantsBody(subject: string): boolean {
  if (KEEP_SUBJECT.test(subject)) return true;
  if (SKIP_SUBJECT.test(subject)) return false;
  return true;
}

async function scanMailbox(client: ImapFlow, mailbox: string, since: Date): Promise<PromoCode[]> {
  const lock = await client.getMailboxLock(mailbox);
  try {
    const uids = await searchUids(client, since);
    console.error(`[STOCKX-PROMO] ${mailbox} promo-uids=${uids.length}`);
    if (!uids.length) return [];
    const envelopes: Array<{ uid: number; subject: string; date: Date | null }> = [];
    for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
      const subject = String(msg.envelope?.subject ?? "");
      if (!wantsBody(subject)) continue;
      envelopes.push({
        uid: msg.uid,
        subject,
        date: msg.envelope?.date ? new Date(msg.envelope.date) : null,
      });
    }
    envelopes.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
    const capped = envelopes.slice(0, 800);
    if (!capped.length) return [];
    const found: PromoCode[] = [];
    const seenIds = new Set<string>();
    for await (const msg of client.fetch(
      capped.map((row) => row.uid),
      { uid: true, envelope: true, source: true },
      { uid: true }
    )) {
      if (!msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const messageId = String(parsed.messageId ?? msg.uid);
      if (seenIds.has(messageId)) continue;
      seenIds.add(messageId);
      const recipients = collectRecipientHints({
        envelopeTo: msg.envelope?.to,
        envelopeCc: msg.envelope?.cc,
        headers: parsed.headers as Map<string, string | string[]>,
        rawSource: msg.source,
      });
      const body = `${parsed.text ?? ""}\n${typeof parsed.html === "string" ? parsed.html : ""}`;
      const emailDate = (msg.envelope?.date ? new Date(msg.envelope.date) : parsed.date ?? new Date()).toISOString();
      found.push(
        ...promosFromMail({
          subject: String(parsed.subject ?? msg.envelope?.subject ?? ""),
          body,
          recipients,
          emailDate,
          galaxusEmail: process.env.STOCKX_GALAXUS_EMAIL,
        })
      );
    }
    return found;
  } finally {
    lock.release();
  }
}

/** Reward mails stay unread; the order receipt that spent the code is often already read and older than 90 days. */
async function markSpentFromReceipts(client: ImapFlow, mailbox: string, codes: PromoCode[]): Promise<void> {
  const pending = codes.filter((code) => code.status === "unused");
  if (!pending.length) return;
  const lock = await client.getMailboxLock(mailbox);
  try {
    let spent = 0;
    for (const code of pending) {
      let hits: number[] = [];
      try {
        const found = await client.search({ from: "stockx.com", text: code.code }, { uid: true });
        hits = Array.isArray(found) ? found.slice(-4) : [];
      } catch {
        continue;
      }
      if (!hits.length) continue;
      for (const uid of hits) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const blob = stripHtml(`${parsed.text ?? ""}\n${typeof parsed.html === "string" ? parsed.html : ""}`);
        const hit = extractReceiptCodes(blob).some((value) => value.toUpperCase() === code.code.toUpperCase());
        if (!hit) continue;
        code.status = "used";
        code.rejectReason = "seen on order receipt";
        code.holdUntil = null;
        spent += 1;
        break;
      }
    }
    if (spent) console.error(`[STOCKX-PROMO] receipt-spent=${spent}`);
  } finally {
    lock.release();
  }
}

export async function scanStockxPromoMailbox(days = 90): Promise<PromoCode[]> {
  const auth = imapAuth();
  if (!auth) throw new Error("Missing STOCKX_OTP_IMAP_USER/STOCKX_OTP_IMAP_PASSWORD");
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: auth.user, pass: auth.password },
    logger: false,
  });
  await client.connect();
  try {
    const since = sinceDate(days);
    const listed = await client.list().catch(() => []);
    const byUse = (use: string) => listed.find((box) => box.specialUse === use)?.path;
    const byName = (re: RegExp) => listed.find((box) => re.test(box.path))?.path;
    const primary =
      byUse("\\All") ||
      byName(/all mail|tous les messages/i) ||
      listed.find((box) => box.path.toUpperCase() === "INBOX")?.path ||
      "INBOX";
    const spam = byUse("\\Junk") || byName(/spam|courrier ind[ée]sirable|junk/i);
    console.error(`[STOCKX-PROMO] mailboxes primary=${primary} spam=${spam ?? "-"} listed=${listed.length}`);
    const merged: PromoCode[] = [];
    const seen = new Set<string>();
    const take = async (box: string) => {
      const rows = await scanMailbox(client, box, since);
      for (const row of rows) {
        const key = row.code.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
      }
    };
    const missing = (error: unknown) =>
      /does not exist|Mailbox does not exist|unknown mailbox|No such mailbox/i.test(
        `${(error as Error)?.message || ""} ${(error as { responseText?: string }).responseText || ""}`
      );
    let openedPrimary = false;
    for (const box of [primary]) {
      try {
        await take(box);
        openedPrimary = true;
        break;
      } catch (error: unknown) {
        const err = error as Error & { responseStatus?: string; executedCommand?: string; responseText?: string };
        const cmd = /LOGIN|AUTHENTICATE/i.test(err.executedCommand ?? "") ? "(auth)" : (err.executedCommand ?? "-");
        console.error(
          `[STOCKX-PROMO] mailbox ${box} failed status=${err.responseStatus ?? "-"} text=${err.responseText ?? "-"} cmd=${cmd}`
        );
        if (missing(error)) continue;
        throw error;
      }
    }
    if (!openedPrimary) throw new Error("No Gmail mailbox opened for StockX promo scan");
    if (spam && spam !== primary) {
      try {
        await take(spam);
      } catch (error: unknown) {
        if (!missing(error)) {
          const err = error as Error & { responseText?: string };
          console.error(`[STOCKX-PROMO] spam mailbox skipped: ${err.responseText || err.message}`);
        }
      }
    }
    await markSpentFromReceipts(client, primary, merged);
    return merged;
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function scanAndMergePromoCodes(days = 90): Promise<{
  added: number;
  total: number;
  unused: number;
  file: string;
  found: PromoCode[];
}> {
  const found = await scanStockxPromoMailbox(days);
  const stats = await mergeScannedPromos(found);
  return { ...stats, file: promoCodesFile(), found };
}
