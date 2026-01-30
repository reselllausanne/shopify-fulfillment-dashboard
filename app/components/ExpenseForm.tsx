"use client";

import { useState, useEffect } from "react";

interface ExpenseFormValues {
  id?: string;
  date: string;
  amount: string | number;
  categoryId: string;
  accountId: string;
  note: string;
  isBusiness: boolean;
}

interface ExpenseFormProps {
  expense?: Partial<ExpenseFormValues>;
  categories: any[];
  accounts: any[];
  onSave: (expense: any) => void;
  onCancel: () => void;
}

export default function ExpenseForm({ expense, categories, accounts, onSave, onCancel }: ExpenseFormProps) {
  const [formData, setFormData] = useState<ExpenseFormValues>({
    id: expense?.id,
    date: expense?.date ? new Date(expense.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    amount: expense?.amount || "",
    categoryId: expense?.categoryId || "",
    accountId: expense?.accountId || "",
    note: expense?.note || "",
    isBusiness: expense?.isBusiness || false,
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload: ExpenseFormValues = {
        ...formData,
        amount: parseFloat(formData.amount),
      };

      const response = await fetch("/api/expenses", {
        method: expense?.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save expense");
      }

      onSave(data.expense);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
        <input
          type="date"
          value={formData.date}
          onChange={(e) => setFormData({ ...formData, date: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Amount (CHF)</label>
        <input
          type="number"
          step="0.01"
          value={formData.amount}
          onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="0.00"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
        <select
          value={formData.categoryId}
          onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        >
          <option value="">Select category...</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.type === "BUSINESS" ? "💼" : "👤"} {cat.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Payment Account</label>
        <select
          value={formData.accountId}
          onChange={(e) => setFormData({ ...formData, accountId: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        >
          <option value="">Select account...</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              💳 {acc.name} ({acc.currency})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
        <textarea
          value={formData.note}
          onChange={(e) => setFormData({ ...formData, note: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={2}
          placeholder="Description..."
        />
      </div>

      <div className="flex items-center">
        <input
          type="checkbox"
          id="isBusiness"
          checked={formData.isBusiness}
          onChange={(e) => setFormData({ ...formData, isBusiness: e.target.checked })}
          className="mr-2"
        />
        <label htmlFor="isBusiness" className="text-sm font-medium text-gray-700">
          Business Expense
        </label>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 font-medium"
        >
          {loading ? "Saving..." : expense?.id ? "Update" : "Create"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 font-medium"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

