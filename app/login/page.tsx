"use client";

import { useState, Suspense, useLayoutEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Reverse-proxy / staff gate often sends unauthenticated users to `/login?callbackUrl=…`.
 * Partner routes must never sit behind the admin password screen: send them to `/partners/login`.
 */
function resolvePartnerLoginRedirect(callbackUrlRaw: string | null): string | null {
  if (!callbackUrlRaw) return null;
  let path: string;
  try {
    path = decodeURIComponent(callbackUrlRaw);
  } catch {
    path = callbackUrlRaw;
  }
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (!path.startsWith("/partners")) return null;
  if (path === "/partners/login") return "/partners/login";
  return `/partners/login?callbackUrl=${encodeURIComponent(path)}`;
}

function StaffOrPartnerLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const partnerRedirect = resolvePartnerLoginRedirect(searchParams.get("callbackUrl"));

  useLayoutEffect(() => {
    if (partnerRedirect) router.replace(partnerRedirect);
  }, [partnerRedirect, router]);

  if (partnerRedirect) {
    return (
      <div className="min-h-[40vh] flex flex-col items-center justify-center text-gray-500 text-sm">
        <p>Opening partner login…</p>
        <p className="mt-2 text-xs text-gray-400">You are being redirected to the supplier portal.</p>
      </div>
    );
  }

  return <LoginForm />;
}

function LoginForm() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (res.ok) {
        // Redirect logic handled by the API response or callbackUrl
        const destination = data.role === "logistics" ? "/scan" : callbackUrl;
        router.push(destination);
        router.refresh();
      } else {
        setError(data.error || "Invalid password");
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
      <div className="rounded-md shadow-sm -space-y-px">
        <div>
          <label htmlFor="password" className="sr-only">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="appearance-none rounded-none relative block w-full px-3 py-3 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md rounded-b-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      {error && (
        <div className="text-red-500 text-sm text-center font-medium bg-red-50 py-2 rounded">
          {error}
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={loading}
          className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            "Sign In"
          )}
        </button>
      </div>
    </form>
  );
}

function LoginPageShell() {
  const searchParams = useSearchParams();
  const partnerRedirect = resolvePartnerLoginRedirect(searchParams.get("callbackUrl"));

  if (partnerRedirect) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <StaffOrPartnerLogin />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-xl shadow-lg border border-gray-100">
        <div>
          <div className="flex justify-center">
            <span className="text-4xl">🔐</span>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Resell Lausanne
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Please enter your password to continue
          </p>
          <p className="mt-3 text-center text-sm text-gray-600">
            <Link href="/partners/login" className="font-medium text-blue-600 hover:text-blue-500">
              Partner portal (suppliers) →
            </Link>
          </p>
        </div>

        <Suspense fallback={
          <div className="flex justify-center p-8">
            <div className="animate-pulse text-gray-400">Loading auth...</div>
          </div>
        }>
          <StaffOrPartnerLogin />
        </Suspense>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="animate-pulse text-gray-400">Loading…</div>
      </div>
    }>
      <LoginPageShell />
    </Suspense>
  );
}
