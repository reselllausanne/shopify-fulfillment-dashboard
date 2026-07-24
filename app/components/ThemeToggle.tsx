"use client";

import { useTheme } from "@/app/components/ThemeProvider";

type ThemeToggleProps = {
  className?: string;
};

const DEFAULT_CLASS =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white";

export default function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Night mode"}
      className={className ?? DEFAULT_CLASS}
    >
      {theme === "dark" ? "☀️ Light" : "🌙 Night"}
    </button>
  );
}
