import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { nextScraperProxyUrl } from "@/app/lib/scraperProxy";

const execFileAsync = promisify(execFile);

export const AUBONNE_STORE_ID = "0cd42013-bbcc-4ac8-b984-437ed463ece6";

const LETTER_RE = "^[A-Za-z]{2}[0-9]{4}-[0-9]{3}$";
const NUMERIC_RE = "^[0-9]{6}-[0-9]{3}$";

export type ScanLane = "letter" | "numeric";

type NikeRow = {
  gtin: string;
  level: string;
  modificationDate?: string;
  method?: string;
};

export async function loadStyleCodes(prisma: PrismaClient, lane: ScanLane): Promise<string[]> {
  const pattern = lane === "letter" ? LETTER_RE : NUMERIC_RE;
  const rows = await prisma.$queryRawUnsafe<{ style: string }[]>(
    `
    SELECT DISTINCT upper(code) AS style
    FROM (
      SELECT (regexp_matches("supplierSku", $1, 'g'))[1] AS code
      FROM "SupplierVariant"
      WHERE "supplierSku" ~ $1
      UNION
      SELECT "styleId" AS code
      FROM "KickDBProduct"
      WHERE brand IN ('Nike', 'Jordan')
        AND "styleId" ~ $2
    ) s
    WHERE code IS NOT NULL AND code <> ''
    ORDER BY 1
    `,
    lane === "letter" ? "([A-Za-z]{2}[0-9]{4}-[0-9]{3})" : "([0-9]{6}-[0-9]{3})",
    pattern
  );
  return rows.map((r) => String(r.style || "").toUpperCase()).filter(Boolean);
}

export async function loadStyleMeta(
  prisma: PrismaClient,
  styles: string[]
): Promise<Map<string, { name: string | null; imageUrl: string | null }>> {
  const out = new Map<string, { name: string | null; imageUrl: string | null }>();
  const chunk = 1500;
  for (let i = 0; i < styles.length; i += chunk) {
    const slice = styles.slice(i, i + chunk);
    const rows = await prisma.$queryRawUnsafe<{ style: string; name: string | null; image: string | null }[]>(
      `
      SELECT upper("styleId") AS style,
             max(name) AS name,
             max("imageUrl") AS image
      FROM "KickDBProduct"
      WHERE upper("styleId") = ANY($1::text[])
      GROUP BY 1
      `,
      slice
    );
    for (const row of rows) {
      out.set(row.style, { name: row.name, imageUrl: row.image });
    }
  }
  return out;
}

async function sizesForGtins(prisma: PrismaClient, gtins: string[]): Promise<Map<string, string>> {
  if (!gtins.length) return new Map();
  const rows = await prisma.$queryRawUnsafe<{ gtin: string; size: string | null }[]>(
    `
    SELECT gtin, max("sizeEu") AS size
    FROM "KickDBVariant"
    WHERE gtin = ANY($1::text[])
    GROUP BY 1
    `,
    gtins
  );
  return new Map(rows.filter((r) => r.size).map((r) => [r.gtin, r.size as string]));
}

async function nikeGet(url: string): Promise<{ status: number; body: string }> {
  const proxy = nextScraperProxyUrl();
  const args = [
    "-s",
    "--max-time",
    "30",
    "-A",
    "Mozilla/5.0",
    "-H",
    "Origin: https://www.nike.com",
    "-H",
    "Referer: https://www.nike.com/",
    "-w",
    "\n%{http_code}",
  ];
  if (proxy) args.push("--proxy", proxy);
  args.push(url);
  try {
    const { stdout } = await execFileAsync("curl", args, { maxBuffer: 2 * 1024 * 1024, encoding: "utf8" });
    const text = String(stdout || "");
    const nl = text.lastIndexOf("\n");
    if (nl < 0) return { status: 0, body: "" };
    return { status: Number(text.slice(nl + 1).trim()) || 0, body: text.slice(0, nl) };
  } catch {
    return { status: 0, body: "" };
  }
}

export async function checkStyle(
  prisma: PrismaClient,
  styleColor: string,
  meta: { name: string | null; imageUrl: string | null } | undefined
): Promise<"hit" | "miss" | "error"> {
  const url =
    `https://api.nike.com/deliver/available_gtins/v3?filter=styleColor(${encodeURIComponent(styleColor)})` +
    `&filter=storeId(${AUBONNE_STORE_ID})&filter=method(INSTORE)`;
  let status = 0;
  let body = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await nikeGet(url);
    status = res.status;
    body = res.body;
    if (status === 200 || status === 404) break;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  if (status === 404) {
    await prisma.aubonneStoreStock.deleteMany({ where: { styleColor } });
    return "miss";
  }
  if (status !== 200) return "error";
  let objects: NikeRow[] = [];
  try {
    objects = (JSON.parse(body).objects || []) as NikeRow[];
  } catch {
    return "error";
  }
  const instore = objects.filter((o) => o.gtin && (!o.method || o.method === "INSTORE"));
  if (!instore.length) {
    await prisma.aubonneStoreStock.deleteMany({ where: { styleColor } });
    return "miss";
  }
  const sizes = await sizesForGtins(
    prisma,
    instore.map((o) => o.gtin)
  );
  const now = new Date();
  await prisma.$transaction([
    prisma.aubonneStoreStock.deleteMany({ where: { styleColor } }),
    prisma.aubonneStoreStock.createMany({
      data: instore.map((o) => ({
        styleColor,
        gtin: o.gtin,
        level: o.level || "OOS",
        nikeModifiedAt: (() => {
          if (!o.modificationDate) return null;
          const d = new Date(o.modificationDate);
          return Number.isNaN(d.getTime()) ? null : d;
        })(),
        name: meta?.name ?? null,
        imageUrl: meta?.imageUrl ?? null,
        sizeEu: sizes.get(o.gtin) ?? null,
        lastCheckedAt: now,
      })),
    }),
  ]);
  return instore.some((o) => o.level && o.level !== "OOS") ? "hit" : "miss";
}
