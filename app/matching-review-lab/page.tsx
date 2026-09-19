"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  LabClientUnit,
  LabMatchProposal,
  LabStockxBuy,
  MatchingReviewDecision,
  MatchingReviewReasonCode,
  MatchingRulesReport,
} from "@/matching-review-lab/types";

type LoadState = {
  units: LabClientUnit[];
  buys: LabStockxBuy[];
  freshness: {
    fetchedAt: string | null;
    fromCache: boolean;
    accounts: Array<{ accountKey: string; buyCount: number; source?: string }>;
  } | null;
  meta: { shopifyOrdersScanned: number; galaxusOrdersScanned: number; limit: number } | null;
};

const DECISIONS: Array<{ value: MatchingReviewDecision; label: string }> = [
  { value: "CORRECT", label: "Correct" },
  { value: "WRONG_PICK_BUY", label: "Faux — choisir le bon achat StockX" },
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

export default function MatchingReviewLabPage() {
  const [limit, setLimit] = useState(120);
  const [channels, setChannels] = useState({ SHOPIFY: true, GALAXUS: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [load, setLoad] = useState<LoadState | null>(null);
  const [proposals, setProposals] = useState<LabMatchProposal[]>([]);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [decision, setDecision] = useState<MatchingReviewDecision>("CORRECT");
  const [reasonCodes, setReasonCodes] = useState<MatchingReviewReasonCode[]>([]);
  const [reasonNote, setReasonNote] = useState("");
  const [chosenBuy, setChosenBuy] = useState<LabStockxBuy | null>(null);
  const [search, setSearch] = useState({
    awb: "",
    buyOrderId: "",
    gtin: "",
    sku: "",
    name: "",
    size: "",
  });
  const [searchHits, setSearchHits] = useState<LabStockxBuy[]>([]);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [report, setReport] = useState<MatchingRulesReport | null>(null);

  const selected = useMemo(
    () => proposals.find((p) => p.unit.unitKey === selectedKey) ?? null,
    [proposals, selectedKey]
  );

  const runLoad = useCallback(async () => {
    setBusy("load");
    setError(null);
    setSavedNote(null);
    try {
      const channelList = [
        ...(channels.SHOPIFY ? (["SHOPIFY"] as const) : []),
        ...(channels.GALAXUS ? (["GALAXUS"] as const) : []),
      ];
      const res = await fetch("/api/matching-review-lab/load", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit, channels: channelList }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "load failed");
      setLoad({
        units: data.units,
        buys: data.buys,
        freshness: data.freshness,
        meta: data.meta,
      });
      setProposals([]);
      setStats(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [channels, limit]);

  const runSimulate = useCallback(async () => {
    if (!load) return;
    setBusy("simulate");
    setError(null);
    try {
      const res = await fetch("/api/matching-review-lab/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          units: load.units,
          buys: load.buys,
          fetchedAt: load.freshness?.fetchedAt,
          fromCache: load.freshness?.fromCache,
          enforceAccountSeparation: true,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "simulate failed");
      setProposals(data.proposals);
      setStats(data.stats);
      if (data.proposals?.[0]) setSelectedKey(data.proposals[0].unit.unitKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [load]);

  const runSearch = useCallback(async () => {
    if (!load) return;
    setBusy("search");
    setError(null);
    try {
      const res = await fetch("/api/matching-review-lab/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ buys: load.buys, ...search }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "search failed");
      setSearchHits(data.hits);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [load, search]);

  const saveReview = useCallback(async () => {
    if (!selected) return;
    setBusy("review");
    setError(null);
    setSavedNote(null);
    try {
      const res = await fetch("/api/matching-review-lab/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposal: selected,
          decision,
          reasonCodes,
          reasonNote: reasonNote || null,
          chosenBuy:
            decision === "WRONG_PICK_BUY" || decision === "SPECIAL_EQUIVALENCE"
              ? chosenBuy
              : null,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "review failed");
      setSavedNote(
        `Review enregistrée localement (${data.record.id.slice(0, 8)}…). wroteLiveMatch=false`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [selected, decision, reasonCodes, reasonNote, chosenBuy]);

  const loadReport = useCallback(async () => {
    setBusy("report");
    setError(null);
    try {
      const res = await fetch("/api/matching-review-lab/report");
      const data = await res.json();
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
          Simulation locale Shopify/Galaxus ↔ StockX. Dry-run only — aucune écriture
          OrderMatch / GalaxusStockxMatch. Reviews → JSONL local. Règles proposées, jamais
          appliquées.
        </p>
      </header>

      <section className="max-w-7xl mx-auto grid gap-4 md:grid-cols-[240px_1fr]">
        <aside className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 h-fit">
          <label className="block text-xs uppercase tracking-wide text-zinc-500">
            Limite unités
            <input
              type="number"
              min={10}
              max={300}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || 120)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
            />
          </label>
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
            Galaxus
          </label>
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
            disabled={!!busy || !load}
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

          {load?.freshness && (
            <div className="text-xs text-zinc-400 space-y-1 pt-2 border-t border-zinc-800">
              <div>
                StockX freshness:{" "}
                {load.freshness.fetchedAt
                  ? new Date(load.freshness.fetchedAt).toLocaleString()
                  : "n/a"}
              </div>
              <div>cache: {load.freshness.fromCache ? "yes" : "no"}</div>
              <div>buys: {load.buys.length}</div>
              {load.freshness.accounts?.map((a) => (
                <div key={a.accountKey}>
                  {a.accountKey}: {a.buyCount}
                </div>
              ))}
              <div>
                units: {load.units.length} (Shopify orders {load.meta?.shopifyOrdersScanned ?? 0} /
                Galaxus {load.meta?.galaxusOrdersScanned ?? 0})
              </div>
            </div>
          )}
          {stats && (
            <div className="text-xs text-zinc-300 space-y-1 pt-2 border-t border-zinc-800">
              <div>proposés: {stats.withProposal}/{stats.totalUnits}</div>
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
                  <th className="px-2 py-2">Produit / taille</th>
                  <th className="px-2 py-2">Proposition</th>
                  <th className="px-2 py-2">Compte</th>
                  <th className="px-2 py-2">Raisons</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => {
                  const active = p.unit.unitKey === selectedKey;
                  const buy = p.proposed?.supplierOrder;
                  return (
                    <tr
                      key={p.unit.unitKey}
                      onClick={() => setSelectedKey(p.unit.unitKey)}
                      className={`cursor-pointer border-t border-zinc-800/80 hover:bg-zinc-900 ${
                        active ? "bg-zinc-800/80" : ""
                      } ${p.needsGenderOrSizeReview ? "outline outline-1 outline-amber-700/60" : ""}`}
                    >
                      <td className="px-2 py-2">{p.unit.channel}</td>
                      <td className="px-2 py-2 font-mono">{p.unit.orderNumber}</td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {p.unit.orderDate.slice(0, 10)}
                      </td>
                      <td className="px-2 py-2 max-w-[220px]">
                        <div className="truncate">{p.unit.productTitle}</div>
                        <div className="text-zinc-500">
                          {p.unit.sku || "—"} · {p.unit.sizeRaw || "—"} · GTIN{" "}
                          {p.unit.gtin || "—"}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        {buy ? (
                          <div>
                            <div className="font-mono">{buy.supplierOrderNumber}</div>
                            <div className="text-zinc-500">
                              {p.proposed?.confidence} · {buy.offerAmount ?? "?"}{" "}
                              {buy.currencyCode || ""} · {buy.awb || "no AWB"}
                            </div>
                          </div>
                        ) : (
                          <span className="text-zinc-500">aucun</span>
                        )}
                      </td>
                      <td className="px-2 py-2 font-mono text-[10px]">
                        {p.stockxAccountKey || "—"}
                      </td>
                      <td className="px-2 py-2 max-w-[200px] truncate text-zinc-400">
                        {(p.proposed?.reasons ?? p.refusalReasons).slice(0, 3).join(" · ")}
                      </td>
                    </tr>
                  );
                })}
                {proposals.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-zinc-500">
                      Charger un lot puis simuler.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
                <h2 className="text-sm font-semibold">Review — {selected.unit.unitKey}</h2>
                <div className="text-xs text-zinc-400 space-y-1">
                  <div>
                    Méthode: {selected.matchMethod}
                    {selected.needsGenderOrSizeReview ? " · Women/GS → review" : ""}
                  </div>
                  <div>Top candidats:</div>
                  <ul className="list-disc pl-4">
                    {selected.topCandidates.map((c) => (
                      <li key={c.supplierOrder.supplierOrderNumber}>
                        {c.supplierOrder.supplierOrderNumber} ({c.confidence}, score {c.score}) —{" "}
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
                  disabled={!!busy || !load}
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
                        onClick={() => setChosenBuy(b)}
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
              <h2 className="text-sm font-semibold">
                Rapport propositions (applied={String(false)})
              </h2>
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
