import type { ReactNode } from "react";
import { HAIRLINE, SURFACE, TEXT, TEXT_FAINT, cx } from "./ui";

type CardProps = {
  children: ReactNode;
  className?: string;
  /** Removes the inner padding (tables, lists that go edge to edge). */
  flush?: boolean;
  as?: "div" | "section" | "article" | "li";
  "aria-labelledby"?: string;
  "aria-label"?: string;
};

/** White surface, hairline border, 8 px radius, no shadow. */
export function Card({ children, className, flush, as: Tag = "div", ...aria }: CardProps) {
  return (
    <Tag className={cx("rounded-lg border", SURFACE, HAIRLINE, !flush && "p-4 sm:p-5", className)} {...aria}>
      {children}
    </Tag>
  );
}

type CardHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
  className?: string;
};

export function CardHeader({ title, description, action, id, className }: CardHeaderProps) {
  return (
    <div className={cx("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <h2 id={id} className={cx("text-[15px] font-semibold leading-6", TEXT)}>
          {title}
        </h2>
        {description ? <p className={cx("mt-0.5 text-sm", TEXT_FAINT)}>{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
