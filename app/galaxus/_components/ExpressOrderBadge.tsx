export function ExpressOrderBadge({ express }: { express?: boolean | null }) {
  if (!express) return null;
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-600 text-white"
      title="Galaxus arrival date is within 5 days and still due. Ship this order fast."
    >
      EXPRESS
    </span>
  );
}
