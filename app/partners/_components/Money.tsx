import { formatMoney } from "../_lib/format";
import { NO_PRICE_LABEL } from "../_lib/labels";
import { TEXT, TEXT_FAINT, TEXT_MUTED, cx } from "./ui";

type MoneyProps = {
  /** Decimal string from the API. Never computed in the browser. */
  amount: string | null | undefined;
  currency: string | null | undefined;
  className?: string;
  /** Text shown under the dash when there is no amount. */
  emptyHint?: string | null;
};

/** One amount, formatted for Switzerland. Shows "—" when the API returned none. */
export function Money({ amount, currency, className, emptyHint }: MoneyProps) {
  const text = formatMoney(amount, currency);
  if (text === null) {
    return (
      <span className={cx("inline-flex flex-col", className)}>
        <span className="text-[#8A948D] dark:text-slate-500" aria-hidden="true">
          —
        </span>
        <span className={emptyHint ? cx("text-xs font-normal", TEXT_FAINT) : "sr-only"}>{emptyHint ?? "Aucun montant"}</span>
      </span>
    );
  }
  return <span className={cx("whitespace-nowrap tabular-nums", className)}>{text}</span>;
}

type MoneyRangeProps = {
  min: string | null | undefined;
  max: string | null | undefined;
  currency: string | null | undefined;
  className?: string;
  emptyHint?: string | null;
};

/** Lowest and highest amount of a group; a single amount when they are equal. */
export function MoneyRange({ min, max, currency, className, emptyHint }: MoneyRangeProps) {
  const low = formatMoney(min, currency);
  const high = formatMoney(max, currency);
  if (low === null || high === null || low === high) {
    return <Money amount={min ?? max} currency={currency} className={className} emptyHint={emptyHint} />;
  }
  return (
    <span className={cx("tabular-nums", className)}>
      <span className="whitespace-nowrap">{low}</span>
      <span className="mx-1" aria-hidden="true">
        –
      </span>
      <span className="sr-only"> à </span>
      <span className="whitespace-nowrap">{high}</span>
    </span>
  );
}

type PricePairProps = {
  publicPrice: string | null | undefined;
  sellerNet: string | null | undefined;
  currency: string | null | undefined;
  className?: string;
  size?: "sm" | "lg";
};

/** "Prix public" and "Net pour vous", always named and side by side. */
export function PricePair({ publicPrice, sellerNet, currency, className, size = "sm" }: PricePairProps) {
  const figure = size === "lg" ? "text-2xl font-semibold leading-8 tracking-tight" : "text-sm font-semibold";
  const hasPublic = formatMoney(publicPrice, currency) !== null;
  const hasNet = formatMoney(sellerNet, currency) !== null;
  return (
    <dl className={cx("grid grid-cols-2 gap-x-4", className)}>
      <div>
        <dt className={cx("text-xs", TEXT_MUTED)}>Prix public</dt>
        <dd className={cx(figure, TEXT)}>
          <Money amount={publicPrice} currency={currency} emptyHint={hasPublic ? null : NO_PRICE_LABEL} />
        </dd>
      </div>
      <div>
        <dt className={cx("text-xs", TEXT_MUTED)}>Net pour vous</dt>
        <dd className={cx(figure, hasNet ? "text-[#017723] dark:text-[#5BE584]" : TEXT)}>
          <Money amount={sellerNet} currency={currency} emptyHint={hasNet ? null : hasPublic ? "Net à préciser" : NO_PRICE_LABEL} />
        </dd>
      </div>
    </dl>
  );
}
