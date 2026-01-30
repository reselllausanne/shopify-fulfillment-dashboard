"use client";

import { useState, useEffect } from "react";
import { getJson, postJson } from "@/app/lib/api";

type ExpenseCategory = {
  id: string;
  name: string;
  type: "BUSINESS" | "PERSONAL" | string;
};

type ExpenseAccount = {
  id: string;
  name: string;
  currency: string;
};

type Expense = {
  id: string;
  amount: number;
  isBusiness: boolean;
  date: string;
  note?: string | null;
  category: ExpenseCategory;
  account: ExpenseAccount;
};

export default function ExpensesPage() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [accounts, setAccounts] = useState<ExpenseAccount[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Form state
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const [isBusiness, setIsBusiness] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [catData, accData, expData] = await Promise.all([
        getJson<{ categories: ExpenseCategory[] }>("/api/expenses/categories"),
        getJson<{ accounts: ExpenseAccount[] }>("/api/expenses/accounts"),
        getJson<{ expenses: Expense[] }>("/api/expenses?from=2024-01-01"),
      ]);
      
      const cats = catData.data?.categories || [];
      const accs = accData.data?.accounts || [];
      const exps = expData.data?.expenses || [];
      
      setCategories(cats);
      setAccounts(accs);
      setExpenses(exps);

      if (cats.length > 0) setCategoryId(cats[0].id);
      if (accs.length > 0) setAccountId(accs[0].id);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    
    try {
      const res = await postJson<any>("/api/expenses", {
          date,
          amount: parseFloat(amount),
          categoryId,
          accountId,
          note: note || null,
          isBusiness,
        currencyCode: "CHF",
      });
      
      if (res.ok) {
        alert("✅ Expense added!");
        setAmount("");
        setNote("");
        loadData();
      } else {
        alert("Error: " + (res.data?.error || "Failed to add expense"));
      }
    } catch (error) {
      console.error('Error adding expense:', error);
      alert('Error adding expense');
    } finally {
      setLoading(false);
    }
  }

  const total = expenses.reduce((sum, exp) => sum + exp.amount, 0);
  const businessTotal = expenses.filter(e => e.isBusiness).reduce((sum, e) => sum + e.amount, 0);
  const personalTotal = expenses.filter(e => !e.isBusiness).reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">💰 Personal Expenses</h1>
          <p className="text-gray-600 mt-2">Track your daily expenses and business costs</p>
          
          {/* Navigation */}
          <nav className="flex flex-wrap gap-3 mt-4">
            <a
              href="/"
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors font-medium"
            >
              🏠 Orders
            </a>
            <a
              href="/dashboard"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
            >
              📊 Dashboard
            </a>
            <span className="text-gray-900 font-bold py-2 px-3 bg-green-100 rounded-md">
              💰 Expenses (Current)
            </span>
            <a
              href="/financial"
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors font-medium"
            >
              📈 Financial Overview
            </a>
          </nav>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Total Expenses</div>
            <div className="text-2xl font-bold text-gray-900">CHF {total.toFixed(2)}</div>
            <div className="text-xs text-gray-500 mt-1">{expenses.length} transactions</div>
          </div>
          <div className="bg-blue-50 p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-blue-700">Business</div>
            <div className="text-2xl font-bold text-blue-900">CHF {businessTotal.toFixed(2)}</div>
          </div>
          <div className="bg-green-50 p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-green-700">Personal</div>
            <div className="text-2xl font-bold text-green-900">CHF {personalTotal.toFixed(2)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Add Expense Form */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-bold text-gray-900 mb-4">➕ Add New Expense</h2>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (CHF)</label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  {categories.map((cat: ExpenseCategory) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.type === 'BUSINESS' ? '🏢' : '👤'} {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Account</label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  {accounts.map((acc: ExpenseAccount) => (
                    <option key={acc.id} value={acc.id}>
                      💳 {acc.name} ({acc.currency})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Description..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isBusiness"
                  checked={isBusiness}
                  onChange={(e) => setIsBusiness(e.target.checked)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="isBusiness" className="ml-2 block text-sm text-gray-900">
                  Mark as Business Expense
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
              >
                {loading ? 'Adding...' : '✅ Add Expense'}
              </button>
            </form>
          </div>

          {/* Recent Expenses List */}
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900">📋 Recent Expenses</h2>
              <button
                onClick={() => {
                  // Generate CSV
                  const header = 'Date,Amount,Category,Account,Note,Type\n';
                  const rows = expenses.map((e: Expense) => 
                    `${new Date(e.date).toLocaleDateString()},${e.amount.toFixed(2)},${e.category.name},${e.account.name},"${e.note || ''}",${e.isBusiness ? 'Business' : 'Personal'}`
                  ).join('\n');
                  const csv = header + rows;
                  
                  // Download
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `expenses-${new Date().toISOString().split('T')[0]}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium text-sm"
              >
                📥 Export CSV
              </button>
            </div>
            
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {expenses.slice(0, 50).map((exp) => (
                <div key={exp.id} className="border border-gray-200 rounded-md p-3 hover:bg-gray-50">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">
                        {exp.category.name}
                        {exp.isBusiness && <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">Business</span>}
                      </div>
                      {exp.note && <div className="text-sm text-gray-600">{exp.note}</div>}
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(exp.date).toLocaleDateString()} • {exp.account.name}
                      </div>
                    </div>
                    <div className="text-lg font-bold text-gray-900">
                      CHF {exp.amount.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
              
              {expenses.length === 0 && (
                <div className="text-center text-gray-500 py-8">
                  No expenses yet. Add your first one! 👆
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

