"use client";

import { useState } from "react";
import { ShoeIcon } from "./icons";
import { cx } from "./ui";

type ProductThumbProps = {
  src: string | null | undefined;
  /** Empty by default: the product name is always written next to the picture. */
  alt?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZES = {
  sm: "h-11 w-11",
  md: "h-16 w-16",
  lg: "aspect-square w-full",
};

/** Product picture, or a neutral placeholder when the catalogue has no image (or it fails to load). */
export function ProductThumb({ src, alt = "", size = "sm", className }: ProductThumbProps) {
  const [failed, setFailed] = useState(false);
  const usable = Boolean(src) && !failed;
  return (
    <span
      className={cx(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#EEF0EE] bg-[#F7F8F7] text-[#A3ABA5] dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-600",
        SIZES[size],
        className
      )}
    >
      {usable ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src as string} alt={alt} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-contain" />
      ) : (
        <>
          <ShoeIcon size={size === "lg" ? 56 : size === "md" ? 28 : 22} strokeWidth={size === "lg" ? 1.1 : 1.4} />
          {size === "lg" ? <span className="sr-only">Pas de photo disponible</span> : null}
        </>
      )}
    </span>
  );
}
