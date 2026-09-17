"use client";

import { useCallback, useEffect, useState } from "react";

type ReviewItem = {
  id: string;
  supplierKey: string;
  supplierVariantId: string;
  gtin: string | null;
  productName: string | null;
  dbQty: number | null;
  proposedQty: number | null;
  reason: string;
  status: string;
  createdAt: string;
};

type Policy = {
  supplierKey: string;
  displayName: string;
  status: string;
  consecutiveInvalidRuns: number;
  lastValidRunAt: string | null;
  lastInvalidRunAt: string | null;
};

type Contract = {
  supplierKey: string;
  displayName: string;
  observationContractImplemented: boolean;
  observationContractValidated: boolean;
  notes: string;
};

type QualityRun = {
  id: string;
  supplierKey: string;
  scrapeRunId: number;
  valid: boolean;
  invalidReason: string | null;
  variantsProcessed: number;
  qtyZeroed: number;
  createdAt: string;
  observationContractImplemented?: boolean;
  observationsReceivedThisRun?: number;
  sourceProofCoverage?: number | null;
  eligibleForApproval?: boolean;
};

type EnforceInfo = {
  enforced: boolean;
  mode: string;
  banner: string | null;
};

const nf = new Intl.NumberFormat("en-US");

export default function SupplierStockPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [runs, setRuns] = useState<QualityRun[]>([]);
  const [enforce, setEnforce] = useState<EnforceInfo | null>(null);
  const [supplier, setSupplier] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = supplier ? `?supplier=${encodeURIComponent(supplier)}` : "";
      const [reviewRes, policyRes, runsRes] = await Promise.all([
        fetch(`/api/supplier-stock/review${q}`),
        fetch("/api/supplier-stock/policies"),
        fetch(`/api/supplier-stock/runs${q ? `${q}&limit=20` : "?limit=20"}`),
      ]);
      const review = await reviewRes.json();
      const policy = await policyRes.json();
      const runJson = await runsRes.json();
      if (!review.ok) throw new Error(review.error || "review load failed");
      setItems(review.items ?? []);
      setPolicies(policy.policies ?? []);
      setContracts(policy.contracts ?? []);
      setEnforce(policy.enforce ?? runJson.enforce ?? null);
      setRuns(runJson.runs ?? []);
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [supplier]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolveItems = async (ids: string[]) => {
    setBusy(ids[0] ?? "bulk");
    try {
      const res = await fetch("/api/supplier-stock/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, status: "resolved" }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "resolve failed");
      await load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const patchPolicy = async (supplierKey: string, action: "approve" | "pause" | "monitoring") => {
    setBusy(supplierKey);
    try {
      const res = await fetch("/api/supplier-stock/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierKey,
          action,
          ...(action === "approve" ? { observationContractValidated: true } : {}),
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "policy update failed");
      await load();
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const grouped = items.reduce<Record<string, ReviewItem[]>>((acc, item) => {
    (acc[item.supplierKey] ??= []).push(item);
    return acc;
  }, {});

  const contractByKey = Object.fromEntries(contracts.map((c) => [c.supplierKey, c]));

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-6">
      {enforce && !enforce.enforced ? (
        <div
          className="rounded-lg border-2 border-amber-500 bg-amber-100 px-4 py-4 text-center dark:border-amber-400 dark:bg-amber-950"
          role="status"
        >
          <p className="font-mono text-lg font-bold tracking-wide text-amber-950 dark:text-amber-100">
            {enforce.banner ?? "OBSERVATION_ONLY_NOT_ENFORCED"}
          </p>
          <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">
            Marketplace quantities unchanged. Set{" "}
            <code className="rounded bg-amber-200 px-1 dark:bg-amber-900">SUPPLIER_STOCK_PUBLISH_ENFORCED=1</code>{" "}
            only after voluntary activation.
          </p>
        </div>
      ) : enforce?.enforced ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100">
          Publish enforcement ON — policies apply to marketplace qty (WEL/REI still TEMPORARY_MONITORING_EXCEPTION).
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Supplier stock review</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Proof-based reconciliation — runner finalizes runs; scrapers must emit observations for page proof.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
          >
            <option value="">All suppliers</option>
            {policies.map((p) => (
              <option key={p.supplierKey} value={p.supplierKey}>
                {p.displayName} ({p.supplierKey})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Observation contract (honest)</h2>
          <p className="text-xs text-slate-500">implemented=false until scraper emits SupplierVariantObservation — call sites ≠ proof</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-2">Supplier</th>
                <th className="px-4 py-2">Contract</th>
                <th className="px-4 py-2">Eligible approve</th>
                <th className="px-4 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.supplierKey} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 font-medium">
                    {c.displayName} <span className="font-mono text-xs uppercase text-slate-500">{c.supplierKey}</span>
                  </td>
                  <td className="px-4 py-2">
                    {c.observationContractImplemented ? (
                      <span className="text-emerald-700">implemented</span>
                    ) : (
                      <span className="font-semibold text-amber-700">pending</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{c.observationContractImplemented ? "maybe" : "no"}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{c.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Policies</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-2">Supplier</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Contract</th>
                <th className="px-4 py-2">Invalid runs</th>
                <th className="px-4 py-2">Last valid</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => {
                const c = contractByKey[p.supplierKey];
                return (
                  <tr key={p.supplierKey} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-2 font-medium">{p.displayName}</td>
                    <td className="px-4 py-2">{p.status}</td>
                    <td className="px-4 py-2">
                      {c?.observationContractImplemented ? "implemented" : "pending"}
                    </td>
                    <td className="px-4 py-2">{p.consecutiveInvalidRuns}</td>
                    <td className="px-4 py-2">{p.lastValidRunAt ? new Date(p.lastValidRunAt).toLocaleString() : "—"}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={busy === p.supplierKey || !c?.observationContractImplemented}
                          title={
                            c?.observationContractImplemented
                              ? "Approve after live validation"
                              : "Blocked: observationContractImplemented=false"
                          }
                          onClick={() => void patchPolicy(p.supplierKey, "approve")}
                          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busy === p.supplierKey}
                          onClick={() => void patchPolicy(p.supplierKey, "monitoring")}
                          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                        >
                          Monitoring
                        </button>
                        <button
                          type="button"
                          disabled={busy === p.supplierKey}
                          onClick={() => void patchPolicy(p.supplierKey, "pause")}
                          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                        >
                          Pause
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Review queue ({items.length})</h2>
        </div>
        {Object.keys(grouped).length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No open review items.</p>
        ) : (
          Object.entries(grouped).map(([key, rows]) => (
            <div key={key} className="border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between bg-slate-50 px-4 py-2 dark:bg-slate-800/50">
                <span className="font-medium uppercase text-slate-700 dark:text-slate-200">{key}</span>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void resolveItems(rows.map((r) => r.id))}
                  className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-white dark:border-slate-600 dark:hover:bg-slate-900"
                >
                  Resolve all
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Product</th>
                      <th className="px-4 py-2">GTIN</th>
                      <th className="px-4 py-2">DB qty</th>
                      <th className="px-4 py-2">Proposed</th>
                      <th className="px-4 py-2">Reason</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="max-w-xs truncate px-4 py-2">{row.productName ?? row.supplierVariantId}</td>
                        <td className="px-4 py-2 font-mono text-xs">{row.gtin ?? "—"}</td>
                        <td className="px-4 py-2">{row.dbQty ?? "—"}</td>
                        <td className="px-4 py-2">{row.proposedQty ?? "—"}</td>
                        <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{row.reason}</td>
                        <td className="px-4 py-2">
                          <button
                            type="button"
                            disabled={busy === row.id}
                            onClick={() => void resolveItems([row.id])}
                            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                          >
                            Resolve
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Recent quality runs</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-2">Supplier</th>
                <th className="px-4 py-2">Run</th>
                <th className="px-4 py-2">Valid</th>
                <th className="px-4 py-2">Obs received</th>
                <th className="px-4 py-2">Proof cov.</th>
                <th className="px-4 py-2">Contract</th>
                <th className="px-4 py-2">Zeroed*</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 uppercase">{r.supplierKey}</td>
                  <td className="px-4 py-2">#{r.scrapeRunId}</td>
                  <td className="px-4 py-2">{r.valid ? "yes" : "no"}</td>
                  <td className="px-4 py-2">{nf.format(r.observationsReceivedThisRun ?? r.variantsProcessed)}</td>
                  <td className="px-4 py-2">
                    {r.sourceProofCoverage == null ? "—" : `${Math.round(r.sourceProofCoverage * 100)}%`}
                  </td>
                  <td className="px-4 py-2">
                    {r.observationContractImplemented ? "yes" : "pending"}
                  </td>
                  <td className="px-4 py-2">{nf.format(r.qtyZeroed)}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{r.invalidReason ?? "—"}</td>
                  <td className="px-4 py-2">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-slate-500">
            *Zeroed = applied only when SUPPLIER_STOCK_PUBLISH_ENFORCED=1; otherwise report-only.
          </p>
        </div>
      </section>
    </main>
  );
}
