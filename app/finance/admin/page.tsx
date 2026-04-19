"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, postJson, putJson, delJson } from "@/app/lib/api";
import { formatMoneyCHF } from "@/app/utils/numbers";

const FINANCE_CATEGORIES = [
  "SALES", "REFUND", "COGS", "COMMISSION", "SHIPPING", "ADS", "SUBSCRIPTION",
  "OWNER_DRAW", "INSURANCE", "FUEL", "TAX", "OTHER",
] as const;

const MANUAL_SOURCES = ["MANUAL", "RECURRING", "IMPORT"] as const;

type ManualEvent = {
  id: string;
  eventDate: string;
  amount: string | number;
  currencyCode: string;
  direction: string;
  category: string;
  description?: string | null;
  sourceType: string;
  sourceId?: string | null;
  expenseCategoryId?: string | null;
  bankAccountId?: string | null;
  metadataJson?: Record<string, unknown> | null;
  expenseCategory?: { id: string; name: string } | null;
};

export default function FinanceAdminPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialBalance, setInitialBalance] = useState("0");
  const [configLoading, setConfigLoading] = useState(true);
  const [cashInRules, setCashInRules] = useState<any[]>([]);
  const [cashOutRules, setCashOutRules] = useState<any[]>([]);
  const [diag, setDiag] = useState<any>(null);
  const [manualList, setManualList] = useState<ManualEvent[]>([]);
  const [manualFilterFrom, setManualFilterFrom] = useState("");
  const [manualFilterTo, setManualFilterTo] = useState("");
  const [manualFilterCategory, setManualFilterCategory] = useState("");
  const [expenseCategories, setExpenseCategories] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [forecastRows, setForecastRows] = useState<any[]>([]);
  const [editingManualId, setEditingManualId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState("");
  const [formDirection, setFormDirection] = useState<"IN" | "OUT">("OUT");
  const [formCategory, setFormCategory] = useState<string>("OTHER");
  const [formSubcategory, setFormSubcategory] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formLabel, setFormLabel] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formSourceType, setFormSourceType] = useState<string>("MANUAL");
  const [formExpenseCategoryId, setFormExpenseCategoryId] = useState("");
  const [formBankAccountId, setFormBankAccountId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const showMsg = (m: string) => {
    setMessage(m);
    setError(null);
    setTimeout(() => setMessage(null), 6000);
  };

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    const res = await getJson<any>("/api/finance/cashflow-config");
    if (res.ok && res.data?.config) {
      setInitialBalance(String(res.data.config.initialBalanceChf ?? 0));
    }
    setConfigLoading(false);
  }, []);

  const loadRules = useCallback(async () => {
    const [inR, outR] = await Promise.all([
      getJson<any>("/api/finance/cash-in-rules"),
      getJson<any>("/api/finance/cash-out-rules"),
    ]);
    if (inR.ok) setCashInRules(inR.data?.rules ?? []);
    if (outR.ok) setCashOutRules(outR.data?.rules ?? []);
  }, []);

  const loadDiagnostics = useCallback(async () => {
    const [d, f] = await Promise.all([
      getJson<any>("/api/finance/diagnostics"),
      getJson<any>("/api/cashflow/assumptions"),
    ]);
    if (d.ok) setDiag(d.data);
    if (f.ok) setForecastRows(f.data?.items ?? f.data ?? []);
  }, []);

  const loadManual = useCallback(async () => {
    const params = new URLSearchParams();
    if (manualFilterFrom) params.set("from", manualFilterFrom);
    if (manualFilterTo) params.set("to", manualFilterTo);
    if (manualFilterCategory) params.set("category", manualFilterCategory);
    const res = await getJson<any>(`/api/finance/manual-events?${params}`);
    if (res.ok) setManualList(res.data?.items ?? []);
  }, [manualFilterFrom, manualFilterTo, manualFilterCategory]);

  const loadMeta = useCallback(async () => {
    const [c, b] = await Promise.all([
      getJson<any>("/api/expenses/categories"),
      getJson<any>("/api/bank/accounts"),
    ]);
    if (c.ok) setExpenseCategories(c.data?.categories ?? []);
    if (b.ok) setBankAccounts(b.data?.items ?? []);
  }, []);

  useEffect(() => {
    loadConfig();
    loadRules();
    loadDiagnostics();
    loadMeta();
  }, [loadConfig, loadRules, loadDiagnostics, loadMeta]);

  useEffect(() => {
    loadManual();
  }, [loadManual]);

  const saveInitialBalance = async () => {
    setBusy("config");
    const res = await putJson("/api/finance/cashflow-config", {
      initialBalanceChf: Number(initialBalance),
    });
    setBusy(null);
    if (!res.ok) {
      setError((res.data as any)?.details || "Save failed");
      return;
    }
    showMsg("Starting cash balance saved.");
  };

  const resetManualForm = () => {
    setEditingManualId(null);
    setFormDate("");
    setFormDirection("OUT");
    setFormCategory("OTHER");
    setFormSubcategory("");
    setFormAmount("");
    setFormLabel("");
    setFormNotes("");
    setFormSourceType("MANUAL");
    setFormExpenseCategoryId("");
    setFormBankAccountId("");
  };

  const startEditManual = (row: ManualEvent) => {
    setEditingManualId(row.id);
    const d = new Date(row.eventDate);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setFormDate(local);
    setFormDirection(row.direction === "IN" ? "IN" : "OUT");
    setFormCategory(row.category || "OTHER");
    const meta = row.metadataJson as any;
    setFormSubcategory(typeof meta?.subcategory === "string" ? meta.subcategory : "");
    setFormAmount(String(row.amount));
    setFormLabel(row.description || "");
    setFormNotes(typeof meta?.notes === "string" ? meta.notes : "");
    setFormSourceType(row.sourceType || "MANUAL");
    setFormExpenseCategoryId(row.expenseCategoryId || "");
    setFormBankAccountId(row.bankAccountId || "");
  };

  const submitManual = async () => {
    if (!formDate || !formAmount) {
      setError("Date and amount required");
      return;
    }
    const metadataJson: Record<string, unknown> = {};
    if (formSubcategory.trim()) metadataJson.subcategory = formSubcategory.trim();
    if (formNotes.trim()) metadataJson.notes = formNotes.trim();
    const body: any = {
      eventDate: new Date(formDate).toISOString(),
      direction: formDirection,
      category: formCategory,
      amount: Number(formAmount),
      description: formLabel || null,
      sourceType: formSourceType,
      expenseCategoryId: formExpenseCategoryId || null,
      bankAccountId: formBankAccountId || null,
      metadataJson: Object.keys(metadataJson).length ? metadataJson : null,
    };
    setBusy("manual");
    if (editingManualId) {
      const res = await putJson("/api/finance/manual-events", { id: editingManualId, ...body });
      setBusy(null);
      if (!res.ok) {
        setError((res.data as any)?.details || "Update failed");
        return;
      }
      showMsg("Updated. Run materialize to sync OperatingEvent.");
    } else {
      const res = await postJson("/api/finance/manual-events", body);
      setBusy(null);
      if (!res.ok) {
        setError((res.data as any)?.details || "Create failed");
        return;
      }
      showMsg("Created. Run materialize to sync OperatingEvent.");
    }
    resetManualForm();
    loadManual();
  };

  const deleteManual = async (id: string) => {
    if (!confirm("Delete this manual finance event?")) return;
    setBusy("manual");
    const res = await delJson(`/api/finance/manual-events?id=${encodeURIComponent(id)}`);
    setBusy(null);
    if (!res.ok) {
      setError((res.data as any)?.details || "Delete failed");
      return;
    }
    showMsg("Deleted. Run materialize to refresh OperatingEvent.");
    if (editingManualId === id) resetManualForm();
    loadManual();
  };

  const runMaterialize = async () => {
    setBusy("mat");
    const res = await postJson("/api/finance/operating-events/materialize", {});
    setBusy(null);
    if (!res.ok) {
      setError((res.data as any)?.details || "Materialize failed");
      return;
    }
    showMsg("Operating events materialized.");
    loadDiagnostics();
  };

  const runGenerate = async () => {
    setBusy("gen");
    const res = await postJson("/api/finance/expected-cash/generate", {});
    setBusy(null);
    if (!res.ok) {
      setError((res.data as any)?.details || "Generate failed");
      return;
    }
    showMsg("Expected cash events generated.");
    loadDiagnostics();
  };

  const saveForecastRow = async (row: any) => {
    setBusy("fc");
    const res = await putJson("/api/cashflow/assumptions", {
      channel: row.channel,
      mode: row.mode,
      expectedDailySales: row.expectedDailySales,
      expectedDailyOrders: row.expectedDailyOrders,
      growthRatePct: row.growthRatePct,
      payoutDelayDays: row.payoutDelayDays,
      commissionRatePct: row.commissionRatePct,
      refundRatePct: row.refundRatePct,
    });
    setBusy(null);
    if (!res.ok) {
      setError((res.data as any)?.details || "Save forecast failed");
      return;
    }
    const items = (res.data as any)?.items;
    if (Array.isArray(items)) setForecastRows(items);
    showMsg("Forecast assumptions saved.");
    loadDiagnostics();
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold text-slate-900">Finance admin</h1>
          <p className="text-slate-600 mt-1">
            Manual inputs, payout rules visibility, event generation, diagnostics.
          </p>
          <nav className="flex flex-wrap gap-2 mt-4">
            <a href="/dashboard" className="px-3 py-1.5 rounded-md bg-slate-200 text-sm font-medium">Dashboard</a>
            <a href="/financial" className="px-3 py-1.5 rounded-md bg-violet-600 text-white text-sm font-medium">P&amp;L</a>
            <a href="/cash-flow" className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm font-medium">Cash flow</a>
          </nav>
        </header>
        {message && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-900 text-sm">{message}</div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 text-sm">
            {error}
            <button type="button" className="ml-3 underline" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Generation</h2>
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={busy !== null} onClick={runMaterialize}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-50">
              {busy === "mat" ? "…" : "Materialize operating events"}
            </button>
            <button type="button" disabled={busy !== null} onClick={runGenerate}
              className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium disabled:opacity-50">
              {busy === "gen" ? "…" : "Generate expected cash events"}
            </button>
            <button type="button" disabled={busy !== null}
              onClick={() => { loadDiagnostics(); loadManual(); showMsg("Refreshed."); }}
              className="px-4 py-2 rounded-md bg-slate-700 text-white text-sm font-medium disabled:opacity-50">
              Refresh stats
            </button>
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Diagnostics</h2>
          {diag ? (
            <div className="text-sm space-y-2 text-slate-700">
              <p>Operating events: {diag.operatingEventCount} · Expected cash: {diag.expectedCashEventCount}</p>
              <p>Last materialized: {diag.lastMaterializedAt ? new Date(diag.lastMaterializedAt).toLocaleString() : "—"}</p>
              <p>Last expected update: {diag.lastExpectedCashUpdatedAt ? new Date(diag.lastExpectedCashUpdatedAt).toLocaleString() : "—"}</p>
              <p className="font-medium mt-2">Sales by channel (OperatingEvent SALE)</p>
              <pre className="text-xs bg-slate-50 p-2 rounded overflow-x-auto">{JSON.stringify(diag.salesEventCountByChannel, null, 2)}</pre>
              <p className="font-medium">COGS coverage</p>
              <pre className="text-xs bg-slate-50 p-2 rounded overflow-x-auto">{JSON.stringify(diag.cogsCoverage, null, 2)}</pre>
              {diag.warnings?.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950">
                  <ul className="list-disc ml-5">{diag.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
                </div>
              )}
            </div>
          ) : <p className="text-slate-500">Loading…</p>}
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Starting cash balance</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-xs text-slate-600">Initial (CHF)</span>
              <input type="number" step="0.01" className="mt-1 border rounded-md px-3 py-2 text-sm block"
                value={initialBalance} onChange={(e) => setInitialBalance(e.target.value)} disabled={configLoading} />
            </label>
            <button type="button" disabled={busy !== null || configLoading} onClick={saveInitialBalance}
              className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium disabled:opacity-50">Save</button>
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Cash-in rules (DB)</h2>
          <p className="text-xs text-slate-500 mb-3">Higher priority wins. Empty payment = channel default. No active rows → code defaults.</p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="border-b text-left text-slate-600">
                <th className="py-2 pr-2">Channel</th><th className="py-2 pr-2">Payment</th><th className="py-2 pr-2">Type</th>
                <th className="py-2 pr-2">Days</th><th className="py-2 pr-2">Pri</th><th className="py-2 pr-2">On</th>
              </tr></thead>
              <tbody>
                {cashInRules.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-2 pr-2">{r.channel}</td>
                    <td className="py-2 pr-2">{r.paymentMethod ?? "—"}</td>
                    <td className="py-2 pr-2">{r.delayType}</td>
                    <td className="py-2 pr-2">{r.delayValueDays ?? "—"}</td>
                    <td className="py-2 pr-2">{r.priority}</td>
                    <td className="py-2 pr-2">{r.active ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CashRuleForms loadRules={loadRules} setError={setError} showMsg={showMsg} busy={busy} setBusy={setBusy} />
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Cash-out rules</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="border-b text-left text-slate-600">
                <th className="py-2 pr-2">Category</th><th className="py-2 pr-2">Cadence</th><th className="py-2 pr-2">Amt</th>
                <th className="py-2 pr-2">Off</th><th className="py-2 pr-2">On</th>
              </tr></thead>
              <tbody>
                {cashOutRules.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-2 pr-2">{r.category}</td>
                    <td className="py-2 pr-2">{r.cadence}</td>
                    <td className="py-2 pr-2">{r.amountChf ?? "—"}</td>
                    <td className="py-2 pr-2">{r.offsetDays ?? "—"}</td>
                    <td className="py-2 pr-2">{r.active ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <ManualEventsSection
          manualList={manualList}
          manualFilterFrom={manualFilterFrom}
          setManualFilterFrom={setManualFilterFrom}
          manualFilterTo={manualFilterTo}
          setManualFilterTo={setManualFilterTo}
          manualFilterCategory={manualFilterCategory}
          setManualFilterCategory={setManualFilterCategory}
          loadManual={loadManual}
          expenseCategories={expenseCategories}
          bankAccounts={bankAccounts}
          editingManualId={editingManualId}
          formDate={formDate}
          setFormDate={setFormDate}
          formDirection={formDirection}
          setFormDirection={setFormDirection}
          formCategory={formCategory}
          setFormCategory={setFormCategory}
          formSubcategory={formSubcategory}
          setFormSubcategory={setFormSubcategory}
          formAmount={formAmount}
          setFormAmount={setFormAmount}
          formLabel={formLabel}
          setFormLabel={setFormLabel}
          formNotes={formNotes}
          setFormNotes={setFormNotes}
          formSourceType={formSourceType}
          setFormSourceType={setFormSourceType}
          formExpenseCategoryId={formExpenseCategoryId}
          setFormExpenseCategoryId={setFormExpenseCategoryId}
          formBankAccountId={formBankAccountId}
          setFormBankAccountId={setFormBankAccountId}
          busy={busy}
          submitManual={submitManual}
          resetManualForm={resetManualForm}
          startEditManual={startEditManual}
          deleteManual={deleteManual}
        />
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Forecast assumptions</h2>
          <div className="space-y-4">
            {forecastRows.map((row: any) => (
              <ForecastRow key={row.channel} row={row} onSave={saveForecastRow} busy={busy === "fc"} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}


function CashRuleForms({
  loadRules,
  setError,
  showMsg,
  busy,
  setBusy,
}: {
  loadRules: () => Promise<void>;
  setError: (m: string | null) => void;
  showMsg: (m: string) => void;
  busy: string | null;
  setBusy: (m: string | null) => void;
}) {
  const [ciChannel, setCiChannel] = useState("SHOPIFY");
  const [ciPay, setCiPay] = useState("");
  const [ciDelayType, setCiDelayType] = useState("BUSINESS_DAYS");
  const [ciDays, setCiDays] = useState("4.5");
  const [ciPri, setCiPri] = useState("100");
  const [coCat, setCoCat] = useState("OWNER_DRAW");
  const [coCad, setCoCad] = useState("WEEKLY");
  const [coAmt, setCoAmt] = useState("400");
  const [coOff, setCoOff] = useState("");

  const addCashIn = async () => {
    setBusy("cir");
    const res = await postJson("/api/finance/cash-in-rules", {
      channel: ciChannel,
      paymentMethod: ciPay.trim() || null,
      delayType: ciDelayType,
      delayValueDays: ciDelayType === "NEXT_FRIDAY" ? null : Number(ciDays),
      priority: Number(ciPri) || 100,
      active: true,
    });
    setBusy(null);
    if (!res.ok) {
      setError((res.data as any)?.details || "Failed to add cash-in rule");
      return;
    }
    showMsg("Cash-in rule created.");
    loadRules();
  };

  const addCashOut = async () => {
    setBusy("cor");
    const res = await postJson("/api/finance/cash-out-rules", {
      category: coCat,
      cadence: coCad,
      amountChf: coAmt === "" ? null : Number(coAmt),
      offsetDays: coOff === "" ? null : Number(coOff),
      active: true,
    });
    setBusy(null);
    if (!res.ok) {
      setError((res.data as any)?.details || "Failed to add cash-out rule");
      return;
    }
    showMsg("Cash-out rule created.");
    loadRules();
  };

  return (
    <div className="mt-4 space-y-6 border-t border-slate-100 pt-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-2">Add cash-in rule</h3>
        <div className="flex flex-wrap gap-2 items-end text-sm">
          <select value={ciChannel} onChange={(e) => setCiChannel(e.target.value)} className="border rounded px-2 py-1">
            <option value="SHOPIFY">SHOPIFY</option>
            <option value="GALAXUS">GALAXUS</option>
            <option value="DECATHLON">DECATHLON</option>
          </select>
          <input placeholder="payment substring" value={ciPay} onChange={(e) => setCiPay(e.target.value)} className="border rounded px-2 py-1 w-36" />
          <select value={ciDelayType} onChange={(e) => setCiDelayType(e.target.value)} className="border rounded px-2 py-1">
            <option value="BUSINESS_DAYS">BUSINESS_DAYS</option>
            <option value="CALENDAR_DAYS">CALENDAR_DAYS</option>
            <option value="NEXT_FRIDAY">NEXT_FRIDAY</option>
          </select>
          <input type="number" step="0.1" title="days" value={ciDays} onChange={(e) => setCiDays(e.target.value)} className="border rounded px-2 py-1 w-20" />
          <input type="number" title="priority" value={ciPri} onChange={(e) => setCiPri(e.target.value)} className="border rounded px-2 py-1 w-16" />
          <button type="button" disabled={busy !== null} onClick={addCashIn} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm disabled:opacity-50">
            Add
          </button>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-2">Add cash-out rule</h3>
        <div className="flex flex-wrap gap-2 items-end text-sm">
          <select value={coCat} onChange={(e) => setCoCat(e.target.value)} className="border rounded px-2 py-1">
            <option value="COGS">COGS</option>
            <option value="ADS">ADS</option>
            <option value="SHIPPING">SHIPPING</option>
            <option value="SUBSCRIPTION">SUBSCRIPTION</option>
            <option value="OWNER_DRAW">OWNER_DRAW</option>
            <option value="INSURANCE">INSURANCE</option>
            <option value="FUEL">FUEL</option>
            <option value="OTHER">OTHER</option>
          </select>
          <select value={coCad} onChange={(e) => setCoCad(e.target.value)} className="border rounded px-2 py-1">
            <option value="DAILY">DAILY</option>
            <option value="WEEKLY">WEEKLY</option>
            <option value="MONTHLY">MONTHLY</option>
          </select>
          <input type="number" placeholder="amount CHF" value={coAmt} onChange={(e) => setCoAmt(e.target.value)} className="border rounded px-2 py-1 w-24" />
          <input type="number" placeholder="offset days" value={coOff} onChange={(e) => setCoOff(e.target.value)} className="border rounded px-2 py-1 w-24" />
          <button type="button" disabled={busy !== null} onClick={addCashOut} className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-50">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function ForecastRow({ row, onSave, busy }: { row: any; onSave: (r: any) => void; busy: boolean }) {
  const [local, setLocal] = useState({ ...row });
  useEffect(() => { setLocal({ ...row }); }, [row]);
  return (
    <div className="border rounded-lg p-4 grid gap-2 md:grid-cols-3 text-sm">
      <div className="font-semibold md:col-span-3">{row.channel}</div>
      <label>Mode
        <select className="mt-1 w-full border rounded px-2 py-1" value={local.mode}
          onChange={(e) => setLocal({ ...local, mode: e.target.value })}>
          <option value="AUTO">AUTO</option><option value="MANUAL">MANUAL</option><option value="HYBRID">HYBRID</option>
        </select>
      </label>
      <label>Expected daily sales
        <input type="number" className="mt-1 w-full border rounded px-2 py-1" value={local.expectedDailySales}
          onChange={(e) => setLocal({ ...local, expectedDailySales: e.target.value })} />
      </label>
      <label>Payout delay days
        <input type="number" className="mt-1 w-full border rounded px-2 py-1" value={local.payoutDelayDays ?? ""}
          onChange={(e) => setLocal({ ...local, payoutDelayDays: e.target.value })} />
      </label>
      <button type="button" disabled={busy} onClick={() => onSave(local)}
        className="md:col-span-3 px-3 py-2 rounded-md bg-slate-800 text-white text-sm disabled:opacity-50">Save</button>
    </div>
  );
}

function ManualEventsSection(props: any) {
  const {
    manualList, manualFilterFrom, setManualFilterFrom, manualFilterTo, setManualFilterTo,
    manualFilterCategory, setManualFilterCategory, loadManual, expenseCategories, bankAccounts,
    editingManualId, formDate, setFormDate, formDirection, setFormDirection, formCategory, setFormCategory,
    formSubcategory, setFormSubcategory, formAmount, setFormAmount, formLabel, setFormLabel,
    formNotes, setFormNotes, formSourceType, setFormSourceType, formExpenseCategoryId, setFormExpenseCategoryId,
    formBankAccountId, setFormBankAccountId, busy, submitManual, resetManualForm, startEditManual, deleteManual,
  } = props;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Manual finance events</h2>
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="date" value={manualFilterFrom} onChange={(e) => setManualFilterFrom(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        <input type="date" value={manualFilterTo} onChange={(e) => setManualFilterTo(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        <select value={manualFilterCategory} onChange={(e) => setManualFilterCategory(e.target.value)} className="border rounded px-2 py-1 text-sm">
          <option value="">All categories</option>
          {FINANCE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" onClick={loadManual} className="px-3 py-1.5 rounded-md bg-slate-200 text-sm">Apply</button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 border rounded-lg p-4 bg-slate-50/50 mb-6">
        <h3 className="md:col-span-2 font-medium">{editingManualId ? "Edit" : "Add"}</h3>
        <label className="text-sm block"><span className="text-slate-600">Date</span>
          <input type="datetime-local" className="mt-1 w-full border rounded px-2 py-1.5" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
        </label>
        <label className="text-sm block"><span className="text-slate-600">Direction</span>
          <select className="mt-1 w-full border rounded px-2 py-1.5" value={formDirection} onChange={(e) => setFormDirection(e.target.value as "IN"|"OUT")}>
            <option value="OUT">Out</option><option value="IN">In</option>
          </select>
        </label>
        <label className="text-sm block"><span className="text-slate-600">Category</span>
          <select className="mt-1 w-full border rounded px-2 py-1.5" value={formCategory} onChange={(e) => setFormCategory(e.target.value)}>
            {FINANCE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-sm block"><span className="text-slate-600">Subcategory (metadata)</span>
          <input className="mt-1 w-full border rounded px-2 py-1.5" value={formSubcategory} onChange={(e) => setFormSubcategory(e.target.value)} />
        </label>
        <label className="text-sm block"><span className="text-slate-600">Amount</span>
          <input type="number" step="0.01" className="mt-1 w-full border rounded px-2 py-1.5" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} />
        </label>
        <label className="text-sm block"><span className="text-slate-600">Label</span>
          <input className="mt-1 w-full border rounded px-2 py-1.5" value={formLabel} onChange={(e) => setFormLabel(e.target.value)} />
        </label>
        <label className="text-sm block md:col-span-2"><span className="text-slate-600">Notes (metadata)</span>
          <input className="mt-1 w-full border rounded px-2 py-1.5" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
        </label>
        <label className="text-sm block"><span className="text-slate-600">Source</span>
          <select className="mt-1 w-full border rounded px-2 py-1.5" value={formSourceType} onChange={(e) => setFormSourceType(e.target.value)}>
            {MANUAL_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-sm block"><span className="text-slate-600">Expense category</span>
          <select className="mt-1 w-full border rounded px-2 py-1.5" value={formExpenseCategoryId} onChange={(e) => setFormExpenseCategoryId(e.target.value)}>
            <option value="">—</option>
            {expenseCategories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm block md:col-span-2"><span className="text-slate-600">Bank account</span>
          <select className="mt-1 w-full border rounded px-2 py-1.5" value={formBankAccountId} onChange={(e) => setFormBankAccountId(e.target.value)}>
            <option value="">—</option>
            {bankAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <div className="md:col-span-2 flex gap-2">
          <button type="button" disabled={busy === "manual"} onClick={submitManual}
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm disabled:opacity-50">{editingManualId ? "Save" : "Create"}</button>
          {editingManualId && <button type="button" onClick={resetManualForm} className="px-4 py-2 rounded-md bg-slate-200 text-sm">Cancel</button>}
        </div>
      </div>
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-white border-b">
            <tr className="text-left text-slate-600">
              <th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Dir</th><th className="py-2 pr-2">Cat</th>
              <th className="py-2 pr-2 text-right">Amt</th><th className="py-2 pr-2">Label</th><th className="py-2 pr-2" />
            </tr>
          </thead>
          <tbody>
            {manualList.map((row: ManualEvent) => (
              <tr key={row.id} className="border-b border-slate-100">
                <td className="py-2 pr-2 whitespace-nowrap">{new Date(row.eventDate).toLocaleString()}</td>
                <td className="py-2 pr-2">{row.direction}</td>
                <td className="py-2 pr-2">{row.category}</td>
                <td className="py-2 pr-2 text-right">{formatMoneyCHF(Number(row.amount))}</td>
                <td className="py-2 pr-2 max-w-xs truncate">{row.description ?? "—"}</td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  <button type="button" className="text-blue-600 mr-2" onClick={() => startEditManual(row)}>Edit</button>
                  <button type="button" className="text-red-600" onClick={() => deleteManual(row.id)}>Del</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
