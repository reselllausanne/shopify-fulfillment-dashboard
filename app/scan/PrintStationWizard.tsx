"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LABEL_PRESETS,
  QZ_TRAY_DOWNLOAD_URL,
  defaultPrintStationConfig,
  newStationId,
  type PrintStationConfig,
} from "@/lib/printStation";
import {
  ensureQzConnected,
  ensureQzScriptLoaded,
  listQzPrinters,
  loadPrintStationConfig,
  printStationTestLabel,
  probePrintStationStatus,
  savePrintStationConfig,
  type PrintStationProbeStatus,
} from "@/app/lib/printStationClient";

type WizardStep =
  | "name"
  | "qz"
  | "printer"
  | "format"
  | "test"
  | "confirm"
  | "done";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (config: PrintStationConfig, status: PrintStationProbeStatus) => void;
};

export default function PrintStationWizard({ open, onClose, onSaved }: Props) {
  const existing = useMemo(() => loadPrintStationConfig(), [open]);
  const [step, setStep] = useState<WizardStep>("name");
  const [draft, setDraft] = useState<PrintStationConfig>(() =>
    defaultPrintStationConfig({
      ...existing,
      stationId: existing.stationId || newStationId(),
    })
  );
  const [printers, setPrinters] = useState<string[]>([]);
  const [qzConnected, setQzConnected] = useState(false);
  const [qzInstalled, setQzInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);
  const [presetId, setPresetId] = useState<string>("62x100");

  useEffect(() => {
    if (!open) return;
    setStep("name");
    setMessage(null);
    setTestOk(false);
    const cfg = loadPrintStationConfig();
    setDraft(
      defaultPrintStationConfig({
        ...cfg,
        stationId: cfg.stationId || newStationId(),
      })
    );
    void refreshQz();
  }, [open]);

  const refreshQz = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const loaded = await ensureQzScriptLoaded();
      setQzInstalled(loaded);
      if (!loaded) {
        setQzConnected(false);
        setPrinters([]);
        return;
      }
      const connected = await ensureQzConnected();
      setQzConnected(connected);
      if (connected) {
        const list = await listQzPrinters();
        setPrinters(list);
      } else {
        setPrinters([]);
      }
    } catch (err: any) {
      setMessage(err?.message || "QZ check failed");
      setQzConnected(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const applyPreset = (id: string) => {
    setPresetId(id);
    const preset = LABEL_PRESETS.find((p) => p.id === id);
    if (!preset || preset.id === "custom") return;
    setDraft((d) =>
      defaultPrintStationConfig({
        ...d,
        labelWidthMm: preset.widthMm,
        labelHeightMm: preset.heightMm,
        continuousLabel: preset.continuous,
        dpi: preset.dpi ?? d.dpi,
      })
    );
  };

  const runTestPrint = async () => {
    setBusy(true);
    setMessage(null);
    setTestOk(false);
    try {
      const result = await printStationTestLabel(draft);
      if (!result.ok) {
        setMessage(result.error || "Test print failed");
        return;
      }
      setMessage("Test envoyé à l’imprimante. Vérifiez le papier.");
      setStep("confirm");
    } catch (err: any) {
      setMessage(err?.message || "Test print failed");
    } finally {
      setBusy(false);
    }
  };

  const confirmAndSave = async (validated: boolean) => {
    const next = defaultPrintStationConfig({
      ...draft,
      autoPrintEnabled: validated ? true : draft.autoPrintEnabled,
      autoPrintOnCertainMatch: validated ? true : draft.autoPrintOnCertainMatch,
      silentPrintValidated: validated,
      silentPrintValidatedAt: validated ? new Date().toISOString() : null,
    });
    savePrintStationConfig(next);
    const status = await probePrintStationStatus(next, { connect: true });
    onSaved(next, status);
    setDraft(next);
    setTestOk(validated);
    setStep("done");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-gray-200">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900">Configurer ce poste</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            Fermer
          </button>
        </div>

        <div className="px-4 py-4 space-y-4 text-sm text-gray-800">
          {step === "name" && (
            <div className="space-y-3">
              <p>Donnez un nom à ce Mac / poste d’emballage.</p>
              <input
                className="w-full rounded border border-gray-300 px-3 py-2"
                placeholder="ex. Theo - maison"
                value={draft.stationName}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, stationName: e.target.value }))
                }
              />
              <button
                type="button"
                disabled={!draft.stationName.trim()}
                onClick={() => setStep("qz")}
                className="w-full rounded bg-gray-900 text-white py-2 disabled:opacity-40"
              >
                Continuer
              </button>
            </div>
          )}

          {step === "qz" && (
            <div className="space-y-3">
              <p>
                QZ Tray relie ce navigateur à votre imprimante locale. Installation
                unique par Mac — aucune commande Terminal ni config VPS.
              </p>
              <div
                className={
                  "rounded border px-3 py-2 " +
                  (qzConnected
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : "border-amber-300 bg-amber-50 text-amber-950")
                }
              >
                {qzConnected
                  ? "QZ Tray connecté"
                  : qzInstalled
                    ? "QZ Tray détecté mais non connecté"
                    : "QZ Tray non détecté"}
              </div>
              <a
                href={QZ_TRAY_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full justify-center rounded border border-blue-300 bg-blue-50 px-3 py-2 text-blue-900 hover:bg-blue-100"
              >
                Installer QZ Tray
              </a>
              <a
                href="/api/qz/override.crt"
                download="override.crt"
                className="inline-flex w-full justify-center rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 hover:bg-amber-100"
              >
                Télécharger override.crt (ce poste)
              </a>
              <p className="text-xs text-gray-500">
                Après téléchargement : quitter QZ Tray, coller le fichier dans{" "}
                <code className="text-[10px]">QZ Tray.app/Contents/Resources/</code> (Mac) ou{" "}
                <code className="text-[10px]">C:\Program Files\QZ Tray\</code> (Windows),
                puis relancer QZ. Pas besoin d’accès serveur.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void refreshQz()}
                className="w-full rounded bg-gray-900 text-white py-2 disabled:opacity-40"
              >
                {busy ? "Vérification…" : "Reconnecter / Vérifier QZ"}
              </button>
              <button
                type="button"
                disabled={!qzConnected}
                onClick={() => setStep("printer")}
                className="w-full rounded bg-emerald-700 text-white py-2 disabled:opacity-40"
              >
                Continuer
              </button>
            </div>
          )}

          {step === "printer" && (
            <div className="space-y-3">
              <p>Choisissez l’imprimante locale de ce poste.</p>
              {printers.length === 0 ? (
                <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  Aucune imprimante trouvée. Allumez l’imprimante, puis
                  Reconnecter / Vérifier QZ.
                </p>
              ) : (
                <select
                  className="w-full rounded border border-gray-300 px-3 py-2"
                  value={draft.printerName}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, printerName: e.target.value }))
                  }
                >
                  <option value="">— choisir —</option>
                  {printers.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void refreshQz()}
                className="w-full rounded border border-gray-300 py-2"
              >
                Rafraîchir la liste
              </button>
              <button
                type="button"
                disabled={!draft.printerName}
                onClick={() => setStep("format")}
                className="w-full rounded bg-gray-900 text-white py-2 disabled:opacity-40"
              >
                Continuer
              </button>
            </div>
          )}

          {step === "format" && (
            <div className="space-y-3">
              <p>
                Format papier de <strong>ce</strong> poste (Brother ≠ thermique
                générique). Le PDF métier reste le même ; seule la taille
                d’impression change.
              </p>
              <select
                className="w-full rounded border border-gray-300 px-3 py-2"
                value={presetId}
                onChange={(e) => applyPreset(e.target.value)}
              >
                {LABEL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  Largeur (mm)
                  <input
                    type="number"
                    min={10}
                    max={200}
                    className="mt-1 w-full rounded border px-2 py-1"
                    value={draft.labelWidthMm}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        labelWidthMm: Number(e.target.value) || d.labelWidthMm,
                      }))
                    }
                  />
                </label>
                <label className="block">
                  Hauteur / coupe (mm)
                  <input
                    type="number"
                    min={10}
                    max={400}
                    className="mt-1 w-full rounded border px-2 py-1"
                    value={draft.labelHeightMm}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        labelHeightMm: Number(e.target.value) || d.labelHeightMm,
                      }))
                    }
                  />
                </label>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.continuousLabel}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, continuousLabel: e.target.checked }))
                  }
                />
                Rouleau continu (hauteur = longueur de coupe)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.useDriverPaperSize}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      useDriverPaperSize: e.target.checked,
                    }))
                  }
                />
                <span>
                  <strong>Recommandé :</strong> format papier du driver Windows/Mac
                  (ignorer mm pour QZ). Décoche seulement si le driver imprime mal.
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.scaleContent}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, scaleContent: e.target.checked }))
                  }
                />
                Forcer scale PDF → taille (souvent casse les thermiques — laisse OFF)
              </label>
              <label className="block">
                Orientation
                <select
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={draft.orientation}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      orientation:
                        e.target.value === "landscape" ? "landscape" : "portrait",
                    }))
                  }
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Paysage</option>
                </select>
              </label>
              <label className="block">
                DPI (info / override avancé — converti automatiquement)
                <input
                  type="number"
                  className="mt-1 w-full rounded border px-2 py-1"
                  placeholder="vide = driver (recommandé)"
                  value={draft.dpi ?? ""}
                  disabled={draft.useDriverPaperSize}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setDraft((d) => ({
                      ...d,
                      dpi: v ? Number(v) : null,
                    }));
                  }}
                />
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    ["Haut", "marginTopMm"],
                    ["Droite", "marginRightMm"],
                    ["Bas", "marginBottomMm"],
                    ["Gauche", "marginLeftMm"],
                  ] as const
                ).map(([label, key]) => (
                  <label key={key} className="block text-xs">
                    {label} mm
                    <input
                      type="number"
                      className="mt-1 w-full rounded border px-1 py-1"
                      value={draft[key]}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [key]: Number(e.target.value) || 0,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setStep("test")}
                className="w-full rounded bg-gray-900 text-white py-2"
              >
                Continuer
              </button>
            </div>
          )}

          {step === "test" && (
            <div className="space-y-3">
              <p>
                Imprime un label de test local. Aucune commande, aucun Swiss Post,
                aucun Shopify, aucun DELR.
              </p>
              <button
                type="button"
                disabled={busy || !draft.printerName}
                onClick={() => void runTestPrint()}
                className="w-full rounded bg-emerald-700 text-white py-2 disabled:opacity-40"
              >
                {busy ? "Impression…" : "Imprimer un label de test"}
              </button>
              <button
                type="button"
                onClick={() => setStep("format")}
                className="w-full rounded border py-2"
              >
                Retour
              </button>
            </div>
          )}

          {step === "confirm" && (
            <div className="space-y-3">
              <p className="font-medium">Le test est correct ?</p>
              <p className="text-gray-600">
                Seulement après confirmation, l’auto-print sera autorisé sur ce
                poste.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmAndSave(true)}
                className="w-full rounded bg-emerald-700 text-white py-2"
              >
                Oui — activer l’auto-print
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmAndSave(false)}
                className="w-full rounded border border-amber-400 bg-amber-50 py-2 text-amber-950"
              >
                Non — garder le fallback PDF navigateur
              </button>
              <button
                type="button"
                onClick={() => setStep("test")}
                className="w-full rounded border py-2"
              >
                Re-tester
              </button>
            </div>
          )}

          {step === "done" && (
            <div className="space-y-3">
              <p className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
                Poste « {draft.stationName} » enregistré
                {testOk ? " — auto-print validé." : " — auto-print non validé (PDF navigateur)."}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded bg-gray-900 text-white py-2"
              >
                Terminer
              </button>
            </div>
          )}

          {message ? (
            <p className="text-xs text-gray-700 bg-gray-50 border rounded px-2 py-1">
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
