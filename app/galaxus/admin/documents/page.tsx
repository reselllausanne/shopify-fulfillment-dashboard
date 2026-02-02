"use client";

import { useState } from "react";
import { getJson, postJson } from "@/app/lib/api";

type DocumentRow = {
  id: string;
  type: string;
  version: number;
  createdAt: string;
  storageUrl: string;
};

export default function GalaxusDocumentsPage() {
  const [orderId, setOrderId] = useState("");
  const [galaxusOrderId, setGalaxusOrderId] = useState("");
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [status, setStatus] = useState<string>("");

  const handleSeed = async (lineCount: number) => {
    setStatus(`Seeding mock order (${lineCount} lines)...`);
    const res = await postJson<{ orderId: string; galaxusOrderId: string }>("/api/galaxus/seed", {
      lineCount,
    });
    if (!res.ok) {
      setStatus("Failed to seed order.");
      return;
    }
    setOrderId(res.data.orderId);
    setGalaxusOrderId(res.data.galaxusOrderId);
    setStatus(`Seeded order ${res.data.galaxusOrderId}`);
  };

  const handleGenerate = async () => {
    if (!orderId) {
      setStatus("Order ID is required.");
      return;
    }
    setStatus("Generating documents...");
    const res = await postJson<{ documents: DocumentRow[] }>("/api/galaxus/documents", { orderId });
    if (!res.ok) {
      setStatus("Failed to generate documents.");
      return;
    }
    setDocuments(res.data.documents ?? []);
    setStatus("Documents generated.");
  };

  const handleLoadDocs = async () => {
    if (!orderId) {
      setStatus("Order ID is required.");
      return;
    }
    setStatus("Loading documents...");
    const res = await getJson<{ documents: DocumentRow[] }>(`/api/galaxus/documents?orderId=${orderId}`);
    if (!res.ok) {
      setStatus("Failed to load documents.");
      return;
    }
    setDocuments(res.data.documents ?? []);
    setStatus("Documents loaded.");
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">Galaxus Documents</h1>
          <span className="text-sm text-gray-500">{status}</span>
        </div>

        <div className="rounded-lg bg-white p-4 shadow-sm space-y-4">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => handleSeed(5)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
            >
              Seed 5-line order
            </button>
            <button
              onClick={() => handleSeed(120)}
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
            >
              Seed mock order (120 lines)
            </button>
            <button
              onClick={handleGenerate}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
            >
              Generate documents
            </button>
            <button
              onClick={handleLoadDocs}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
            >
              Load documents
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Internal orderId
              <input
                value={orderId}
                onChange={(event) => setOrderId(event.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="UUID"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-gray-700">
              Galaxus order id (seed output)
              <input
                value={galaxusOrderId}
                onChange={(event) => setGalaxusOrderId(event.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="GX-..."
              />
            </label>
          </div>
        </div>

        <div className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Documents</h2>
          {documents.length === 0 ? (
            <p className="text-sm text-gray-500">No documents yet.</p>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2"
                >
                  <div className="text-sm text-gray-700">
                    <strong>{doc.type}</strong> v{doc.version} ·{" "}
                    {new Date(doc.createdAt).toLocaleString("de-CH")}
                  </div>
                  <a
                    className="text-sm font-medium text-blue-600 hover:underline"
                    href={`/api/galaxus/documents/${doc.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download PDF
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
