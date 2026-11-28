import Link from "next/link";
import { formatDate, formatMoney } from "../_lib/format";
import { requestTypeLabel } from "../_lib/labels";
import { Chip, RequestStatusChip } from "./StatusChip";
import { FOCUS, HAIRLINE, TEXT, TEXT_FAINT, TEXT_MUTED, cx } from "./ui";

/** What both the requests list and the pair detail know about a request. */
export type RequestView = {
  id: string;
  type: string;
  status: string;
  message: string;
  response: string | null;
  createdAt: string;
  answeredAt?: string | null;
  requestedPublicPrice?: string | null;
  currency?: string | null;
  unitId?: string | null;
  unitShortRef?: string | null;
  itemName?: string | null;
  itemSizeLabel?: string | null;
};

type RequestItemProps = {
  request: RequestView;
  /** Hide the link to the pair (already on the pair's page). */
  hideUnit?: boolean;
  className?: string;
};

/** One request of the partner, with the team's answer when there is one. */
export function RequestItem({ request, hideUnit, className }: RequestItemProps) {
  const requested = formatMoney(request.requestedPublicPrice, request.currency);
  const answered = formatDate(request.answeredAt);
  return (
    <article className={cx("space-y-2.5 px-4 py-4 sm:px-5", className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Chip tone="neutral">{requestTypeLabel(request.type)}</Chip>
        <RequestStatusChip status={request.status} />
        <span className={cx("text-xs", TEXT_FAINT)}>Envoyée le {formatDate(request.createdAt) ?? "—"}</span>
      </div>

      {!hideUnit && request.unitId ? (
        <div className="text-sm">
          <span className={TEXT_MUTED}>Paire : </span>
          <Link
            href={`/partners/stock/${request.unitId}`}
            className={cx("rounded-sm font-medium underline decoration-[#02C73A]/50 underline-offset-2 hover:decoration-[#02C73A]", TEXT, FOCUS)}
          >
            {request.itemName ?? "Voir la paire"}
            {request.itemSizeLabel ? ` — pointure ${request.itemSizeLabel}` : ""}
          </Link>
          {request.unitShortRef ? <span className={cx("ml-2 font-mono text-[13px]", TEXT_FAINT)}>{request.unitShortRef}</span> : null}
        </div>
      ) : null}

      {requested ? (
        <div className="text-sm">
          <span className={TEXT_MUTED}>Prix public souhaité : </span>
          <span className={cx("font-semibold tabular-nums", TEXT)}>{requested}</span>
        </div>
      ) : null}

      <p className={cx("whitespace-pre-line break-words text-sm leading-6", TEXT)}>{request.message}</p>

      {request.response ? (
        <div className={cx("rounded-lg border-l-2 border-[#02C73A] bg-[#F3FCF5] px-3.5 py-2.5 dark:bg-[#02C73A]/10")}>
          <div className="text-xs font-semibold text-[#017723] dark:text-[#5BE584]">
            Réponse de Resell Lausanne{answered ? ` — ${answered}` : ""}
          </div>
          <p className={cx("mt-1 whitespace-pre-line break-words text-sm leading-6", TEXT)}>{request.response}</p>
        </div>
      ) : request.status === "OPEN" ? (
        <p className={cx("rounded-lg border border-dashed px-3.5 py-2 text-xs", HAIRLINE, TEXT_FAINT)}>En attente d'une réponse de notre équipe.</p>
      ) : (
        <p className={cx("rounded-lg border border-dashed px-3.5 py-2 text-xs", HAIRLINE, TEXT_FAINT)}>Demande close sans réponse écrite.</p>
      )}
    </article>
  );
}
