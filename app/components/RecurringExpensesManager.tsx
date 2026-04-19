import { useEffect, useMemo, useState } from "react";
import { delJson, getJson, postJson, putJson } from "@/app/lib/api";
import { toNumberSafe } from "@/app/utils/numbers";

type Category = { id: string; name: string; type: string };
type Account = { id: string; name: string };

type RecurringExpense = {
  id: string;
  name: string;
  amount: number;
  currencyCode: string;
  categoryId: string;
  categoryName?: string | null;
  accountId: string;
  accountName?: string | null;
  isBusiness: boolean;
  dayOfMonth: number;
  intervalMonths: number;
  startDate: string;
  endDate?: string | null;
  nextRunDate: string;
  lastRunAt?: string | null;
  active: boolean;
  note?: string | null;
};

export default function RecurringExpensesManager() {
  const [items, setItems] = useState<RecurringExpense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    amount: "",
    categoryId: "",
    accountId: "",
    isBusiness: false,
    dayOfMonth: "1",
    intervalMonths: "1",
    startDate: new Date().toISOString().split("T")[0],
    endDate: "",
    note: "",
  });

  const defaultBackfillFrom = () => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - 3);
    return d.toISOString().split("T")[0];
  };

  const [bfFrom, setBfFrom] = useState(defaultBackfillFrom);
  const [bfTo, setBfTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [bfTemplateId, setBfTemplateId] = useState("");
  const [bfBusy, setBfBusy] = useState(false);

  const [purgeTemplateId, setPurgeTemplateId] = useState("");
  const [purgeFrom, setPurgeFrom] = useState("");
  const [purgeTo, setPurgeTo] = useState("");
  const [purgeBusy, setPurgeBusy] = useState(false);

  const resetForm = () => {
    setForm({
      name: "",
      amount: "",
      categoryId: "",
      accountId: "",
      isBusiness: false,
      dayOfMonth: "1",
      intervalMonths: "1",
      startDate: new Date().toISOString().split("T")[0],
      endDate: "",
      note: "",
    });
    setEditingId(null);
  };

  const loadData = async () => {
    setLoading(true);
    const [itemsRes, catRes, accRes] = await Promise.all([
      getJson<{ items: RecurringExpense[] }>("/api/recurring-expenses"),
      getJson<{ categories: Category[] }>("/api/expenses/categories"),
      getJson<{ accounts: Account[] }>("/api/expenses/accounts"),
    ]);
    if (itemsRes.ok) setItems(itemsRes.data.items || []);
    if (catRes.ok) setCategories(catRes.data.categories || []);
    if (accRes.ok) setAccounts(accRes.data.accounts || []);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async () => {
    if (!form.name || !form.amount || !form.categoryId || !form.accountId) {
      alert("Missing required fields: name, amount, category, payment source");
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name,
      amount: Number(form.amount),
      categoryId: form.categoryId,
      accountId: form.accountId,
      isBusiness: form.isBusiness,
      dayOfMonth: Number(form.dayOfMonth),
      intervalMonths: Number(form.intervalMonths),
      startDate: form.startDate,
      endDate: form.endDate.trim() === "" ? null : form.endDate,
      note: form.note.trim() === "" ? null : form.note,
    };

    const res = editingId
      ? await putJson<{ error?: string }>("/api/recurring-expenses", { ...payload, id: editingId })
      : await postJson<{ error?: string }>("/api/recurring-expenses", payload);

    if (!res.ok) {
      alert(res.data?.error || "Failed to save recurring expense");
    } else {
      await loadData();
      resetForm();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this recurring expense template? (Generated expense rows are not removed.)")) return;
    const res = await delJson<{ error?: string }>(`/api/recurring-expenses?id=${id}`);
    if (res.ok) loadData();
  };

  const handleEdit = (item: RecurringExpense) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      amount: String(toNumberSafe(item.amount, 0)),
      categoryId: item.categoryId,
      accountId: item.accountId,
      isBusiness: item.isBusiness,
      dayOfMonth: String(item.dayOfMonth),
      intervalMonths: String(item.intervalMonths),
      startDate: item.startDate ? new Date(item.startDate).toISOString().split("T")[0] : "",
      endDate: item.endDate ? new Date(item.endDate).toISOString().split("T")[0] : "",
      note: item.note || "",
    });
  };

  const toggleActive = async (item: RecurringExpense) => {
    const res = await putJson<{ error?: string }>("/api/recurring-expenses", {
      id: item.id,
      active: !item.active,
    });
    if (res.ok) loadData();
  };

  const runNow = async (id?: string) => {
    const res = await postJson<{ error?: string; created?: number }>(
      "/api/recurring-expenses/run",
      id ? { id } : {}
    );
    if (!res.ok) {
      alert(res.data?.error || "Failed to run recurring expenses");
    } else {
      await loadData();
      alert(`Created ${res.data?.created || 0} expense(s).`);
    }
  };

  const runBackfill = async () => {
    if (!bfFrom || !bfTo) {
      alert("Choose from and to dates.");
      return;
    }
    setBfBusy(true);
    const res = await postJson<{
      error?: string;
      createdExpenses?: number;
      upsertedManualEvents?: number;
    }>("/api/recurring-expenses/backfill", {
      from: bfFrom,
      to: bfTo,
      ...(bfTemplateId ? { id: bfTemplateId } : {}),
    });
    setBfBusy(false);
    if (!res.ok) {
      alert(res.data?.error || "Backfill failed");
      return;
    }
    alert(
      `Backfill done: ${res.data?.createdExpenses ?? 0} new expense row(s), ${res.data?.upsertedManualEvents ?? 0} manual finance sync row(s).`
    );
    await loadData();
  };

  const runPurgeGenerated = async () => {
    if (!purgeTemplateId) {
      alert("Select a recurring template to purge generated rows for.");
      return;
    }
    if (
      !confirm(
        "Delete all PersonalExpense rows (and linked manual finance rows) created from this recurring template? You can backfill again afterwards."
      )
    ) {
      return;
    }
    const q = new URLSearchParams({ recurringId: purgeTemplateId });
    if (purgeFrom.trim()) q.set("from", purgeFrom.trim());
    if (purgeTo.trim()) q.set("to", purgeTo.trim());
    setPurgeBusy(true);
    const res = await delJson<{ error?: string; deletedPersonalExpenses?: number }>(
      `/api/recurring-expenses/generated?${q.toString()}`
    );
    setPurgeBusy(false);
    if (!res.ok) {
      alert(res.data?.error || "Purge failed");
      return;
    }
    alert(
      `Removed ${res.data?.deletedPersonalExpenses ?? 0} expense row(s). Refresh the financial overview if it is open.`
    );
    await loadData();
  };

  const dayOptions = useMemo(() => Array.from({ length: 31 }, (_, i) => String(i + 1)), []);

  if (loading) {
    return <div className="text-gray-600">Loading recurring expenses...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">🔁 Recurring expenses</h2>
            <p className="text-sm text-gray-500 mt-1">
              Label, category, amount, cadence, start/end, payment source (card or bank account), business vs personal,
              notes. Use Backfill / Remove generated rows to clean history.
            </p>
          </div>
          <button
            onClick={() => runNow()}
            className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm shrink-0"
          >
            Run due now
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Label (e.g. Shopify, insurance)"
            className="px-3 py-2 border rounded"
          />
          <input
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="Amount (CHF)"
            className="px-3 py-2 border rounded"
          />
          <select
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="px-3 py-2 border rounded"
          >
            <option value="">Category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            className="px-3 py-2 border rounded"
          >
            <option value="">Payment source (card / bank)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={form.dayOfMonth}
            onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}
            className="px-3 py-2 border rounded"
          >
            {dayOptions.map((d) => (
              <option key={d} value={d}>
                Day of month {d}
              </option>
            ))}
          </select>
          <select
            value={form.intervalMonths}
            onChange={(e) => setForm({ ...form, intervalMonths: e.target.value })}
            className="px-3 py-2 border rounded"
          >
            <option value="1">Monthly</option>
            <option value="3">Quarterly</option>
            <option value="12">Yearly</option>
          </select>
          <input
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            className="px-3 py-2 border rounded"
            title="Start date"
          />
          <input
            type="date"
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            className="px-3 py-2 border rounded"
            title="Optional end date"
          />
          <label className="flex items-center gap-2 text-sm md:col-span-1">
            <input
              type="checkbox"
              checked={form.isBusiness}
              onChange={(e) => setForm({ ...form, isBusiness: e.target.checked })}
            />
            Business (unchecked = personal)
          </label>
          <input
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="Notes (optional)"
            className="px-3 py-2 border rounded md:col-span-2"
          />
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {editingId ? "Update" : "Create"}
          </button>
          {editingId && (
            <button onClick={resetForm} className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md">
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Templates</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Payment source</th>
                <th className="px-3 py-2 text-left">Next run</th>
                <th className="px-3 py-2 text-left">Ends</th>
                <th className="px-3 py-2 text-left">Interval</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{i.name}</td>
                  <td className="px-3 py-2 text-right">CHF {toNumberSafe(i.amount, 0).toFixed(2)}</td>
                  <td className="px-3 py-2">{i.categoryName || "—"}</td>
                  <td className="px-3 py-2">{i.accountName || "—"}</td>
                  <td className="px-3 py-2">
                    {i.nextRunDate ? new Date(i.nextRunDate).toLocaleDateString("de-CH") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {i.endDate ? new Date(i.endDate).toLocaleDateString("de-CH") : "—"}
                  </td>
                  <td className="px-3 py-2">{i.intervalMonths} mo</td>
                  <td className="px-3 py-2">{i.active ? "Active" : "Paused"}</td>
                  <td className="px-3 py-2">{i.isBusiness ? "Business" : "Personal"}</td>
                  <td className="px-3 py-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => handleEdit(i)} className="text-blue-600 hover:underline">
                      Edit
                    </button>
                    <button type="button" onClick={() => toggleActive(i)} className="text-purple-600 hover:underline">
                      {i.active ? "Pause" : "Activate"}
                    </button>
                    <button type="button" onClick={() => runNow(i.id)} className="text-green-600 hover:underline">
                      Run
                    </button>
                    <button type="button" onClick={() => handleDelete(i.id)} className="text-red-600 hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-gray-500" colSpan={10}>
                    No recurring expenses yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-2">Backfill past periods</h3>
          <p className="text-sm text-gray-600 mb-4">
            Create missing <code className="bg-gray-100 px-1 rounded">PersonalExpense</code> rows (with{" "}
            <code className="bg-gray-100 px-1 rounded">[RECURRING:id]</code>) for each due date in the range. Does not
            change the template&apos;s next run date.
          </p>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 items-center">
              <label className="text-sm text-gray-700">
                From
                <input
                  type="date"
                  className="ml-2 border rounded px-2 py-1"
                  value={bfFrom}
                  onChange={(e) => setBfFrom(e.target.value)}
                />
              </label>
              <label className="text-sm text-gray-700">
                To
                <input
                  type="date"
                  className="ml-2 border rounded px-2 py-1"
                  value={bfTo}
                  onChange={(e) => setBfTo(e.target.value)}
                />
              </label>
            </div>
            <select
              className="border rounded px-2 py-2 text-sm max-w-md"
              value={bfTemplateId}
              onChange={(e) => setBfTemplateId(e.target.value)}
            >
              <option value="">All templates</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={bfBusy}
              onClick={runBackfill}
              className="w-fit px-4 py-2 bg-indigo-600 text-white rounded-md text-sm disabled:opacity-50"
            >
              {bfBusy ? "Running…" : "Run backfill"}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-amber-200 p-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-2">Remove generated rows</h3>
          <p className="text-sm text-gray-600 mb-4">
            Deletes posted expenses that came from a template (matched by note marker) and matching manual finance
            rows. Use when you want to wipe history and re-backfill.
          </p>
          <div className="flex flex-col gap-3">
            <select
              className="border rounded px-2 py-2 text-sm max-w-md"
              value={purgeTemplateId}
              onChange={(e) => setPurgeTemplateId(e.target.value)}
            >
              <option value="">Select template…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2 items-center">
              <label className="text-sm text-gray-700">
                From (optional)
                <input
                  type="date"
                  className="ml-2 border rounded px-2 py-1"
                  value={purgeFrom}
                  onChange={(e) => setPurgeFrom(e.target.value)}
                />
              </label>
              <label className="text-sm text-gray-700">
                To (optional)
                <input
                  type="date"
                  className="ml-2 border rounded px-2 py-1"
                  value={purgeTo}
                  onChange={(e) => setPurgeTo(e.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={purgeBusy}
              onClick={runPurgeGenerated}
              className="w-fit px-4 py-2 bg-red-600 text-white rounded-md text-sm disabled:opacity-50"
            >
              {purgeBusy ? "Removing…" : "Remove generated rows"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
