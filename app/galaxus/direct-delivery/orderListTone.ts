type OrderLinkCounts = {
  linkedCount?: number;
  _count?: { lines?: number };
};

function linkCounts(order: OrderLinkCounts): { lines: number; linked: number } {
  return {
    lines: order._count?.lines ?? 0,
    linked: order.linkedCount ?? 0,
  };
}

/** True when the "N/M linked" label is short of every line. */
export function orderListNeedsLink(order: OrderLinkCounts): boolean {
  const { lines, linked } = linkCounts(order);
  return lines > 0 && linked < lines;
}

/** True when every line on the card is linked. */
export function orderListFullyLinked(order: OrderLinkCounts): boolean {
  const { lines, linked } = linkCounts(order);
  return lines > 0 && linked >= lines;
}

/**
 * List card color follows the linked ratio on the card.
 * Unlinked / partial = red. Fully linked = green.
 * needsBuyCount and "new order" must not repaint this.
 */
export function orderListCardClass(order: OrderLinkCounts, selected: boolean): string {
  const linkTone = orderListNeedsLink(order)
    ? "border-red-600 bg-red-200"
    : orderListFullyLinked(order)
      ? "border-green-700 bg-green-200"
      : "border-gray-200 bg-white";
  return selected ? `${linkTone} ring-2 ring-black` : linkTone;
}
