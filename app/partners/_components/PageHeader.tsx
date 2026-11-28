import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeftIcon } from "./icons";
import { FOCUS, TEXT, TEXT_MUTED, cx } from "./ui";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  className?: string;
};

export function PageHeader({ title, description, actions, back, className }: PageHeaderProps) {
  return (
    <header className={cx("space-y-3", className)}>
      {back ? (
        <Link
          href={back.href}
          className={cx("-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm hover:text-[#017723] dark:hover:text-[#5BE584]", TEXT_MUTED, FOCUS)}
        >
          <ChevronLeftIcon size={16} />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className={cx("text-2xl font-semibold leading-8 tracking-tight", TEXT)}>{title}</h1>
          {description ? <p className={cx("mt-1 max-w-xl text-sm leading-6", TEXT_MUTED)}>{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
