"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    // Public returns portal (standalone + Shopify embed): always light.
    // Ops dark theme in localStorage must not leak into customer UI / iframe.
    const path = window.location.pathname || "";
    const isReturns = path === "/returns" || path.startsWith("/returns/");
    if (isReturns || document.documentElement.dataset.embed === "1") {
      setTheme("light");
      applyTheme("light");
      return;
    }
    const stored = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial: Theme = stored === "dark" || stored === "light" ? stored : prefersDark ? "dark" : "light";
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggleTheme = () => {
    if (typeof window !== "undefined") {
      const path = window.location.pathname || "";
      if (
        path === "/returns" ||
        path.startsWith("/returns/") ||
        document.documentElement.dataset.embed === "1"
      ) {
        return;
      }
    }
    setTheme((prev) => {
      const next: Theme = prev === "light" ? "dark" : "light";
      localStorage.setItem("theme", next);
      applyTheme(next);
      return next;
    });
  };

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
