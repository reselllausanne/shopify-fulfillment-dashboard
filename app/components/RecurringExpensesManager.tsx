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
    note: "",
  });

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
      alert("Missing required fields: name, amount, category, account");
      return;
    }
    setSaving(true);
    const payload = {
      ...form,
      amount: Number(form.amount),
      dayOfMonth: Number(form.dayOfMonth),
      intervalMonths: Number(form.intervalMonths),
    };

    const res = editingId
      ? await putJson("/api/recurring-expenses", { ...payload, id: editingId })
      : await postJson("/api/recurring-expenses", payload);

    if (!res.ok) {
      alert(res.data?.error || "Failed to save recurring expense");
    } else {
      await loadData();
      resetForm();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this recurring expense?")) return;
    const res = await delJson(`/api/recurring-expenses?id=${id}`);
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
      note: item.note || "",
    });
  };

  const toggleActive = async (item: RecurringExpense) => {
    const res = await putJson("/api/recurring-expenses", {
      id: item.id,
      active: !item.active,
    });
    if (res.ok) loadData();
  };

  const runNow = async (id?: string) => {
    const res = await postJson("/api/recurring-expenses/run", id ? { id } : {});
    if (!res.ok) {
      alert(res.data?.error || "Failed to run recurring expenses");
    } else {
      await loadData();
      alert(`Created ${res.data?.created || 0} expense(s).`);
    }
  };

  const dayOptions = useMemo(() => Array.from({ length: 28 }, (_, i) => String(i + 1)), []);

  if (loading) {
    return <div className="text-gray-600">Loading recurring expenses...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">🔁 Recurring Subscriptions</h2>
          <button
            onClick={() => runNow()}
            className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm"
          >
            Run Due Now
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Name (e.g., Shopify, GSuite)"
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
            <option value="">Account</option>
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
                Day {d}
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
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isBusiness}
              onChange={(e) => setForm({ ...form, isBusiness: e.target.checked })}
            />
            Business expense
          </label>
          <input
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder="Note (optional)"
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
            <button
              onClick={resetForm}
              className="px-4 py-2 bg-gray-100 text-gray-800 rounded-md"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Active recurring expenses</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Account</th>
                <th className="px-3 py-2 text-left">Next Run</th>
                <th className="px-3 py-2 text-left">Interval</th>
                <th className="px-3 py-2 text-left">Status</th>
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
                  <td className="px-3 py-2">{i.intervalMonths} mo</td>
                  <td className="px-3 py-2">{i.active ? "Active" : "Paused"}</td>
                  <td className="px-3 py-2 flex gap-2">
                    <button
                      onClick={() => handleEdit(i)}
                      className="text-blue-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(i)}
                      className="text-purple-600 hover:underline"
                    >
                      {i.active ? "Pause" : "Activate"}
                    </button>
                    <button
                      onClick={() => runNow(i.id)}
                      className="text-green-600 hover:underline"
                    >
                      Run
                    </button>
                    <button
                      onClick={() => handleDelete(i.id)}
                      className="text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-gray-500" colSpan={8}>
                    No recurring expenses yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

