import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultPrintStationConfig,
  PRINT_STATION_STORAGE_KEY,
  STATION_TEST_LABEL_PDF_BASE64,
} from "@/lib/printStation";

function installMinimalBrowserGlobals() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
  const documentStub = {
    head: {
      appendChild: (el: any) => {
        // Fail script load immediately so ensureQzScriptLoaded resolves.
        queueMicrotask(() => {
          if (typeof el.onerror === "function") el.onerror();
        });
        return el;
      },
    },
    querySelector: () => null,
    createElement: () => {
      const el: any = {
        src: "",
        async: false,
        dataset: {} as Record<string, string>,
        onload: null as null | (() => void),
        onerror: null as null | (() => void),
        addEventListener: (type: string, fn: () => void) => {
          if (type === "error") el.onerror = fn;
          if (type === "load") el.onload = fn;
        },
      };
      return el;
    },
  };
  (globalThis as any).window = {
    localStorage,
    qz: undefined,
    document: documentStub,
  };
  (globalThis as any).document = documentStub;
  (globalThis as any).fetch = vi.fn(async () => ({
    ok: false,
    json: async () => ({ ok: false }),
  }));
  return { store, localStorage };
}

describe("printStationClient presentExistingLabel", () => {
  beforeEach(() => {
    vi.resetModules();
    installMinimalBrowserGlobals();
  });

  it("QZ absent → opens browser PDF (no fulfill side effects)", async () => {
    const openBrowserPrint = vi.fn(() => true);
    window.localStorage.setItem(
      PRINT_STATION_STORAGE_KEY,
      JSON.stringify(
        defaultPrintStationConfig({
          printerName: "Brother",
          autoPrintEnabled: true,
          silentPrintValidated: true,
        })
      )
    );

    const { presentExistingLabel } = await import("@/app/lib/printStationClient");
    const result = await presentExistingLabel({
      label: {
        base64: STATION_TEST_LABEL_PDF_BASE64,
        mimeType: "application/pdf",
        createdAt: new Date().toISOString(),
      },
      openBrowserPrint,
    });

    expect(openBrowserPrint).toHaveBeenCalledTimes(1);
    expect(result.usedBrowserFallback).toBe(true);
    expect(result.usedSilent).toBe(false);
    expect(result.events).toContain("LABEL_CREATED");
    expect(result.events).toContain("BROWSER_PRINT_OPENED");
  });

  it("QZ connected but printer missing → browser fallback", async () => {
    const openBrowserPrint = vi.fn(() => true);
    (window as any).qz = {
      websocket: {
        connect: async () => undefined,
        isActive: () => true,
      },
      printers: { find: async () => ["OtherPrinter"] },
      configs: { create: () => ({}) },
      print: vi.fn(),
      security: {
        setCertificatePromise: () => undefined,
        setSignaturePromise: () => undefined,
      },
    };
    const { presentExistingLabel } = await import("@/app/lib/printStationClient");
    const result = await presentExistingLabel({
      label: {
        base64: STATION_TEST_LABEL_PDF_BASE64,
        mimeType: "application/pdf",
        createdAt: new Date().toISOString(),
      },
      config: defaultPrintStationConfig({
        printerName: "Brother_QL_W810W",
        autoPrintEnabled: true,
        silentPrintValidated: true,
      }),
      openBrowserPrint,
    });
    expect(openBrowserPrint).toHaveBeenCalledTimes(1);
    expect(result.usedSilent).toBe(false);
    expect(result.events).toContain("BROWSER_PRINT_OPENED");
  });

  it("silent QZ error → SILENT_PRINT_FAILED_FALLBACK_OPENED with same bytes", async () => {
    const openBrowserPrint = vi.fn(() => true);
    const print = vi.fn(async () => {
      throw new Error("timeout");
    });
    (window as any).qz = {
      websocket: {
        connect: async () => undefined,
        isActive: () => true,
      },
      printers: { find: async () => ["Brother_QL_W810W"] },
      configs: { create: () => ({}) },
      print,
      security: {
        setCertificatePromise: () => undefined,
        setSignaturePromise: () => undefined,
      },
    };

    const config = defaultPrintStationConfig({
      printerName: "Brother_QL_W810W",
      autoPrintEnabled: true,
      silentPrintValidated: true,
    });
    const { presentExistingLabel } = await import("@/app/lib/printStationClient");
    const label = {
      base64: STATION_TEST_LABEL_PDF_BASE64,
      mimeType: "application/pdf",
      createdAt: new Date().toISOString(),
      awb: "AWB-9",
    };
    const result = await presentExistingLabel({
      label,
      config,
      openBrowserPrint,
    });

    expect(print).toHaveBeenCalledTimes(1);
    expect(openBrowserPrint).toHaveBeenCalledWith(label);
    expect(result.events).toContain("SILENT_PRINT_FAILED_FALLBACK_OPENED");
    expect(result.usedBrowserFallback).toBe(true);
  });

  it("reprint uses the same existing label bytes", async () => {
    const openBrowserPrint = vi.fn(() => true);
    const { presentExistingLabel } = await import("@/app/lib/printStationClient");
    const label = {
      base64: STATION_TEST_LABEL_PDF_BASE64,
      mimeType: "application/pdf",
      createdAt: new Date().toISOString(),
      labelId: "lbl-1",
    };
    const result = await presentExistingLabel({
      label,
      isReprint: true,
      openBrowserPrint,
      config: defaultPrintStationConfig({ autoPrintEnabled: false }),
    });
    expect(result.events).toContain("REPRINT_EXISTING_LABEL");
    expect(result.events).not.toContain("LABEL_CREATED");
    expect(openBrowserPrint.mock.calls[0][0].labelId).toBe("lbl-1");
    expect(openBrowserPrint.mock.calls[0][0].base64).toBe(label.base64);
  });
});

describe("printStationTestLabel local-only", () => {
  beforeEach(() => {
    vi.resetModules();
    installMinimalBrowserGlobals();
  });

  it("test print emits TEST_PRINT_ONLY and never needs fulfill APIs", async () => {
    const print = vi.fn(async () => undefined);
    (window as any).qz = {
      websocket: {
        connect: async () => undefined,
        isActive: () => true,
      },
      printers: { find: async () => ["Generic_Thermal"] },
      configs: { create: () => ({}) },
      print,
      security: {
        setCertificatePromise: () => undefined,
        setSignaturePromise: () => undefined,
      },
    };
    const { printStationTestLabel } = await import("@/app/lib/printStationClient");
    const result = await printStationTestLabel(
      defaultPrintStationConfig({ printerName: "Generic_Thermal" })
    );
    expect(result.event).toBe("TEST_PRINT_ONLY");
    expect(result.ok).toBe(true);
    expect(print).toHaveBeenCalledTimes(1);
  });
});
