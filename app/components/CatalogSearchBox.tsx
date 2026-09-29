"use client";

import { useEffect, useRef, useState } from "react";

export type CatalogSuggestion = {
  id: string;
  supplierVariantId: string;
  providerKey: string | null;
  gtin: string | null;
  supplierSku: string | null;
  supplierProductName: string | null;
  supplierBrand: string | null;
  price: string | number | null;
  stock: number | null;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Enter / "show all" — run the full list search with the current text. */
  onSubmit: (value: string) => void;
  placeholder?: string;
  className?: string;
};

const DEBOUNCE_MS = 250;

function supplierOf(id: string): string {
  const key = id.split(/[_:]/)[0] ?? "";
  return key.toUpperCase();
}

export default function CatalogSearchBox({ value, onChange, onSubmit, placeholder, className }: Props) {
  const [items, setItems] = useState<CatalogSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const q = value.trim();
    // Supplier prefix filter ("rei_") is handled by the list search, not suggestions.
    if (q.length < 2 || /[_:]$/.test(q)) {
      setItems([]);
      setLoading(false);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/galaxus/catalog/suggest?q=${encodeURIComponent(q)}&limit=8`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (seq !== requestSeq.current) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
        setTimedOut(Boolean(data?.timedOut));
        setActive(-1);
      } catch {
        if (seq === requestSeq.current) setItems([]);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (item: CatalogSuggestion) => {
    onChange(item.supplierVariantId);
    setOpen(false);
    onSubmit(item.supplierVariantId);
  };

  const submitText = () => {
    setOpen(false);
    onSubmit(value);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && items[active]) pick(items[active]!);
      else submitText();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showDropdown = open && value.trim().length >= 2 && !/[_:]$/.test(value.trim());

  return (
    <div ref={boxRef} className="relative">
      <input
        className={className ?? "w-full border rounded px-2 py-1 text-sm"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {showDropdown ? (
        <div className="absolute z-50 mt-1 w-[36rem] max-w-[90vw] rounded border bg-white shadow-lg text-xs">
          {loading && items.length === 0 ? (
            <div className="px-3 py-2 text-gray-500">Searching…</div>
          ) : null}
          {!loading && items.length === 0 ? (
            <div className="px-3 py-2 text-gray-500">
              {timedOut ? "Search too slow — press Enter for full search." : "No match."}
            </div>
          ) : null}
          {items.map((item, idx) => {
            const stock = Number(item.stock ?? 0);
            return (
              <button
                key={item.id}
                type="button"
                className={`block w-full text-left px-3 py-2 border-b last:border-b-0 ${
                  idx === active ? "bg-blue-50" : "hover:bg-gray-50"
                }`}
                onMouseEnter={() => setActive(idx)}
                onClick={() => pick(item)}
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-gray-100 px-1 font-mono text-[10px]">
                    {supplierOf(item.supplierVariantId)}
                  </span>
                  <span className="truncate font-medium text-gray-900">
                    {item.supplierProductName || item.supplierSku || item.supplierVariantId}
                  </span>
                </div>
                <div className="mt-0.5 flex gap-3 text-[11px] text-gray-500">
                  <span className="font-mono">{item.gtin ?? "—"}</span>
                  {item.supplierSku ? <span>SKU {item.supplierSku}</span> : null}
                  {item.price != null ? <span>CHF {Number(item.price).toFixed(2)}</span> : null}
                  <span className={stock > 0 ? "text-green-700" : "text-red-600"}>
                    {stock > 0 ? `stock ${stock}` : "out of stock"}
                  </span>
                </div>
              </button>
            );
          })}
          <button
            type="button"
            className="block w-full text-left px-3 py-2 bg-gray-50 text-blue-700 hover:bg-gray-100"
            onClick={submitText}
          >
            Show all results for “{value.trim()}” (Enter)
          </button>
        </div>
      ) : null}
    </div>
  );
}
