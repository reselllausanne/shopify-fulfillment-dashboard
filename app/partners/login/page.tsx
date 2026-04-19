import { Suspense } from "react";
import Link from "next/link";
import { PartnerLoginForm } from "./PartnerLoginForm";

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
