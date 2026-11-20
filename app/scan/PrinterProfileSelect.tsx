"use client";

import { useEffect, useState } from "react";
import {
  deletePrinterProfile,
  loadPrintStationConfig,
  loadPrinterProfiles,
  savePrintStationConfig,
  switchPrinterProfile,
} from "@/app/lib/printStationClient";

type Props = {
  /** Change this value to force a re-read (e.g. after the wizard saved). */
  refreshKey?: unknown;
  /** Called after the active printer changed or a profile was removed. */
  onChanged: () => void;
};

/** Dropdown of printers already set up on this browser. Picking one makes it active. */
export default function PrinterProfileSelect({ refreshKey, onChanged }: Props) {
  const [names, setNames] = useState<string[]>([]);
  const [active, setActive] = useState("");

  const reload = () => {
    const cfg = loadPrintStationConfig();
    // Existing setups predate profiles: remember the active printer once.
    if (cfg.printerName && !loadPrinterProfiles()[cfg.printerName]) {
      savePrintStationConfig(cfg);
    }
    setNames(Object.keys(loadPrinterProfiles()).sort());
    setActive(cfg.printerName || "");
  };

  useEffect(reload, [refreshKey]);

  if (names.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-1">
      <select
        className="px-1 py-0.5 text-xs rounded border border-gray-300 bg-white text-gray-800 max-w-[200px]"
        title="Imprimantes déjà configurées sur ce navigateur"
        value={names.includes(active) ? active : ""}
        onChange={(e) => {
          const name = e.target.value;
          if (!name) return;
          if (switchPrinterProfile(name)) {
            reload();
            onChanged();
          }
        }}
      >
        {!names.includes(active) ? <option value="">Imprimante…</option> : null}
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      {names.includes(active) ? (
        <button
          type="button"
          title="Oublier cette imprimante"
          className="px-1 text-xs text-gray-500 hover:text-red-700"
          onClick={() => {
            if (!window.confirm(`Retirer « ${active} » de la liste ?`)) return;
            deletePrinterProfile(active);
            reload();
            onChanged();
          }}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
