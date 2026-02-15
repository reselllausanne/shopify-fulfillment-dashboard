"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function PartnerLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [partnerKey, setPartnerKey] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/partners/dashboard";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/partners/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid credentials");
        return;
      }
      router.push(data.redirect || callbackUrl);
      router.refresh();
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/partners/auth/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerKey, accessCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Quick access failed");
        return;
      }
      router.push(data.redirect || callbackUrl);
      router.refresh();
    } catch {
      setError("Quick access failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-8 space-y-6">
      <details className="rounded border border-gray-100 p-3">
        <summary className="text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer">
          Email login (optional)
        </summary>
        <form className="mt-3 space-y-4" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email" className="sr-only">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </details>

      <div className="border-t pt-4">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Quick access (recommended)
        </div>
        <p className="text-xs text-gray-500">
          Use your partner key and access code. Keys are short (e.g. 3 letters).
        </p>
        <form className="mt-3 space-y-3" onSubmit={handleQuickAccess}>
          <input
            className="w-full px-3 py-2 border rounded text-sm"
            placeholder="Partner key (e.g. ABC)"
            value={partnerKey}
            onChange={(e) => setPartnerKey(e.target.value)}
            required
          />
          <input
            className="w-full px-3 py-2 border rounded text-sm"
            placeholder="Access code"
            type="password"
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value)}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full px-3 py-2 rounded bg-gray-900 text-white text-sm disabled:opacity-50"
          >
            {loading ? "Starting…" : "Enter partner dashboard"}
          </button>
        </form>
      </div>

      {error && (
        <div className="text-red-500 text-sm text-center font-medium bg-red-50 py-2 rounded">
          {error}
        </div>
      )}
    </div>
  );
}

export default function PartnerLoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-xl shadow-lg border border-gray-100">
        <div>
          <h2 className="mt-2 text-center text-3xl font-extrabold text-gray-900">
            Partner Portal
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Sign in to upload and manage your catalog.
          </p>
        </div>

        <Suspense fallback={<div className="text-center text-gray-400">Loading…</div>}>
          <PartnerLoginForm />
        </Suspense>
      </div>
    </div>
  );
}
