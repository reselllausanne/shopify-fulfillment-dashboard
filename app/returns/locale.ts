"use client";

import { useCallback, useEffect, useState } from "react";
import { RETURNS_COPY, type ReturnsLocale, isReturnsLocale } from "./copy";

const STORAGE_KEY = "returns_locale";

export function resolveInitialLocale(): ReturnsLocale {
  if (typeof window === "undefined") return "fr";
  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (fromUrl && isReturnsLocale(fromUrl)) return fromUrl;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && isReturnsLocale(stored)) return stored;
  const browser = window.navigator.language.toLowerCase();
  if (browser.startsWith("de")) return "de";
  if (browser.startsWith("en")) return "en";
  return "fr";
}

export function useReturnsLocale() {
  const [locale, setLocaleState] = useState<ReturnsLocale>("fr");

  useEffect(() => {
    setLocaleState(resolveInitialLocale());
  }, []);

  const setLocale = useCallback((next: ReturnsLocale) => {
    setLocaleState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  return {
    locale,
    setLocale,
    copy: RETURNS_COPY[locale],
  };
}
