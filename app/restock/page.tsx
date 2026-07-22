"use client";

import { useEffect, useRef, useState } from "react";

type LookupResult =
  | {
      status: "on-shopify";
      gtin: string;
      variant: {
        variantId: string;
        productId: string;
        productTitle: string | null;
        sku: string | null;
        barcode: string | null;
        price: number | null;
        onSale: boolean;
      };
      ambiguous: boolean;
    }
  | {
      status: "resolved";
      gtin: string;
      slug: string;
      title: string | null;
      brand: string | null;
      styleSku: string | null;
      image: string | null;
      gtinConfirmed: boolean;
      matchedSizeEu: string | null;
      matchedSizeUs: string | null;
    }
  | {
      status: "not-found";
      gtin: string;
      message: string;
    };

type VariantChoice = {
  variantId: string;
  title: string | null;
  sku: string | null;
  barcode: string | null;
  price: string | null;
};

type ApplyResult = {
  ok: boolean;
  status: string;
  gtin: string;
  slug?: string | null;
  shopify?: {
    created: boolean;
    productId: string | null;
    restock?: {
      actions: string[];
      variant?: { productTitle: string | null; sku: string | null; price: number | null };
    };
  };
  db?: { ok: boolean; importedVariantsCount?: number; errors?: string[] };
  variantChoices?: VariantChoice[];
  error?: string;
  warnings?: string[];
};

type LocationOption = { id: string; name: string; priority: number };

const LOCATION_STORAGE_KEY = "restock.locationId";

const AUTO_MODE_STORAGE_KEY = "restock.autoMode";

type HistoryEntry = {
  id: string;
  gtin: string;
  status: "restocked" | "created-restocked" | "size-confirmation-required" | "error";
  ok: boolean;
  title?: string | null;
  quantity: number;
  location: string;
  at: number;
  warning?: string;
};

export default function RestockScanPage() {
  const [gtin, setGtin] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [manualId, setManualId] = useState("");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [variantChoices, setVariantChoices] = useState<VariantChoice[] | null>(null);
  const [pendingIdentifier, setPendingIdentifier] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState<string>("");
  const [autoMode, setAutoMode] = useState<boolean>(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load physical locations + restore previous choice (persists per browser so a
  // scanner user doesn't reselect after each session).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/restock/locations");
        const data = await res.json();
        if (cancelled || !data?.ok) return;
        const list: LocationOption[] = data.locations ?? [];
        setLocations(list);
        const saved = typeof window !== "undefined" ? window.localStorage.getItem(LOCATION_STORAGE_KEY) : null;
        const initial = saved && list.some((l) => l.id === saved) ? saved : list[0]?.id ?? "";
        setLocationId(initial);
      } catch {
        // silent — falls back to server default (Bussigny)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function pickLocation(id: string) {
    setLocationId(id);
    if (typeof window !== "undefined") window.localStorage.setItem(LOCATION_STORAGE_KEY, id);
  }

  // Persist mass-scan preference between sessions (scanner user).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(AUTO_MODE_STORAGE_KEY);
    if (saved === "1") setAutoMode(true);
  }, []);

  function toggleAutoMode(next: boolean) {
    setAutoMode(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AUTO_MODE_STORAGE_KEY, next ? "1" : "0");
    }
  }

  function pushHistory(entry: Omit<HistoryEntry, "id" | "at">) {
    setHistory((prev) => [
      { id: Math.random().toString(36).slice(2), at: Date.now(), ...entry },
      ...prev.slice(0, 19),
    ]);
  }

  const currentLocationName = locations.find((l) => l.id === locationId)?.name ?? null;
  const locationReady = Boolean(locationId && currentLocationName);

  function resetAll() {
    setLookup(null);
    setApplyResult(null);
    setVariantChoices(null);
    setPendingIdentifier(null);
    setError(null);
    setManualId("");
  }

  async function runLookup() {
    const cleaned = gtin.trim();
    if (!cleaned) return;
    resetAll();
    setBusy("Recherche…");
    try {
      const res = await fetch(`/api/restock/scan?gtin=${encodeURIComponent(cleaned)}`);
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Recherche échouée");
      } else {
        const result = data.result as LookupResult;
        setLookup(result);

        // Mass-scan flow: if already on Shopify, immediately restock and clear
        // for the next scan. Anything else (KickDB match / unknown) still needs
        // manual confirmation because product creation is not idempotent per
        // scan and we don't want to silently create wrong SKUs.
        if (autoMode && result.status === "on-shopify" && locationId) {
          await runApply({}, "Auto restock…", { autoScan: true });
        }
      }
    } catch (err: any) {
      setError(err?.message ?? "Erreur réseau");
    } finally {
      setBusy(null);
    }
  }

  async function runApply(
    body: Record<string, unknown>,
    busyLabel: string,
    options: { autoScan?: boolean } = {}
  ) {
    if (!locationId) {
      setError("Choisir un emplacement (Bussigny / Antica / THE LAB) avant restock");
      return;
    }
    setBusy(busyLabel);
    setError(null);
    try {
      const scannedGtin = gtin.trim();
      const currentLoc = currentLocationName ?? "?";
      const res = await fetch("/api/restock/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          gtin: scannedGtin,
          quantity,
          // locationId LAST — never let body overwrite the picker selection
          locationId,
        }),
      });
      const data = (await res.json()) as ApplyResult;
      setApplyResult(data);
      if (data.status === "size-confirmation-required" && data.variantChoices) {
        setVariantChoices(data.variantChoices);
        setPendingIdentifier((body.identifier as string) ?? null);
      } else {
        setVariantChoices(null);
      }
      if (!data.ok && data.status !== "size-confirmation-required") {
        setError(data.error ?? "Échec");
      }
      // Mass-scan flow — record + clear immediately for the next scan.
      if (options.autoScan) {
        pushHistory({
          gtin: scannedGtin,
          status: (data.status as HistoryEntry["status"]) ?? "error",
          ok: Boolean(data.ok),
          title: data.shopify?.restock?.variant?.productTitle ?? null,
          quantity,
          location: currentLoc,
          warning: data.warnings?.[0],
        });
        setGtin("");
        setLookup(null);
        setApplyResult(null);
        setError(null);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    } catch (err: any) {
      setError(err?.message ?? "Erreur réseau");
    } finally {
      setBusy(null);
    }
  }

  const doneOk = applyResult?.ok === true;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Restock — Scan produit</h1>
      <p className="mt-1 text-sm text-gray-500">
        Scanner le GTIN (barcode boîte). Stock ajouté uniquement à{" "}
        <strong>{currentLocationName ?? "…choisir emplacement…"}</strong>.
      </p>

      <div className="mt-3 flex items-center gap-2 text-sm">
        <label className="inline-flex items-center gap-2 select-none">
          <input
            type="checkbox"
            checked={autoMode}
            onChange={(e) => toggleAutoMode(e.target.checked)}
            className="h-4 w-4"
          />
          <span>
            Mass-scan (auto-restock si déjà sur Shopify — sinon confirmation manuelle)
          </span>
        </label>
      </div>

      {locations.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {locations.map((loc) => {
            const active = loc.id === locationId;
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => pickLocation(loc.id)}
                className={`rounded-sm border px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "border-black bg-black text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:border-black"
                }`}
              >
                {loc.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex gap-2">
        <input
          ref={inputRef}
          value={gtin}
          onChange={(e) => setGtin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runLookup();
          }}
          placeholder="GTIN / barcode…"
          inputMode="numeric"
          className="flex-1 rounded-sm border border-gray-300 px-3 py-2 text-lg focus:border-black focus:outline-none"
        />
        <input
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
          className="w-20 rounded-sm border border-gray-300 px-3 py-2 text-lg focus:border-black focus:outline-none"
          title="Quantité"
        />
        <button
          onClick={runLookup}
          disabled={!!busy || !gtin.trim()}
          className="rounded-sm bg-black px-5 py-2 font-medium text-white disabled:opacity-40"
        >
          {busy ?? "Scanner"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-sm border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Lookup: found on Shopify */}
      {lookup?.status === "on-shopify" && !applyResult && (
        <div className="mt-6 rounded-sm border border-green-300 bg-green-50 p-4">
          <div className="text-sm font-semibold text-green-900">Trouvé sur Shopify</div>
          <div className="mt-2 text-sm text-gray-800">
            <div className="font-medium">{lookup.variant.productTitle ?? "(sans titre)"}</div>
            <div>SKU: {lookup.variant.sku ?? "—"} · Prix: {lookup.variant.price ?? "—"}</div>
            {lookup.ambiguous && (
              <div className="mt-1 text-amber-700">
                Attention: plusieurs variantes partagent ce GTIN.
              </div>
            )}
          </div>
          <button
            onClick={() => runApply({}, "Restock…")}
            disabled={!!busy || !locationReady}
            className="mt-3 rounded-sm bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Ajouter {quantity} en stock à {currentLocationName ?? "…"}
          </button>
        </div>
      )}

      {/* Lookup: resolved on KickDB */}
      {lookup?.status === "resolved" && !applyResult && (
        <div className="mt-6 rounded-sm border border-blue-300 bg-blue-50 p-4">
          <div className="text-sm font-semibold text-blue-900">
            Pas sur Shopify — trouvé sur KickDB
          </div>
          <div className="mt-2 flex gap-3">
            {lookup.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lookup.image} alt="" className="h-20 w-20 rounded-sm object-cover" />
            )}
            <div className="text-sm text-gray-800">
              <div className="font-medium">{lookup.title ?? lookup.slug}</div>
              <div>SKU style: {lookup.styleSku ?? "—"} · {lookup.brand ?? ""}</div>
              <div className="mt-1">
                {lookup.gtinConfirmed ? (
                  <span className="text-green-700">
                    GTIN confirmé sur KickDB (taille EU {lookup.matchedSizeEu ?? "?"})
                  </span>
                ) : (
                  <span className="text-amber-700">
                    GTIN non confirmé sur les variantes KickDB — confirmation taille après création
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => runApply({ identifier: lookup.slug }, "Création + restock…")}
            disabled={!!busy || !locationReady}
            className="mt-3 rounded-sm bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Créer le produit + stock {currentLocationName ?? "…"}
          </button>
        </div>
      )}

      {/* Lookup: not found -> manual input */}
      {lookup?.status === "not-found" && !applyResult && (
        <div className="mt-6 rounded-sm border border-amber-300 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-900">{lookup.message}</div>
          <div className="mt-3 flex gap-2">
            <input
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && manualId.trim()) {
                  runApply({ identifier: manualId.trim() }, "Création + restock…");
                }
              }}
              placeholder="SKU boîte (ex: JS0250) ou slug StockX…"
              className="flex-1 rounded-sm border border-gray-300 px-3 py-2 focus:border-black focus:outline-none"
            />
            <button
              onClick={() => runApply({ identifier: manualId.trim() }, "Création + restock…")}
              disabled={!!busy || !manualId.trim() || !locationReady}
              className="rounded-sm bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Créer + restock
            </button>
          </div>
        </div>
      )}

      {/* Size confirmation guard */}
      {variantChoices && applyResult?.status === "size-confirmation-required" && (
        <div className="mt-6 rounded-sm border border-amber-300 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-900">
            GTIN scanné ≠ barcodes du produit créé — choisir la taille physique de la paire
          </div>
          <div className="mt-1 text-xs text-amber-800">
            Le GTIN scanné sera écrit comme barcode sur la variante choisie.
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {variantChoices.map((v) => (
              <button
                key={v.variantId}
                onClick={() =>
                  runApply(
                    { identifier: pendingIdentifier, confirmVariantId: v.variantId },
                    "Confirmation…"
                  )
                }
                disabled={!!busy}
                className="rounded-sm border border-gray-300 bg-white px-2 py-2 text-sm hover:border-black disabled:opacity-40"
              >
                <div className="font-medium">{v.title ?? "?"}</div>
                <div className="text-xs text-gray-500">{v.price ?? ""}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Final result */}
      {/* Mass-scan history */}
      {autoMode && history.length > 0 && (
        <div className="mt-6 rounded-sm border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Historique mass-scan (session)
          </div>
          <ul className="divide-y divide-gray-100 text-sm">
            {history.map((h) => (
              <li
                key={h.id}
                className={`flex items-center justify-between px-4 py-2 ${
                  h.ok ? "" : "bg-red-50"
                }`}
              >
                <div className="flex-1 truncate">
                  <span className={h.ok ? "text-green-700" : "text-red-700"}>
                    {h.ok ? "✓" : "✗"}
                  </span>{" "}
                  <span className="font-mono text-xs text-gray-500">{h.gtin}</span>{" "}
                  <span className="text-gray-800">{h.title ?? "(sans titre)"}</span>
                  <span className="ml-2 text-xs text-gray-500">
                    +{h.quantity} @ {h.location}
                  </span>
                  {h.warning && (
                    <span className="ml-2 text-xs text-amber-700">⚠ {h.warning}</span>
                  )}
                </div>
                <div className="text-xs text-gray-400">
                  {new Date(h.at).toLocaleTimeString()}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {applyResult && applyResult.status !== "size-confirmation-required" && (
        <div
          className={`mt-6 rounded-sm border p-4 ${
            doneOk ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"
          }`}
        >
          <div className={`text-sm font-semibold ${doneOk ? "text-green-900" : "text-red-900"}`}>
            {doneOk
              ? applyResult.status === "created-restocked"
                ? `Produit créé + stock ajouté à ${currentLocationName}`
                : `Stock ajouté à ${currentLocationName}`
              : `Échec: ${applyResult.error ?? "inconnu"}`}
          </div>
          {applyResult.shopify?.restock?.variant && (
            <div className="mt-1 text-sm text-gray-800">
              {applyResult.shopify.restock.variant.productTitle} · SKU{" "}
              {applyResult.shopify.restock.variant.sku ?? "—"}
            </div>
          )}
          {applyResult.db && (
            <div className="mt-1 text-xs text-gray-600">
              DB export Galaxus/Decathlon:{" "}
              {applyResult.db.ok
                ? `OK (${applyResult.db.importedVariantsCount ?? 0} variantes)`
                : `échec — ${applyResult.db.errors?.join("; ") ?? ""}`}
            </div>
          )}
          {(applyResult.warnings?.length ?? 0) > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-amber-800">
              {(applyResult.warnings ?? []).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <button
            onClick={() => {
              setGtin("");
              resetAll();
              inputRef.current?.focus();
            }}
            className="mt-3 rounded-sm border border-gray-400 px-4 py-2 text-sm hover:border-black"
          >
            Scanner la paire suivante
          </button>
        </div>
      )}
    </div>
  );
}
