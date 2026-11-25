"use client";

import { useRef, useState } from "react";

type Msg = { role: "user" | "agent"; text: string };

export default function SavPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const session = useRef(
    (() => {
      if (typeof window === "undefined") return "";
      let id = window.localStorage.getItem("sav_session");
      if (!id) {
        id = "crypto" in window && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
        window.localStorage.setItem("sav_session", id);
      }
      return id;
    })()
  );

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: q }, { role: "agent", text: "" }]);
    try {
      const res = await fetch("/api/sav/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.current, question: q }),
      });
      if (!res.body) throw new Error("no body");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        setMsgs((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "agent", text: copy[copy.length - 1].text + chunk };
          return copy;
        });
      }
    } catch {
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "agent", text: "Erreur, réessaie." };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Assistant SAV</h1>
      <p className="text-sm text-gray-500">
        Pose une question : n° de commande, email client, « pourquoi pas expédiée », « où est la paire »…
      </p>
      <div className="flex flex-1 flex-col gap-3">
        {msgs.map((m, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap rounded-lg p-3 text-sm ${
              m.role === "user" ? "self-end bg-blue-600 text-white" : "self-start bg-gray-100 text-gray-900"
            }`}
          >
            {m.text || (busy && i === msgs.length - 1 ? "Je cherche…" : "")}
          </div>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ex : #12345 pourquoi pas expédiée ?"
          className="flex-1 rounded border px-3 py-2 text-sm"
          disabled={busy}
        />
        <button disabled={busy} className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50">
          Envoyer
        </button>
      </form>
    </div>
  );
}
