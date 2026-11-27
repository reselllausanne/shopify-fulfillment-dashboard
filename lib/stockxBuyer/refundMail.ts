/**
 * StockX cancel / refund mails (FR + EN). Pure: no IMAP, no DB.
 * A linked buy goes back to the queue only when this mail (or the API) says
 * that same StockX number is dead. A different still-active number stays.
 */

export type RefundKind = "refund" | "cancel";

export type RefundMail = {
  kind: RefundKind;
  /** Title after the colon, size stripped. */
  product: string | null;
  size: string | null;
  stockxOrderNumber: string | null;
  subject: string;
};

const REFUND_RE =
  /remboursement\s+effectu[ée]|refund\s+issued|refund\s+(?:has been\s+)?(?:processed|completed)|you(?:'ve| have) been refunded|remboursement/i;
const CANCEL_RE =
  /commande\s+(?:a\s+[ée]t[ée]\s+)?annul[ée]e|annulation\s+de\s+commande|order\s+cancell?ed|your\s+order\s+(?:was|has been)\s+cancell?ed/i;

const ORDER_RE = /\b(0[13]-[A-Z0-9]{6,})\b/i;
const SIZE_RE = /\((\d{2}(?:[.,]\d)?(?:\s*\/\s*\d{1,2})?|OS|one size|[2-4]?X{0,2}[SLM]|XXS)\)\s*$/i;

export function isStockxRefundOrCancelSubject(subject: string): boolean {
  const s = String(subject || "");
  return REFUND_RE.test(s) || CANCEL_RE.test(s);
}

export function parseStockxRefundMail(input: { subject: string; body?: string | null }): RefundMail | null {
  const subject = String(input.subject || "").replace(/\s+/g, " ").trim();
  if (!isStockxRefundOrCancelSubject(subject)) return null;
  const body = String(input.body || "");
  const blob = `${subject}\n${body}`;
  const kind: RefundKind = REFUND_RE.test(subject) && !/annul|cancell?ed/i.test(subject) ? "refund" : CANCEL_RE.test(subject) ? "cancel" : "refund";
  const order = blob.match(ORDER_RE);
  let product: string | null = null;
  let size: string | null = null;
  const after = subject.split(/:\s*/).slice(1).join(": ").trim();
  if (after && !isStockxRefundOrCancelSubject(after)) {
    const sizeMatch = after.match(SIZE_RE);
    if (sizeMatch) {
      size = sizeMatch[1].replace(",", ".");
      product = after.slice(0, sizeMatch.index).trim() || null;
    } else {
      product = after;
    }
  }
  return {
    kind,
    product,
    size,
    stockxOrderNumber: order ? order[1].toUpperCase() : null,
    subject,
  };
}

export type RefundLink = {
  source: "shopify" | "galaxus";
  orderRef: string;
  product: string;
  size: string | null;
  stockxOrderNumber: string;
  stockxStatus: string | null;
  /** Manual / local / external: never auto-release. */
  manual: boolean;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleMatches(mailProduct: string, rowProduct: string): boolean {
  const a = norm(mailProduct);
  const b = norm(rowProduct);
  if (!a || !b) return false;
  if (b.includes(a) || a.includes(b)) return true;
  const words = a.split(" ").filter((w) => w.length > 2);
  const head = words.slice(0, 3);
  if (head.length >= 2 && head.every((w) => b.includes(w))) return true;
  if (words.length < 2) return false;
  const hit = words.filter((w) => b.includes(w)).length;
  return hit >= Math.min(words.length, 3) && hit / words.length >= 0.6;
}

function sizeMatches(mailSize: string | null, rowSize: string | null, rowProduct: string): boolean {
  if (!mailSize) return true;
  const want = mailSize.replace(",", ".").toLowerCase();
  const blob = `${rowSize ?? ""} ${rowProduct}`.toLowerCase().replace(",", ".");
  return blob.includes(want);
}

export type RefundDecision = {
  release: boolean;
  reason: string;
  link: RefundLink | null;
};

/**
 * One mail, many linked buys. Release only the dead StockX number.
 * A different live number on another row is not this refund.
 */
export function decideRefundRelease(mail: RefundMail, links: RefundLink[]): RefundDecision {
  const num = mail.stockxOrderNumber;
  if (num) {
    const row = links.find((l) => l.stockxOrderNumber.toUpperCase() === num);
    if (!row) return { release: false, reason: "order_not_linked", link: null };
    if (row.manual) return { release: false, reason: "manual", link: row };
    const st = String(row.stockxStatus ?? "").toUpperCase();
    if (st.includes("CANCEL") || st.includes("REFUND")) return { release: true, reason: "already_terminal", link: row };
    return { release: true, reason: mail.kind, link: row };
  }
  if (!mail.product) return { release: false, reason: "no_product", link: null };
  const hits = links.filter(
    (l) => !l.manual && titleMatches(mail.product!, l.product) && sizeMatches(mail.size, l.size, l.product)
  );
  if (hits.length !== 1) return { release: false, reason: hits.length ? "ambiguous_product" : "product_not_linked", link: null };
  return { release: true, reason: mail.kind, link: hits[0] };
}
