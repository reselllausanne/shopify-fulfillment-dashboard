"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
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
        body: JSON.stringify({
          partnerKey,
          accessCode: accessCode.trim() ? accessCode : undefined,
        }),
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
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Partner login</div>
        <p className="mt-1 text-xs text-slate-500">
          Use the email and password provided for your account. No access code is required unless your administrator
          configured one.
        </p>
        <form className="mt-3 space-y-4" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email" className="sr-only">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="appearance-none rounded-none relative block w-full rounded-t-md border border-slate-800 bg-slate-900 px-3 py-3 text-sm text-slate-100 placeholder-slate-500 focus:z-10 focus:border-[#55b3f3] focus:outline-none focus:ring-1 focus:ring-[#55b3f3]"
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
                className="appearance-none rounded-none relative block w-full rounded-b-md border border-slate-800 bg-slate-900 px-3 py-3 text-sm text-slate-100 placeholder-slate-500 focus:z-10 focus:border-[#55b3f3] focus:outline-none focus:ring-1 focus:ring-[#55b3f3]"
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
            className="group relative flex w-full justify-center rounded-md border border-transparent bg-[#55b3f3] px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-[#6cc1f5] disabled:cursor-not-allowed disabled:bg-slate-600"
          >
            {loading ? "Signing in…" : "Sign in to partner dashboard"}
          </button>
        </form>
      </div>

      <details className="rounded border border-slate-800 bg-slate-950/60 p-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-400">
          Quick access (partner key only, optional access code)
        </summary>
        <p className="mt-2 text-xs text-slate-500">
          If your administrator set a global or per-partner access code, enter it below. Otherwise leave the code
          empty.
        </p>
        <form className="mt-3 space-y-3" onSubmit={handleQuickAccess}>
          <input
            className="w-full rounded border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-[#55b3f3] focus:outline-none focus:ring-1 focus:ring-[#55b3f3]"
            placeholder="Partner key (e.g. ABC)"
            value={partnerKey}
            onChange={(e) => setPartnerKey(e.target.value)}
            required
          />
          <input
            className="w-full rounded border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-[#55b3f3] focus:outline-none focus:ring-1 focus:ring-[#55b3f3]"
            placeholder="Access code (only if configured)"
            type="password"
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value)}
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-100 disabled:opacity-50"
          >
            {loading ? "Starting…" : "Enter with partner key"}
          </button>
        </form>
      </details>

      {error && (
        <div className="rounded bg-red-500/20 py-2 text-center text-sm font-medium text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}

export default function PartnerLoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="max-w-md w-full space-y-8 rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <div>
          <div className="text-center text-xs uppercase tracking-[0.3em] text-slate-400">
            Partner Portal
          </div>
          <h2 className="mt-2 text-center text-3xl font-semibold text-white">Welcome back</h2>
          <p className="mt-2 text-center text-sm text-slate-400">
            Sign in to upload, enrich, and manage your catalog.
          </p>
        </div>

        <Suspense fallback={<div className="text-center text-slate-500">Loading…</div>}>
          <PartnerLoginForm />
        </Suspense>

        <p className="text-center text-xs text-slate-500">
          Staff (admin / logistics)?{" "}
          <Link href="/login" className="text-[#55b3f3] underline hover:text-[#7ac6f6]">
            Use the main login
          </Link>
        </p>
      </div>
    </div>
  );
}
