import { prisma } from "@/app/lib/prisma";
import { verifyTrackingToken } from "@/app/lib/trackingToken";
import { detectMilestone } from "@/app/lib/stockxStatus";
import { StockXState } from "@/app/lib/stockxTracking";

type Params = {
  params: { token: string };
};

export const dynamic = "force-dynamic";

export default async function TrackingPage({ params }: Params) {
  const tokenPayload = verifyTrackingToken(params.token);
  if (!tokenPayload) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-700">Lien invalide ou expiré.</p>
      </div>
    );
  }

  const match = await prisma.orderMatch.findUnique({
    where: { id: tokenPayload.orderMatchId },
  });

  if (!match) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-700">Commande introuvable.</p>
      </div>
    );
  }

  const states = (match.stockxStates as StockXState[]) || [];
  const milestone = detectMilestone(match.stockxCheckoutType, states);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto bg-white shadow rounded-lg p-6 space-y-4">
        <h1 className="text-2xl font-semibold text-gray-900">Suivi StockX</h1>
        <p className="text-sm text-gray-600">Commande {match.shopifyOrderName}</p>
        <div className="bg-gray-100 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Étape actuelle</p>
          <p className="text-lg font-semibold text-gray-900">{milestone?.title || "En attente"}</p>
          <p className="text-sm text-gray-700">{milestone?.description}</p>
        </div>
        <div className="space-y-3">
          {states.map((state, index) => (
            <div key={`${state.title}-${index}`} className="border rounded-lg p-3">
              <div className="flex justify-between">
                <h3 className="text-sm font-semibold text-gray-900">{state.title}</h3>
                <span className="text-xs text-gray-500">{state.progress || state.status}</span>
              </div>
              <p className="text-xs text-gray-700">{state.subtitle}</p>
            </div>
          ))}
        </div>
        <div className="border-t pt-3 space-y-1">
          <p className="text-xs text-gray-500">DHL / StockX Tracking</p>
          <p className="text-sm text-gray-900">{match.stockxTrackingUrl || "Non disponible"}</p>
          <p className="text-xs text-gray-500">AWB</p>
          <p className="text-sm text-gray-900">{match.stockxAwb || "N/A"}</p>
        </div>
        <div className="text-xs text-gray-500">
          Cette page est mise à jour automatiquement dès que l’état StockX change.
        </div>
      </div>
    </div>
  );
}

