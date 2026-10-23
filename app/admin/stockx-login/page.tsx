"use client";

import { useCallback, useEffect, useState } from "react";

const VNC_URL =
  "/stockx-vnc/vnc.html?autoconnect=1&resize=scale&reconnect=1&password=1234&path=stockx-vnc/websockify";

type LoginStatus = {
  login: {
    running: boolean;
    startedAt: string | null;
    finishedAt: string | null;
    ok: boolean | null;
    error: string | null;
    profileReset: boolean;
    blockedBy?: string | null;
  };
  hasProfile: boolean;
  token: { source: string; expiresAt: string | null } | null;
  otherAccountRunning: boolean;
  otherAccountLabel: string | null;
};

function formatRemaining(expiresAt: string | null): string {
  if (!expiresAt) return "unknown";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
}

type Account = "default" | "galaxus";

const ACCOUNT_LABELS: Record<Account, string> = {
  default: "Shopify (resell)",
  galaxus: "Galaxus (contact@)",
};

export default function StockxLoginPage() {
  const [account, setAccount] = useState<Account>("default");
  const [status, setStatus] = useState<LoginStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showScreen, setShowScreen] = useState(false);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("account");
    if (fromUrl === "galaxus") setAccount("galaxus");
  }, []);

  const selectAccount = (next: Account) => {
    setAccount(next);
    setStatus(null);
    setMessage(null);
    const url = new URL(window.location.href);
    url.searchParams.set("account", next);
    window.history.replaceState(null, "", url.toString());
  };

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/stockx-login?account=${account}`);
      const data = await res.json();
      if (data?.ok) {
        setStatus({
          login: data.login,
          hasProfile: data.hasProfile,
          token: data.token,
          otherAccountRunning: Boolean(data.otherAccountRunning),
          otherAccountLabel: data.otherAccountLabel ?? null,
        });
      }
    } catch {
      // keep last known status
    }
  }, [account]);

  useEffect(() => {
    void loadStatus();
    const timer = setInterval(loadStatus, 5000);
    return () => clearInterval(timer);
  }, [loadStatus]);

  const post = async (body: Record<string, unknown>, note: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/stockx-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, account }),
      });
      const data = await res.json();
      setMessage(data?.ok ? note : `${data?.error ?? "Failed"}`);
      if (data?.ok && body.action !== "refresh" && body.action !== "stop") setShowScreen(true);
      await loadStatus();
    } catch (error: any) {
      setMessage(error?.message || "Network error");
    } finally {
      setBusy(false);
    }
  };

  const token = status?.token;
  const thisRunning = status?.login.running ?? false;
  const otherRunning = status?.otherAccountRunning ?? false;
  const browserBusy = thisRunning || otherRunning;
  const otherLabel = status?.otherAccountLabel ?? "the other account";

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">StockX login</h1>
          <p className="mt-1 text-sm text-gray-600">
            Logs in inside the server browser, so the bearer is stored on the VPS and the hourly AWB
            sync keeps working. Usable from a phone. One VNC screen — one account at a time.
          </p>
        </div>

        <div className="flex gap-2">
          {(Object.keys(ACCOUNT_LABELS) as Account[]).map((key) => (
            <button
              key={key}
              onClick={() => selectAccount(key)}
              className={`rounded px-4 py-2 text-sm ${
                account === key ? "bg-gray-900 text-white" : "border bg-white text-gray-700"
              }`}
            >
              {ACCOUNT_LABELS[key]}
            </button>
          ))}
        </div>

        <div className="rounded-lg border bg-white p-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span>
              Stored token:{" "}
              {token?.expiresAt ? (
                <strong className="text-green-700">
                  {formatRemaining(token.expiresAt)} ({token.source})
                </strong>
              ) : (
                <strong className="text-red-700">none</strong>
              )}
            </span>
            <span>
              Browser profile:{" "}
              <strong className={status?.hasProfile ? "text-green-700" : "text-red-700"}>
                {status?.hasProfile ? "saved" : "missing"}
              </strong>
            </span>
            <span>
              Login browser:{" "}
              <strong>
                {otherRunning
                  ? `busy with ${otherLabel}`
                  : thisRunning
                    ? "running — log in below"
                    : "idle"}
              </strong>
            </span>
          </div>
          {otherRunning && (
            <div className="mt-2 text-xs text-amber-800">
              Shared server display is showing {otherLabel}. Finish that Cloudflare checkbox there,
              or Stop browser / Take over to free the screen for {ACCOUNT_LABELS[account]}.
            </div>
          )}
          {status?.login.error && !browserBusy && (
            <div className="mt-2 text-xs text-red-700">Last attempt: {status.login.error}</div>
          )}
          {message && <div className="mt-2 text-xs text-gray-700">{message}</div>}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => post({ action: "start" }, "Browser started — log in on the screen below.")}
            disabled={busy || browserBusy}
            className="rounded bg-indigo-600 px-4 py-3 text-white disabled:bg-gray-400"
          >
            {thisRunning ? "Login browser running" : "Start login browser"}
          </button>
          {otherRunning && (
            <button
              onClick={() =>
                post(
                  { action: "start", force: true },
                  `Took over from ${otherLabel} — complete Turnstile for ${ACCOUNT_LABELS[account]}.`
                )
              }
              disabled={busy}
              className="rounded bg-amber-600 px-4 py-3 text-white disabled:bg-gray-400"
            >
              Take over for this account
            </button>
          )}
          <button
            onClick={() =>
              post({ action: "stop", all: true }, "Stopped all login browsers. Profiles kept.")
            }
            disabled={busy || !browserBusy}
            className="rounded border border-gray-400 px-4 py-3 text-gray-800 disabled:opacity-50"
          >
            Stop browser
          </button>
          <button
            onClick={() => post({ action: "refresh" }, "Token refreshed from the saved profile.")}
            disabled={busy || browserBusy}
            className="rounded bg-gray-800 px-4 py-3 text-white disabled:bg-gray-400"
          >
            Refresh token now
          </button>
          <button
            onClick={() =>
              post({ action: "start", reset: true }, "Profile wiped — log in from scratch below.")
            }
            disabled={busy || browserBusy}
            className="rounded border border-red-300 px-4 py-3 text-red-700 disabled:opacity-50"
          >
            Reset profile & login
          </button>
          <button
            onClick={() => setShowScreen((value) => !value)}
            className="rounded border px-4 py-3 text-gray-700"
          >
            {showScreen ? "Hide screen" : "Show screen"}
          </button>
        </div>

        {showScreen && (
          <div className="space-y-2">
            <div className="text-xs text-gray-600">
              VNC password is <span className="font-mono">1234</span> (autofilled). On a phone, use
              the noVNC side panel to open the keyboard.{" "}
              <a className="text-indigo-600 underline" href={VNC_URL} target="_blank" rel="noreferrer">
                Open full screen
              </a>
            </div>
            <iframe
              src={VNC_URL}
              title="Server browser"
              className="h-[70vh] w-full rounded-lg border bg-black"
            />
          </div>
        )}

        <div className="rounded-lg border bg-white p-4 text-xs text-gray-600">
          Server has StockX email/password stored. After you pass Cloudflare (and OTP if asked),
          the form auto-fills. Then open <span className="font-mono">buying/orders</span> so the
          bearer is captured. Hourly/6h jobs reuse that session afterward. Do not start both
          accounts at once — Cloudflare + one Chromium profile per account need a free display.
        </div>
      </div>
    </div>
  );
}
