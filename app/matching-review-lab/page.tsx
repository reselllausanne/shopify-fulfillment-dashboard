"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  MatchingReviewDecision,
  MatchingReviewReasonCode,
  MatchingRulesReport,
} from "@/matching-review-lab/types";

type SlimUnit = {
  unitKey: string;
  channel: "SHOPIFY" | "GALAXUS" | "DECATHLON";
  orderId: string;
  orderNumber: string;
  orderDate: string;
  lineId: string;
  unitIndex: number;
  remainingQty: number;
  productTitle: string;
  gtin: string | null;
  sku: string | null;
  sizeRaw: string | null;
  stockxAccountKeyExpected: string;
};

type SlimProposal = {
  unitKey: string;
  channel: "SHOPIFY" | "GALAXUS" | "DECATHLON";
  orderId: string;
  orderNumber: string;
  orderDate: string;
  lineId: string;
  unitIndex: number;
  productTitle: string;
  gtin: string | null;
  sku: string | null;
  sizeRaw: string | null;
  matchMethod: string;
  needsGenderOrSizeReview: boolean;
  stockxAccountKey: string | null;
  refusalReasons: string[];
  proposed: {
    supplierOrderNumber: string;
    orderId: string;
    purchaseDate: string;
    offerAmount: number | null;
    currencyCode: string | null;
    productTitle: string;
    skuKey: string;
    sizeEU: string | null;
    awb: string | null;
    confidence: string | null;
    score: number | null;
    reasons: string[];
  } | null;
  topCandidates: Array<{
    supplierOrderNumber: string;
    orderId: string;
    purchaseDate: string;
    offerAmount: number | null;
    productTitle: string;
    sizeEU: string | null;
    awb: string | null;
    confidence: string;
    score: number;
    reasons: string[];
  }>;
};

type SlimBuy = {
  supplierOrderNumber: string;
  orderId: string;
  purchaseDate: string;
  offerAmount: number | null;
  productTitle: string;
  skuKey: string;
  sizeEU: string | null;
  awb: string | null;
  stockxAccountKey: string;
};

const DECISIONS: Array<{ value: MatchingReviewDecision; label: string }> = [
  { value: "CORRECT", label: "Correct" },
  { value: "WRONG_PICK_BUY", label: "Assigner / corriger l’achat StockX" },
  { value: "NO_STOCKX_MATCH", label: "Aucun achat StockX correspondant" },
  { value: "SPECIAL_EQUIVALENCE", label: "Équivalence spéciale à documenter" },
  { value: "NEVER_AUTO_MATCH", label: "Ne jamais auto-matcher ce type de cas" },
];

const REASON_CODES: MatchingReviewReasonCode[] = [
  "WRONG_PRODUCT",
  "WRONG_SIZE",
  "WRONG_GENDER_OR_SIZE_SYSTEM",
  "WRONG_STOCKX_ACCOUNT",
  "WRONG_CAUSAL_DATE",
  "ALREADY_CONSUMED",
  "NO_STOCKX_PURCHASE",
  "ONE_OFF_MANUAL_EXCEPTION",
  "VALID_EQUIVALENCE_TO_REVIEW",
];

async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const data = await res.json();
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

export default function MatchingReviewLabPage() {
  const [limit, setLimit] = useState(150);
  const [channels, setChannels] = useState({
    SHOPIFY: true,
    GALAXUS: true,
    DECATHLON: true,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [units, setUnits] = useState<SlimUnit[]>([]);
  const [buyCount, setBuyCount] = useState(0);
  const [freshness, setFreshness] = useState<{
    fetchedAt: string | null;
    fromCache: boolean;
    accounts: Array<{ accountKey: string; buyCount: number }>;
  } | null>(null);
  const [meta, setMeta] = useState<{
    shopifyOrdersScanned: number;
    galaxusOrdersScanned: number;
    decathlonOrdersScanned?: number;
    limit: number;
    nonStxSkipped?: number;
  } | null>(null);
  const [proposals, setProposals] = useState<SlimProposal[]>([]);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [decision, setDecision] = useState<MatchingReviewDecision>("CORRECT");
  const [reasonCodes, setReasonCodes] = useState<MatchingReviewReasonCode[]>([]);
  const [reasonNote, setReasonNote] = useState("");
  const [chosenBuy, setChosenBuy] = useState<SlimBuy | null>(null);
  const [search, setSearch] = useState({
    awb: "",
    buyOrderId: "",
    gtin: "",
    sku: "",
    name: "",
    size: "",
  });
  const [searchHits, setSearchHits] = useState<SlimBuy[]>([]);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [report, setReport] = useState<MatchingRulesReport | null>(null);
  const [shopifyTokenInput, setShopifyTokenInput] = useState("");
  const [galaxusTokenInput, setGalaxusTokenInput] = useState("");
  const [tokenStatus, setTokenStatus] = useState<{
    shopify: {
      ok: boolean;
      source?: string;
      expiresAt?: string | null;
      preview?: string;
      pollutedByGalaxus?: boolean;
      hint?: string;
    };
    galaxus: { ok: boolean; source?: string; expiresAt?: string | null; preview?: string };
  } | null>(null);

  const refreshTokenStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/matching-review-lab/tokens", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) {
        setTokenStatus({ shopify: data.shopify, galaxus: data.galaxus });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshTokenStatus();
  }, [refreshTokenStatus]);

  const saveToken = useCallback(
    async (account: "shopify" | "galaxus") => {
      const raw = account === "shopify" ? shopifyTokenInput : galaxusTokenInput;
      setBusy(`token-${account}`);
      setError(null);
      try {
        const { data } = await fetchJson(
          "/api/matching-review-lab/tokens",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ account, token: raw }),
          },
          30_000
        );
        if (!data.ok) throw new Error(data.error || "save token failed");
        if (account === "shopify") setShopifyTokenInput("");
        else setGalaxusTokenInput("");
        await refreshTokenStatus();
        setStatus(
          `Token ${account} sauvé → ${data.source ?? "file"} (exp ${data.expiresAt ?? "?"})`
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [shopifyTokenInput, galaxusTokenInput, refreshTokenStatus]
  );

  const selected = proposals.find((p) => p.unitKey === selectedKey) ?? null;

  const runLoad = useCallback(async () => {
    setBusy("load");
    setError(null);
    setSavedNote(null);
    setStatus("Chargement commandes + snapshot StockX (serveur)…");
    try {
      const channelList = [
        ...(channels.SHOPIFY ? (["SHOPIFY"] as const) : []),
        ...(channels.GALAXUS ? (["GALAXUS"] as const) : []),
        ...(channels.DECATHLON ? (["DECATHLON"] as const) : []),
      ];
      const { data } = await fetchJson(
        "/api/matching-review-lab/load",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit, channels: channelList }),
        },
        120_000
      );
      if (!data.ok) throw new Error(data.error || "load failed");
      setBatchId(data.batchId);
      setUnits(data.units);
      setBuyCount(data.buyCount ?? 0);
      setFreshness(data.freshness);
      setMeta(data.meta);
      setProposals([]);
      setStats(null);
      setSelectedKey(null);
      const warnList = Array.isArray(data.warnings) ? data.warnings : [];
      if (warnList.length) {
        setError(warnList.join(" · "));
      }
      setStatus(
        `Lot prêt: ${data.units.length} unités, ${data.buyCount} buys (batch ${data.batchId})`
      );
    } catch (e) {
      const msg =
        e instanceof Error && e.name === "AbortError"
          ? "Timeout 120s — baisse la limite (ex. 30) ou Galaxus seul."
          : e instanceof Error
            ? e.message
            : String(e);
      setError(msg);
      setStatus(null);
    } finally {
      setBusy(null);
    }
  }, [channels, limit]);

  const runSimulate = useCallback(async () => {
    if (!batchId) return;
    setBusy("simulate");
    setError(null);
    setStatus("Simulation matcher (serveur, logs mutés)…");
    try {
      const { data } = await fetchJson(
        "/api/matching-review-lab/simulate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ batchId, enforceAccountSeparation: true }),
        },
        120_000
      );
      if (!data.ok) throw new Error(data.error || "simulate failed");
      setProposals(data.proposals);
      setStats(data.stats);
      if (data.proposals?.[0]) setSelectedKey(data.proposals[0].unitKey);
      setStatus(
        `Simulé: ${data.stats?.withProposal ?? 0}/${data.stats?.totalUnits ?? 0} propositions`
      );
    } catch (e) {
      const msg =
        e instanceof Error && e.name === "AbortError"
          ? "Timeout simulation 120s — baisse limite."
          : e instanceof Error
            ? e.message
            : String(e);
      setError(msg);
      setStatus(null);
    } finally {
      setBusy(null);
    }
  }, [batchId]);

  const runSearch = useCallback(async () => {
    if (!batchId) return;
    setBusy("search");
    setError(null);
    try {
      const { data } = await fetchJson(
        "/api/matching-review-lab/search",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ batchId, ...search }),
        },
        30_000
      );
      if (!data.ok) throw new Error(data.error || "search failed");
      setSearchHits(data.hits);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [batchId, search]);

  const saveReview = useCallback(async () => {
    if (!batchId || !selected) return;
    const needsBuy =
      decision === "WRONG_PICK_BUY" || decision === "SPECIAL_EQUIVALENCE";
    if (needsBuy && !chosenBuy) {
      setError("Choisis un achat StockX (recherche manuelle) avant d’enregistrer.");
      return;
    }
    setBusy("review");
    setError(null);
    setSavedNote(null);
    try {
      const { data } = await fetchJson(
        "/api/matching-review-lab/review",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            batchId,
            unitKey: selected.unitKey,
            decision,
            reasonCodes,
            reasonNote: reasonNote || null,
            chosenBuyOrderId: needsBuy
              ? chosenBuy?.orderId ?? chosenBuy?.supplierOrderNumber ?? null
              : null,
          }),
        },
        30_000
      );
      if (!data.ok) throw new Error(data.error || "review failed");

      // Reflect manual pick in the table immediately (JSONL already written).
      if (needsBuy && chosenBuy) {
        setProposals((prev) =>
          prev.map((p) => {
            if (p.unitKey !== selected.unitKey) return p;
            return {
              ...p,
              matchMethod: "MANUAL_REVIEW",
              stockxAccountKey: chosenBuy.stockxAccountKey,
              refusalReasons: [],
              proposed: {
                supplierOrderNumber: chosenBuy.supplierOrderNumber,
                orderId: chosenBuy.orderId,
                purchaseDate: chosenBuy.purchaseDate,
                offerAmount: chosenBuy.offerAmount,
                currencyCode: null,
                productTitle: chosenBuy.productTitle,
                skuKey: chosenBuy.skuKey,
                sizeEU: chosenBuy.sizeEU,
                awb: chosenBuy.awb,
                confidence: "manual",
                score: null,
                reasons: [`MANUAL:${decision}`],
              },
            };
          })
        );
      } else if (decision === "NO_STOCKX_MATCH" || decision === "NEVER_AUTO_MATCH") {
        setProposals((prev) =>
          prev.map((p) => {
            if (p.unitKey !== selected.unitKey) return p;
            return {
              ...p,
              matchMethod: "MANUAL_REVIEW",
              proposed: null,
              refusalReasons: [decision, ...reasonCodes],
            };
          })
        );
      }

      setSavedNote(
        `Review OK → data/matching-review-lab/reviews.jsonl (${String(data.record.id).slice(0, 8)}…). wroteLiveMatch=false`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [batchId, selected, decision, reasonCodes, reasonNote, chosenBuy]);

  const loadReport = useCallback(async () => {
    setBusy("report");
    setError(null);
    try {
      const { data } = await fetchJson("/api/matching-review-lab/report", {}, 30_000);
      if (!data.ok) throw new Error(data.error || "report failed");
      setReport(data.report);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const toggleReason = (code: MatchingReviewReasonCode) => {
    setReasonCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-6 md:px-8">
      <header className="max-w-7xl mx-auto mb-6 border-b border-zinc-800 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Matching Review Lab</h1>
        <p className="text-sm text-zinc-400 mt-1 max-w-3xl">
          Dry-run serveur — buys StockX restent côté serveur (pas de freeze browser). Reviews
          JSONL local. Règles proposées, jamais appliquées.
        </p>
      </header>

      <section className="max-w-7xl mx-auto grid gap-4 md:grid-cols-[240px_1fr]">
        <aside className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 h-fit">
          <div className="space-y-2 border-b border-zinc-800 pb-3">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Tokens StockX (fichiers prod)</div>
            <p className="text-[11px] text-zinc-500">
              Shopify → `.data/stockx-token.json` · Galaxus → `.data/stockx-token-galaxus.json` (comme DD / home).
            </p>
            <div className="text-[11px] text-zinc-400 space-y-0.5">
              <div>
                Shopify:{" "}
                {tokenStatus?.shopify?.ok
                  ? `OK ${tokenStatus.shopify.preview} exp ${tokenStatus.shopify.expiresAt?.slice(0, 16) ?? "?"}`
                  : tokenStatus?.shopify?.pollutedByGalaxus
                    ? "ignoré (DB/fichier = JWT Galaxus leftover)"
                    : "manquant (OK si Galaxus seul)"}
              </div>
              <div>
                Galaxus:{" "}
                {tokenStatus?.galaxus?.ok
                  ? `OK ${tokenStatus.galaxus.preview} exp ${tokenStatus.galaxus.expiresAt?.slice(0, 16) ?? "?"}`
                  : "manquant / expiré"}
              </div>
            </div>
            <label className="block text-[11px] text-zinc-400">
              Paste Shopify bearer
              <textarea
                value={shopifyTokenInput}
                onChange={(e) => setShopifyTokenInput(e.target.value)}
                rows={2}
                className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 font-mono"
                placeholder="eyJ… (compte Shopify)"
              />
            </label>
            <button
              type="button"
              disabled={!!busy || !shopifyTokenInput.trim()}
              onClick={() => void saveToken("shopify")}
              className="w-full rounded border border-zinc-600 hover:bg-zinc-800 disabled:opacity-50 px-2 py-1.5 text-xs"
            >
              {busy === "token-shopify" ? "Save…" : "Save Shopify token"}
            </button>
            <label className="block text-[11px] text-zinc-400">
              Paste Galaxus bearer
              <textarea
                value={galaxusTokenInput}
                onChange={(e) => setGalaxusTokenInput(e.target.value)}
                rows={2}
                className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 font-mono"
                placeholder="eyJ… (compte Galaxus)"
              />
            </label>
            <button
              type="button"
              disabled={!!busy || !galaxusTokenInput.trim()}
              onClick={() => void saveToken("galaxus")}
              className="w-full rounded border border-zinc-600 hover:bg-zinc-800 disabled:opacity-50 px-2 py-1.5 text-xs"
            >
              {busy === "token-galaxus" ? "Save…" : "Save Galaxus token"}
            </button>
          </div>

          <label className="block text-xs uppercase tracking-wide text-zinc-500">
            Limite unités
            <input
              type="number"
              min={10}
              max={200}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || 150)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
            />
          </label>
          <p className="text-[11px] text-zinc-500">Défaut 150 / canal. Monte si besoin.</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={channels.SHOPIFY}
              onChange={(e) => setChannels((c) => ({ ...c, SHOPIFY: e.target.checked }))}
            />
            Shopify
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={channels.GALAXUS}
              onChange={(e) => setChannels((c) => ({ ...c, GALAXUS: e.target.checked }))}
            />
            Galaxus STX_
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={channels.DECATHLON}
              onChange={(e) => setChannels((c) => ({ ...c, DECATHLON: e.target.checked }))}
            />
            Decathlon STX_
          </label>
          <p className="text-[11px] text-zinc-500">
            Galaxus/Decathlon: STX_ only. Match: Shopify units↔Shopify token buys, Galaxus↔Galaxus token buys.
          </p>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void runLoad()}
            className="w-full rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-2 text-sm font-medium"
          >
            {busy === "load" ? "Chargement…" : "1. Charger lot"}
          </button>
          <button
            type="button"
            disabled={!!busy || !batchId}
            onClick={() => void runSimulate()}
            className="w-full rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-50 px-3 py-2 text-sm font-medium"
          >
            {busy === "simulate" ? "Simulation…" : "2. Simuler matcher"}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void loadReport()}
            className="w-full rounded border border-zinc-600 hover:bg-zinc-800 disabled:opacity-50 px-3 py-2 text-sm"
          >
            Rapport règles (non appliqué)
          </button>

          {status && <div className="text-xs text-sky-300 pt-2 border-t border-zinc-800">{status}</div>}

          {freshness && (
            <div className="text-xs text-zinc-400 space-y-1 pt-2 border-t border-zinc-800">
              <div>
                StockX:{" "}
                {freshness.fetchedAt
                  ? new Date(freshness.fetchedAt).toLocaleString()
                  : "n/a"}
              </div>
              <div>cache: {freshness.fromCache ? "yes" : "no"}</div>
              <div>buys: {buyCount}</div>
              {freshness.accounts?.map((a) => (
                <div key={a.accountKey}>
                  {a.accountKey}: {a.buyCount}
                </div>
              ))}
              <div>
                units: {units.length} (Shopify {meta?.shopifyOrdersScanned ?? 0} / Galaxus{" "}
                {meta?.galaxusOrdersScanned ?? 0} / Decathlon {meta?.decathlonOrdersScanned ?? 0})
              </div>
              {(meta?.nonStxSkipped ?? 0) > 0 && (
                <div className="text-zinc-500">non-STX skip: {meta?.nonStxSkipped}</div>
              )}
            </div>
          )}
          {stats && (
            <div className="text-xs text-zinc-300 space-y-1 pt-2 border-t border-zinc-800">
              <div>
                proposés: {stats.withProposal}/{stats.totalUnits}
              </div>
              <div>
                H/M/L: {stats.high}/{stats.medium}/{stats.low}
              </div>
              <div>Women/GS review: {stats.genderOrSizeReview}</div>
            </div>
          )}
        </aside>

        <div className="space-y-4">
          {error && (
            <div className="rounded border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}
          {savedNote && (
            <div className="rounded border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200">
              {savedNote}
            </div>
          )}

          <div className="overflow-auto rounded-lg border border-zinc-800 max-h-[42vh]">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 bg-zinc-900 text-zinc-400">
                <tr>
                  <th className="px-2 py-2">Canal</th>
                  <th className="px-2 py-2">Commande</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Produit · Size · SKU</th>
                  <th className="px-2 py-2">Proposition</th>
                  <th className="px-2 py-2">Compte</th>
                  <th className="px-2 py-2">Raisons</th>
                </tr>
              </thead>
              <tbody>
                {(proposals.length > 0 ? proposals : units.map((u) => ({
                  unitKey: u.unitKey,
                  channel: u.channel,
                  orderNumber: u.orderNumber,
                  orderDate: u.orderDate,
                  productTitle: u.productTitle,
                  sku: u.sku,
                  sizeRaw: u.sizeRaw,
                  gtin: u.gtin,
                  proposed: null as SlimProposal["proposed"],
                  stockxAccountKey: null as string | null,
                  refusalReasons: [] as string[],
                  needsGenderOrSizeReview: false,
                  matchMethod: "NONE",
                  topCandidates: [] as SlimProposal["topCandidates"],
                  orderId: u.orderId,
                  lineId: u.lineId,
                  unitIndex: u.unitIndex,
                }))).map((p) => {
                  const active = p.unitKey === selectedKey;
                  const buy = "proposed" in p ? p.proposed : null;
                  return (
                    <tr
                      key={p.unitKey}
                      onClick={() => {
                        setSelectedKey(p.unitKey);
                        setChosenBuy(null);
                        if (!("proposed" in p) || !p.proposed) {
                          setDecision("WRONG_PICK_BUY");
                        } else {
                          setDecision("CORRECT");
                        }
                      }}
                      className={`cursor-pointer border-t border-zinc-800/80 hover:bg-zinc-900 ${
                        active ? "bg-zinc-800/80" : ""
                      } ${"needsGenderOrSizeReview" in p && p.needsGenderOrSizeReview ? "outline outline-1 outline-amber-700/60" : ""}`}
                    >
                      <td className="px-2 py-2">{p.channel}</td>
                      <td className="px-2 py-2 font-mono">{p.orderNumber}</td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {String(p.orderDate).slice(0, 10)}
                      </td>
                      <td className="px-2 py-2 max-w-[280px]">
                        <div className="truncate font-medium text-zinc-100">{p.productTitle}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[11px]">
                          <span className="text-amber-200">
                            Size {p.sizeRaw?.trim() || "—"}
                          </span>
                          <span className="text-zinc-500">SKU {p.sku?.trim() || "—"}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        {buy ? (
                          <div>
                            <div className="font-mono">{buy.supplierOrderNumber}</div>
                            <div className="text-zinc-500">
                              {buy.confidence} · {buy.offerAmount ?? "?"} {buy.currencyCode || ""} ·{" "}
                              {buy.awb || "no AWB"}
                            </div>
                            {"matchMethod" in p && p.matchMethod === "MANUAL_REVIEW" && (
                              <div className="text-[10px] text-emerald-400">manuel</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-zinc-500">
                            {proposals.length ? "aucun" : "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 font-mono text-[10px]">
                        {p.stockxAccountKey || "—"}
                      </td>
                      <td className="px-2 py-2 max-w-[200px] truncate text-zinc-400">
                        {(buy?.reasons ?? ("refusalReasons" in p ? p.refusalReasons : []))
                          .slice(0, 3)
                          .join(" · ")}
                      </td>
                    </tr>
                  );
                })}
                {units.length === 0 && proposals.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-zinc-500">
                      Charger un lot (limite 50 recommandée) puis simuler.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selected && proposals.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
                <h2 className="text-sm font-semibold">Review — {selected.unitKey}</h2>
                <div className="text-xs text-zinc-400 space-y-1">
                  <div>
                    Méthode: {selected.matchMethod}
                    {selected.needsGenderOrSizeReview ? " · Women/GS → review" : ""}
                  </div>
                  <div>Top candidats:</div>
                  <ul className="list-disc pl-4">
                    {selected.topCandidates.map((c) => (
                      <li key={c.supplierOrderNumber}>
                        {c.supplierOrderNumber} ({c.confidence}, score {c.score}) —{" "}
                        {c.reasons.slice(0, 2).join(", ")}
                      </li>
                    ))}
                    {selected.topCandidates.length === 0 && <li>aucun</li>}
                  </ul>
                </div>

                <fieldset className="space-y-1">
                  <legend className="text-xs uppercase text-zinc-500 mb-1">Décision</legend>
                  {DECISIONS.map((d) => (
                    <label key={d.value} className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="decision"
                        checked={decision === d.value}
                        onChange={() => setDecision(d.value)}
                      />
                      {d.label}
                    </label>
                  ))}
                </fieldset>

                <div>
                  <div className="text-xs uppercase text-zinc-500 mb-1">Raisons</div>
                  <div className="flex flex-wrap gap-2">
                    {REASON_CODES.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => toggleReason(code)}
                        className={`rounded px-2 py-1 text-[10px] border ${
                          reasonCodes.includes(code)
                            ? "border-amber-500 bg-amber-950 text-amber-100"
                            : "border-zinc-700 text-zinc-400"
                        }`}
                      >
                        {code}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                  placeholder="Note libre…"
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm min-h-[64px]"
                />

                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void saveReview()}
                  className="rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-50 px-3 py-2 text-sm font-medium"
                >
                  Enregistrer review (JSONL local)
                </button>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
                <h2 className="text-sm font-semibold">Recherche manuelle StockX</h2>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["awb", "AWB"],
                      ["buyOrderId", "Buy order ID"],
                      ["gtin", "GTIN"],
                      ["sku", "SKU/style"],
                      ["name", "Nom"],
                      ["size", "Taille"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="text-xs text-zinc-400">
                      {label}
                      <input
                        value={search[key]}
                        onChange={(e) => setSearch((s) => ({ ...s, [key]: e.target.value }))}
                        className="mt-0.5 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100"
                      />
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={!!busy || !batchId}
                  onClick={() => void runSearch()}
                  className="rounded border border-zinc-600 hover:bg-zinc-800 px-3 py-1.5 text-sm"
                >
                  Chercher
                </button>
                <ul className="max-h-48 overflow-auto text-xs space-y-1">
                  {searchHits.map((b) => (
                    <li key={`${b.stockxAccountKey}:${b.orderId}`}>
                      <button
                        type="button"
                        className={`w-full text-left rounded px-2 py-1 border ${
                          chosenBuy?.orderId === b.orderId
                            ? "border-emerald-600 bg-emerald-950/40"
                            : "border-zinc-800 hover:bg-zinc-800"
                        }`}
                        onClick={() => {
                          setChosenBuy(b);
                          if (
                            decision === "CORRECT" ||
                            decision === "NO_STOCKX_MATCH" ||
                            decision === "NEVER_AUTO_MATCH"
                          ) {
                            setDecision("WRONG_PICK_BUY");
                          }
                        }}
                      >
                        <span className="font-mono">{b.supplierOrderNumber}</span> · {b.productTitle}{" "}
                        · {b.sizeEU || "?"} · {b.awb || "no AWB"} · {b.stockxAccountKey}
                      </button>
                    </li>
                  ))}
                </ul>
                {chosenBuy && (
                  <div className="text-xs text-emerald-300">
                    Choisi: {chosenBuy.supplierOrderNumber} ({chosenBuy.stockxAccountKey})
                  </div>
                )}
              </div>
            </div>
          )}

          {report && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-xs space-y-2">
              <h2 className="text-sm font-semibold">Rapport propositions (applied=false)</h2>
              <pre className="overflow-auto max-h-64 whitespace-pre-wrap text-[11px] text-zinc-300">
                {JSON.stringify(
                  {
                    reviewCount: report.reviewCount,
                    decisionCounts: report.decisionCounts,
                    reasonCounts: report.reasonCounts,
                    generalizableRules: report.generalizableRules.map((r) => ({
                      id: r.id,
                      title: r.title,
                      confirmingCaseCount: r.confirmingCaseCount,
                      risk: r.risk,
                      applied: r.applied,
                    })),
                    manualOnlyExceptions: report.manualOnlyExceptions.length,
                    note: report.note,
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
