import { NextRequest, NextResponse } from "next/server";

import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { buildFunnelReport } from "@/adsanalytics/commands/funnel";
import { diagnoseCommand } from "@/adsanalytics/commands/diagnose";
import { latestInventorySyncMeta } from "@/adsanalytics/commands/inventorySync";

function parseDays(raw: string | null): number {
  const n = Number(raw ?? 30);
  if (!Number.isFinite(n)) return 30;
  return Math.max(7, Math.min(90, Math.floor(n)));
}

function parseGranularity(raw: string | null): "offer" | "variant" | "model" {
  if (raw === "offer" || raw === "variant" || raw === "model") return raw;
  return "model";
}

function toCsvRows(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (v: unknown) => {
    const str = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
    const escaped = str.replace(/"/g, "\"\"");
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n");
}

export async function GET(req: NextRequest) {
  const role = await getStaffRoleFromRequest(req);
  if (role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const days = parseDays(req.nextUrl.searchParams.get("days"));
  const granularity = parseGranularity(req.nextUrl.searchParams.get("granularity"));
  const tab = req.nextUrl.searchParams.get("tab") ?? "overview";
  const format = req.nextUrl.searchParams.get("format") ?? "json";

  const [funnel, inventoryMeta] = await Promise.all([
    buildFunnelReport({ days, granularity }),
    latestInventorySyncMeta(),
  ]);

  // diagnoseCommand is wrapped with sync-run side effects; avoid from API.
  // Reuse funnel for live dashboard and rely on CLI diagnose for heavy export.
  const payload = {
    ok: true,
    tab,
    days,
    granularity,
    inventoryMeta,
    funnel,
  };

  if (format === "csv") {
    const steps = funnel.current.steps.map((s) => ({
      step: s.step,
      count: s.count,
      pctOfPrevious: s.pctOfPrevious,
      pctOfTotal: s.pctOfTotal,
      spendChf: s.spendChf,
      valueChf: s.valueChf,
      roas: s.roas,
    }));
    return new NextResponse(toCsvRows(steps), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ads-funnel-${days}d-${granularity}.csv"`,
      },
    });
  }

  return NextResponse.json(payload);
}

// keep diagnoseCommand imported for tree-shaken type consistency (read-only DB command)
void diagnoseCommand;
