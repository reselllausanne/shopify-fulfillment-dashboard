/**
 * Every ~30 min: refund/cancel mails on the promo IMAP box, plus StockX
 * HISTORICAL on both accounts. A terminal linked buy is marked so the
 * existing rebuy path can purchase again. A different live StockX number
 * is left alone. Manual links are never released.
 */
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { prisma } from "@/app/lib/prisma";
import { collectRecipientHints } from "@/lib/stockxEmailOtp";
import { accountForRecipients } from "@/lib/stockxPromo/codes";
import { syncLinkedMatchesFromStockxHistory } from "@/lib/stockxHistoricalCancelSync";
import {
  decideRefundRelease,
  isStockxRefundOrCancelSubject,
  parseStockxRefundMail,
  type RefundLink,
  type RefundMail,
} from "@/lib/stockxBuyer/refundMail";

const SEARCH = ["remboursement", "refund issued", "order canceled", "order cancelled", "annulation", "commande annulee"];

function imapAuth(): { user: string; password: string } | null {
  const user = String(process.env.STOCKX_OTP_IMAP_USER ?? "").trim();
  const password = String(process.env.STOCKX_OTP_IMAP_PASSWORD ?? "").replace(/\s+/g, "");
  if (!user || !password) return null;
  return { user, password };
}

export type ScannedRefund = RefundMail & { account: "shopify" | "galaxus"; emailDate: string };

export async function scanRefundMails(days = 7): Promise<ScannedRefund[]> {
  const auth = imapAuth();
  if (!auth) return [];
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - Math.max(1, days));
  since.setUTCHours(0, 0, 0, 0);
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: auth.user, pass: auth.password },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const ids = new Set<number>();
      for (const phrase of SEARCH) {
        const found = await client.search({ since, from: "stockx.com", text: phrase }, { uid: true }).catch(() => []);
        if (Array.isArray(found)) for (const uid of found) ids.add(Number(uid));
      }
      const uids = [...ids].slice(-80);
      const out: ScannedRefund[] = [];
      if (!uids.length) return out;
      for await (const msg of client.fetch(uids, { uid: true, envelope: true, source: true }, { uid: true })) {
        const subject = String(msg.envelope?.subject ?? "");
        if (!isStockxRefundOrCancelSubject(subject) && !msg.source) continue;
        const parsed = msg.source ? await simpleParser(msg.source) : null;
        const sub = String(parsed?.subject ?? subject);
        const body = `${parsed?.text ?? ""}\n${typeof parsed?.html === "string" ? parsed.html : ""}`;
        const mail = parseStockxRefundMail({ subject: sub, body });
        if (!mail) continue;
        const recipients = collectRecipientHints({
          envelopeTo: msg.envelope?.to,
          envelopeCc: msg.envelope?.cc,
          headers: (parsed?.headers as Map<string, string | string[]>) ?? new Map(),
          rawSource: msg.source,
        });
        out.push({
          ...mail,
          account: accountForRecipients(recipients, process.env.STOCKX_GALAXUS_EMAIL),
          emailDate: (msg.envelope?.date ? new Date(msg.envelope.date) : new Date()).toISOString(),
        });
      }
      return out;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

function manualRow(status: string | null, matchType: string | null, orderNumber: string): boolean {
  const st = String(status ?? "").toUpperCase();
  const mt = String(matchType ?? "").toUpperCase();
  if (mt.includes("MANUAL") || st === "MANUAL" || st === "LOCAL_STOCK" || st.includes("WEL_")) return true;
  if (!/^0[13]-/i.test(orderNumber)) return true;
  return false;
}

async function loadLinks(): Promise<RefundLink[]> {
  const [gx, shop] = await Promise.all([
    (prisma as any).galaxusStockxMatch.findMany({
      where: { stockxOrderNumber: { not: "" } },
      select: {
        stockxOrderNumber: true,
        stockxStatus: true,
        matchType: true,
        galaxusProductName: true,
        galaxusSize: true,
        galaxusOrderRef: true,
      },
    }),
    prisma.orderMatch.findMany({
      where: { stockxOrderNumber: { not: "" }, NOT: { stockxOrderNumber: { startsWith: "pp:" } } },
      select: {
        stockxOrderNumber: true,
        stockxStatus: true,
        matchType: true,
        shopifyProductTitle: true,
        shopifySizeEU: true,
        shopifyOrderName: true,
      },
    }),
  ]);
  const links: RefundLink[] = [];
  for (const row of gx) {
    const num = String(row.stockxOrderNumber || "");
    links.push({
      source: "galaxus",
      orderRef: String(row.galaxusOrderRef || ""),
      product: String(row.galaxusProductName || ""),
      size: row.galaxusSize ? String(row.galaxusSize) : null,
      stockxOrderNumber: num,
      stockxStatus: row.stockxStatus ? String(row.stockxStatus) : null,
      manual: manualRow(row.stockxStatus, row.matchType, num),
    });
  }
  for (const row of shop) {
    const num = String(row.stockxOrderNumber || "");
    links.push({
      source: "shopify",
      orderRef: String(row.shopifyOrderName || ""),
      product: String(row.shopifyProductTitle || ""),
      size: row.shopifySizeEU ? String(row.shopifySizeEU) : null,
      stockxOrderNumber: num,
      stockxStatus: row.stockxStatus ? String(row.stockxStatus) : null,
      manual: manualRow(row.stockxStatus, row.matchType, num),
    });
  }
  return links;
}

async function markTerminal(link: RefundLink, status: "CANCELLED" | "REFUNDED"): Promise<void> {
  const st = String(link.stockxStatus ?? "").toUpperCase();
  if (st.includes("CANCEL") || st.includes("REFUND")) return;
  if (link.source === "galaxus") {
    await (prisma as any).galaxusStockxMatch.updateMany({
      where: { stockxOrderNumber: link.stockxOrderNumber, NOT: { stockxStatus: { in: ["CANCELLED", "REFUNDED"] } } },
      data: { stockxStatus: status, updatedAt: new Date() },
    });
    return;
  }
  await prisma.orderMatch.updateMany({
    where: { stockxOrderNumber: link.stockxOrderNumber, NOT: { stockxStatus: { in: ["CANCELLED", "REFUNDED"] } } },
    data: { stockxStatus: status },
  });
}

export async function applyRefundMails(mails: ScannedRefund[]): Promise<string[]> {
  if (!mails.length) return [];
  const links = await loadLinks();
  const notes: string[] = [];
  for (const mail of mails) {
    const pool = mail.stockxOrderNumber ? links : links.filter((l) => l.source === mail.account);
    const decision = decideRefundRelease(mail, pool);
    if (!decision.release || !decision.link) {
      notes.push(`mail ${mail.kind} ${mail.stockxOrderNumber ?? mail.product ?? "?"} → ${decision.reason}`);
      continue;
    }
    const status = mail.kind === "cancel" ? "CANCELLED" : "REFUNDED";
    await markTerminal(decision.link, status);
    decision.link.stockxStatus = status;
    notes.push(`mail ${mail.kind} ${decision.link.source} ${decision.link.orderRef} ${decision.link.stockxOrderNumber} → ${status}`);
  }
  return notes;
}

/** Mail (7 days) then both StockX accounts' recent HISTORICAL. Never throws. */
export async function watchRefunds(log: (msg: string) => void = () => undefined): Promise<void> {
  try {
    const mails = await scanRefundMails(7);
    log(`refund mail=${mails.length}`);
    const notes = await applyRefundMails(mails);
    for (const n of notes) log(n);
  } catch (e: any) {
    log(`refund mail failed ${e?.message || e}`);
  }
  try {
    const hist = await syncLinkedMatchesFromStockxHistory({ forceRefresh: true, maxPages: 6, first: 50 });
    log(
      `refund api accounts=${hist.accounts} terminal=${hist.terminalNodes} shopify=${hist.shopifyUpdated} galaxus=${hist.galaxusUpdated}`
    );
  } catch (e: any) {
    log(`refund api failed ${e?.message || e}`);
  }
}
