"use client";

import { useEffect, useState } from "react";

type Size = { nikeLabel: string; euSize: string; gtin: string };
type Parsed = {
  brand: string;
  name: string;
  sku: string;
  color: string | null;
  images: string[];
  sizes: Size[];
  nikePrice: number | null;
};

/**
 * "Coller un lien produit" — for pairs absent from StockX/KickDB (e.g. Nike baby shoes).
 * 1) Aperçu: reads the page. 2) Prix + stock par taille → crée Shopify + lignes ner: (Galaxus au prochain feed).
 */
export default function NikeUrlCard({
  locationId,
  autoGtin,
  fixedPrice,
  fixedCompareAt,
}: {
  locationId: string;
  autoGtin?: string;
  /** Prix manuel du haut de page (CHF). Seule source du prix de vente. */
  fixedPrice: number | null;
  fixedCompareAt?: number | null;
}) {
  const [url, setUrl] = useState(autoGtin ?? "");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [stock, setStock] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/restock/from-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error ? `${json.error}${json.missing?.length ? ` — ${json.missing.join(", ")}` : ""}` : "Erreur");
      }
      return json;
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    const v = url.trim();
    const json = await call(/^https?:\/\//i.test(v) ? { url: v } : { gtin: v });
    if (json?.ok && json.mode === "preview") {
      if (json.url) setUrl(json.url);
      setParsed(json.parsed);
      setMissing(json.missingFromPage ?? []);
      setStock({});
    }
  }

  // Unknown GTIN scanned → look the page up automatically (once per GTIN).
  useEffect(() => {
    if (autoGtin) void preview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGtin]);

  function payload(dryRun: boolean) {
    // url state is resolved to the official page after preview
    const s: Record<string, number> = {};
    for (const [k, v] of Object.entries(stock)) {
      const n = Math.trunc(Number(v));
      if (n > 0) s[k] = n;
    }
    return { url: url.trim(), sellPrice: fixedPrice, compareAt: fixedCompareAt ?? null, stock: s, locationId, dryRun };
  }

  async function create(dryRun: boolean) {
    const json = await call(payload(dryRun));
    if (json?.ok) {
      setMsg(
        dryRun
          ? `Dry-run OK — ${json.rows?.length ?? 0} tailles. ${json.warnings?.[0] ?? ""}`
          : `Créé (${json.rows?.length ?? 0} tailles). Galaxus: prochain feed.`
      );
    }
  }

  const totalUnits = Object.values(stock).reduce((a, v) => a + (Math.trunc(Number(v)) > 0 ? Math.trunc(Number(v)) : 0), 0);
  const canCreate = !!parsed && missing.length === 0 && fixedPrice != null && fixedPrice > 0 && totalUnits > 0 && !!locationId && !busy;

  return (
    <div className="mt-8 rounded-sm border border-gray-300 bg-white p-4">
      <div className="text-sm font-semibold">Produit hors StockX — GTIN ou lien Nike</div>
      <div className="mt-2 flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && url.trim()) preview();
          }}
          placeholder="GTIN (auto via Google) ou https://www.nike.com/ch/t/…"
          className="flex-1 rounded-sm border border-gray-400 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />
        <button
          type="button"
          onClick={preview}
          disabled={busy || !url.trim()}
          className="rounded-sm bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Lire
        </button>
      </div>

      {parsed && (
        <div className="mt-4">
          <div className="flex gap-3">
            {parsed.images[0] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={parsed.images[0]} alt="" className="h-20 w-20 rounded-sm border object-cover" />
            )}
            <div className="text-sm">
              <div className="font-semibold">
                {parsed.brand} {parsed.name}
              </div>
              <div className="text-xs text-gray-600">
                {parsed.sku} · {parsed.color ?? "couleur ?"} · {parsed.images.length} images
                {parsed.nikePrice != null ? ` · prix Nike ${parsed.nikePrice} CHF` : ""}
              </div>
              {missing.length > 0 && (
                <div className="mt-1 text-xs font-medium text-red-700">À compléter: {missing.join(", ")}</div>
              )}
            </div>
          </div>

          <div className="mt-3 text-xs font-medium">
            {fixedPrice != null ? (
              <span>
                Prix de vente: {fixedPrice.toFixed(2)} CHF (prix manuel du haut)
                {fixedCompareAt ? ` · compare-at ${fixedCompareAt.toFixed(2)}` : " · sans compare-at"}
              </span>
            ) : (
              <span className="text-red-700">Coche « Prix manuel » en haut et saisis le prix de vente.</span>
            )}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {parsed.sizes.map((s) => (
              <label key={s.gtin} className="text-xs">
                {s.nikeLabel} · EU {s.euSize || "?"}
                <input
                  value={stock[s.nikeLabel] ?? ""}
                  onChange={(e) => setStock((p) => ({ ...p, [s.nikeLabel]: e.target.value }))}
                  inputMode="numeric"
                  placeholder="0"
                  className="mt-1 w-full rounded-sm border border-gray-300 px-2 py-1 text-sm focus:border-black focus:outline-none"
                />
              </label>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => create(true)}
              disabled={!canCreate}
              className="rounded-sm border border-gray-500 px-4 py-2 text-sm disabled:opacity-40"
            >
              Dry-run
            </button>
            <button
              type="button"
              onClick={() => create(false)}
              disabled={!canCreate}
              className="rounded-sm bg-green-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Créer ({totalUnits} paires)
            </button>
          </div>
          {!locationId && <div className="mt-2 text-xs text-amber-700">Choisir un emplacement ci-dessus.</div>}
        </div>
      )}

      {msg && <div className="mt-3 text-xs font-medium text-green-800">{msg}</div>}
      {err && <div className="mt-3 text-xs font-medium text-red-700">{err}</div>}
    </div>
  );
}
