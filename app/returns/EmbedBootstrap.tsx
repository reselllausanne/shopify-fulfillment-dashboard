"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

const HEIGHT_MSG = "returns-embed-height";

/** Shopify theme iframe: ?embed=1 */
export function useReturnsEmbed(): boolean {
  const searchParams = useSearchParams();
  return searchParams.get("embed") === "1";
}

/**
 * Sets html[data-embed="1"], forces light theme, posts height to parent.
 * Must run inside Suspense (useSearchParams).
 */
export default function ReturnsEmbedBootstrap() {
  const embed = useReturnsEmbed();

  useEffect(() => {
    if (!embed) return;

    const html = document.documentElement;
    html.dataset.embed = "1";
    html.classList.remove("dark");

    const keepLight = () => {
      if (html.classList.contains("dark")) html.classList.remove("dark");
    };
    const observer = new MutationObserver(keepLight);
    observer.observe(html, { attributes: true, attributeFilter: ["class"] });

    const postHeight = () => {
      try {
        const height = Math.ceil(
          Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
        );
        window.parent?.postMessage({ type: HEIGHT_MSG, height }, "*");
      } catch {
        /* ignore cross-origin / missing parent */
      }
    };
    postHeight();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(postHeight) : null;
    ro?.observe(document.body);
    window.addEventListener("resize", postHeight);

    return () => {
      observer.disconnect();
      ro?.disconnect();
      window.removeEventListener("resize", postHeight);
      delete html.dataset.embed;
    };
  }, [embed]);

  return null;
}
