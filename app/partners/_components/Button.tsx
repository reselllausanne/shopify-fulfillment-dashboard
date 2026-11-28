import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { FOCUS, cx } from "./ui";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

const BASE = "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-[32px] px-3 py-1 text-[13px]",
  md: "min-h-[40px] px-4 py-2 text-sm",
};

// Primary: bright green with near-black text (white on #02C73A is not readable enough).
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-[#02C73A] text-[#04220D] hover:bg-[#02B334] active:bg-[#02A12F]",
  secondary:
    "border border-[#D9DDD9] bg-white text-[#141A16] hover:border-[#BFC6C0] hover:bg-[#F7F8F7] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800",
  ghost: "text-[#017723] hover:bg-[#E6F9EB] dark:text-[#5BE584] dark:hover:bg-[#02C73A]/10",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string): string {
  return cx(BASE, SIZES[size], VARIANTS[variant], FOCUS, className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  busy?: boolean;
};

export function Button({ variant = "secondary", size = "md", icon, busy, className, children, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={buttonClass(variant, size, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

type ButtonLinkProps = {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function ButtonLink({ href, variant = "secondary", size = "md", icon, className, children }: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {icon}
      {children}
    </Link>
  );
}
