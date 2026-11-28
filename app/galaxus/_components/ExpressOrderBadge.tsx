export function ExpressOrderBadge({ express }: { express?: boolean | null }) {
  if (!express) return null;
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-600 text-white"
      title="Stamped when the offer was on the 48h route, or promised by 6 Dec 2026. A shorter normal delay later does not flip this on."
    >
      EXPRESS
    </span>
  );
}
