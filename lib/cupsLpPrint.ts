import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export type LpJobResult = {
  ok: boolean;
  skipped?: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
  message?: string;
};

export function resolvePrintEnvFlag(value: string | undefined | null): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Send a PDF (or other lp-supported file) to a named CUPS queue (`lp -d <queue>`).
 * Use `lpstat -p` or macOS Printers & Scanners to copy the exact queue name.
 */
export async function submitLpJob(options: {
  filePath: string;
  printerName: string;
  media?: string;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  printCommand?: string;
}): Promise<LpJobResult> {
  const printerName = String(options.printerName ?? "").trim();
  if (!printerName) {
    return { ok: false, skipped: true, message: "No printer name" };
  }

  const media = String(options.media ?? "A4").trim();
  const scaleRaw = Number(options.scale ?? 100);
  const scale = Number.isFinite(scaleRaw) ? Math.max(10, Math.min(200, scaleRaw)) : 100;
  const offsetX = Number(options.offsetX ?? 0);
  const offsetY = Number(options.offsetY ?? 0);
  const printCommand = String(options.printCommand ?? process.env.SWISS_POST_PRINT_COMMAND ?? "lp").trim() || "lp";

  const args = ["-d", printerName, "-o", "fit-to-page", "-o", `media=${media}`];
  if (scale !== 100) {
    args.push("-o", `scaling=${scale}`);
  }
  if (Number.isFinite(offsetX) && offsetX !== 0) {
    args.push("-o", `page-left=${offsetX}`);
  }
  if (Number.isFinite(offsetY) && offsetY !== 0) {
    args.push("-o", `page-top=${offsetY}`);
  }
  args.push(options.filePath);

  const run = async (command: string) => {
    const { stdout, stderr } = await execFile(command, args);
    return { ok: true, stdout: stdout?.trim(), stderr: stderr?.trim() } as LpJobResult;
  };

  try {
    return await run(printCommand);
  } catch (error: any) {
    const message = error?.message || String(error);
    const code = error?.code || "";
    if ((code === "ENOENT" || /ENOENT/i.test(message)) && printCommand === "lp") {
      try {
        return await run("/usr/bin/lp");
      } catch (e2: any) {
        const m2 = e2?.message ?? String(e2);
        const c2 = e2?.code ?? "";
        if (c2 === "ENOENT" || /ENOENT/i.test(m2)) {
          return {
            ok: true,
            skipped: true,
            message: `No lp on this host (normal on a VPS). Set DECATHLON_PACKING_SLIP_AUTO_PRINT=0 or install cups-client for network print.`,
          };
        }
        return { ok: false, error: m2 };
      }
    }
    if (code === "ENOENT" || /ENOENT/i.test(message)) {
      return {
        ok: true,
        skipped: true,
        message: `No ${printCommand} on this host (normal on a VPS). PDF is still saved — print from your Mac or set DECATHLON_PACKING_SLIP_AUTO_PRINT=0 here. To print on Linux: apt install cups-client and configure a network printer, or set SWISS_POST_PRINT_COMMAND.`,
      };
    }
    return { ok: false, error: message };
  }
}
