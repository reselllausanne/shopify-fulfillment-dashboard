/**
 * Customer mail: item could not be sourced. Offers refund to original payment OR store
 * credit increased by N %. Never names the supplier. Does NOT cancel or refund anything:
 * the customer's answer decides which refund path to run.
 *
 * Usage:
 *   npx tsx scripts/send-unavailable-mail.ts --order=7333 [--creditPct=10] [--lang=fr|de|en] [--to=ops@x.ch] [--dry=1]
 *   --to sends to that address instead of the customer (test), subject prefixed [TEST].
 */
import "dotenv/config";
import { loadShopifyLine } from "@/lib/stockxCheckout";
import { getMailer } from "@/app/lib/mailer";
import { mailLanguageFromLocale, type MailLanguage } from "@/app/lib/mailer/language";
import { fetchShopifyCustomerLocale } from "@/app/lib/mailer/orderLocale";

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(`--${name}=`.length);
}

const chf = (n: number) => `CHF ${n.toFixed(2)}`;

export function buildUnavailableMail(input: {
  lang: MailLanguage;
  name: string;
  orderName: string;
  product: string;
  size: string;
  saleChf: number;
  creditPct: number;
}): { subject: string; text: string } {
  const { lang, name, orderName, product, size, saleChf, creditPct } = input;
  const credit = Math.round(saleChf * (1 + creditPct / 100) * 100) / 100;
  if (lang === "de") {
    return {
      subject: `Deine Bestellung ${orderName}: Artikel nicht lieferbar`,
      text:
        `${name ? `Hallo ${name}` : "Hallo"},\n\n` +
        `leider konnten wir trotz intensiver Suche deine ${product} (Grösse ${size}) nicht beschaffen und müssen deine Bestellung ${orderName} daher stornieren, wofür wir uns aufrichtig entschuldigen. ` +
        `Du hast die Wahl: Rückerstattung auf deine ursprüngliche Zahlungsmethode (${chf(saleChf)}) oder ein Shop-Guthaben mit ${creditPct} % Bonus (${chf(credit)}). ` +
        `Antworte einfach auf diese E-Mail mit deiner Wahl, wir kümmern uns sofort darum.\n\n` +
        `Herzliche Grüsse\nResell Lausanne`,
    };
  }
  if (lang === "en") {
    return {
      subject: `Your order ${orderName}: item unavailable`,
      text:
        `${name ? `Hi ${name}` : "Hi"},\n\n` +
        `we are very sorry: despite our best efforts we could not source your ${product} (size ${size}), so we have to cancel your order ${orderName}. ` +
        `You can choose a refund to your original payment method (${chf(saleChf)}) or store credit with a ${creditPct}% bonus (${chf(credit)}). ` +
        `Just reply to this email with your choice and we will take care of it right away.\n\n` +
        `Kind regards,\nResell Lausanne`,
    };
  }
  return {
    subject: `Ta commande ${orderName} : article introuvable`,
    text:
      `${name ? `Bonjour ${name}` : "Bonjour"},\n\n` +
      `nous sommes sincèrement navrés : malgré toutes nos recherches, nous n'avons pas pu trouver tes ${product} (taille ${size}) et nous devons donc annuler ta commande ${orderName}. ` +
      `Tu as le choix entre un remboursement sur ton moyen de paiement d'origine (${chf(saleChf)}) ou un crédit boutique majoré de ${creditPct} % (${chf(credit)}). ` +
      `Réponds simplement à cet e-mail avec ton choix et nous nous en occupons tout de suite.\n\n` +
      `Encore toutes nos excuses pour ce contretemps.\nResell Lausanne`,
  };
}

async function main() {
  const orderArg = arg("order");
  if (!orderArg) throw new Error("usage: --order=7333 [--creditPct=10] [--lang=fr] [--to=...] [--dry=1]");
  const creditPct = Number(arg("creditPct") ?? 10);
  const line = await loadShopifyLine(orderArg.startsWith("#") ? orderArg : `#${orderArg}`);
  const locale = await fetchShopifyCustomerLocale(line.shopifyOrderId ?? "").catch(() => null);
  const lang = ((arg("lang") as MailLanguage | undefined) ?? mailLanguageFromLocale(locale) ?? "fr") as MailLanguage;
  const mail = buildUnavailableMail({
    lang,
    name: line.customerFirstName ?? "",
    orderName: line.orderName,
    product: line.title,
    size: String(line.sizeEU ?? "").replace(/^EU\s*/i, ""),
    saleChf: Number(line.saleChf ?? 0),
    creditPct,
  });
  const override = (arg("to") ?? "").trim();
  const to = override || line.customerEmail || "";
  if (!to) throw new Error("no recipient");
  const subject = override ? `[TEST] ${mail.subject}` : mail.subject;
  console.log(`to=${to} lang=${lang} (customer=${line.customerEmail})\nsubject: ${subject}\n\n${mail.text}`);
  if (arg("dry") === "1") return;
  const res = await getMailer().sendRawEmail({ to, subject, textBody: mail.text, ignoreOverride: true } as any);
  console.log("RESULT", JSON.stringify(res).slice(0, 300));
}

main().catch((e) => {
  console.error("ERR", e?.message || e);
  process.exit(1);
});
