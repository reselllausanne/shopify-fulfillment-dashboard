"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PartnerGtinInboxPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/partners/dashboard");
  }, [router]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
      Redirecting to the dashboard…
    </div>
  );
}
