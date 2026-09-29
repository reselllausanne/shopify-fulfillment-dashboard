import { Prisma } from "@prisma/client";

/**
 * Word-by-word catalog search over SupplierVariant.
 *
 * "2gb ddr3 1333mhz" matches "CSX 2GB DDR3-1333MHz DIMM" and "NONAME 2 GB DDR3 1333 CL9":
 * spaces, dashes, dots and case are ignored, every word must appear in name or SKU.
 *
 * Speed depends on ops/sql/20260929_catalog_search_trgm.sql (GIN trigram index on
 * CATALOG_SEARCH_DOC_SQL). The SQL expression below must stay byte-identical to it.
 */
export const CATALOG_SEARCH_DOC_SQL = Prisma.raw(
  `regexp_replace(lower(coalesce("supplierProductName", '') || '|' || coalesce("supplierSku", '')), '[^a-z0-9|]+', '', 'g')`
);

/** Unit suffixes that shops write inconsistently ("1333MHz" vs "1333"); keep the number only. */
const DROP_UNIT_SUFFIX = /^(\d+)(mhz|mts|mt|ghz|hz)$/;

export function normalizeCatalogSearchText(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function parseCatalogSearchTokens(q: string): string[] {
  const out: string[] = [];
  for (const raw of String(q ?? "").split(/[\s,;+]+/)) {
    let token = normalizeCatalogSearchText(raw);
    if (!token) continue;
    const unit = token.match(DROP_UNIT_SUFFIX);
    if (unit) token = unit[1]!;
    if (!out.includes(token)) out.push(token);
  }
  // Drop tokens fully contained in a longer token ("ddr3" inside "ddr31333").
  return out.filter((t) => !out.some((o) => o !== t && o.includes(t)));
}

/**
 * "2gb" must not match inside "32gb". Only for number+unit words: plain numbers like
 * "1333" are often glued to a model ("DDR3-1333" → "ddr31333") and must still match.
 */
export function needsDigitBoundary(token: string): boolean {
  return /^\d+[a-z]+$/.test(token);
}

export function catalogTokenMatches(doc: string, token: string): boolean {
  if (!needsDigitBoundary(token)) return doc.includes(token);
  return new RegExp(`(^|[^0-9])${token}`).test(doc);
}

/** Trigram index needs at least one 3+ char word, otherwise the name scan is a full table scan. */
export function canUseNameSearch(tokens: string[]): boolean {
  return tokens.some((t) => t.length >= 3);
}

function gtinCandidates(q: string): string[] {
  const digits = q.replace(/\s+/g, "");
  if (!/^\d{8,14}$/.test(digits)) return [];
  const stripped = digits.replace(/^0+/, "");
  const set = new Set([digits, stripped, `0${stripped}`, `00${stripped}`]);
  return [...set].filter(Boolean);
}

export type CatalogSearchFilters = {
  /** Lowercase supplier prefix, e.g. "rei" → rei_… / rei:… / REI_… */
  supplierKey?: string | null;
  lockedOnly?: boolean;
  providerKeys?: string[];
};

export type CatalogSearchOptions = CatalogSearchFilters & {
  limit: number;
  offset?: number;
};

function filterSql(filters: CatalogSearchFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (filters.supplierKey) {
    const key = filters.supplierKey.toLowerCase();
    parts.push(
      Prisma.sql`("supplierVariantId" LIKE ${`${key}\\_%`} OR "supplierVariantId" LIKE ${`${key}:%`} OR "providerKey" LIKE ${`${key.toUpperCase()}\\_%`})`
    );
  }
  if (filters.lockedOnly) parts.push(Prisma.sql`"manualLock" = true`);
  if (filters.providerKeys?.length) {
    parts.push(Prisma.sql`"providerKey" IN (${Prisma.join(filters.providerKeys)})`);
  }
  return parts.length ? Prisma.sql`AND ${Prisma.join(parts, " AND ")}` : Prisma.empty;
}

/**
 * Returns SupplierVariant.id ordered by relevance:
 * exact id/GTIN/SKU hit → in stock → shortest name (closest match) → most recent.
 */
export function buildCatalogSearchSql(q: string, opts: CatalogSearchOptions): Prisma.Sql | null {
  const raw = String(q ?? "").trim();
  if (!raw) return null;
  const tokens = parseCatalogSearchTokens(raw);
  const gtins = gtinCandidates(raw);

  const exactConds: Prisma.Sql[] = [
    Prisma.sql`"supplierVariantId" = ${raw}`,
    Prisma.sql`"providerKey" = ${raw.toUpperCase()}`,
    Prisma.sql`"providerKey" = ${raw}`,
    Prisma.sql`"supplierSku" = ${raw}`,
  ];
  if (gtins.length) exactConds.push(Prisma.sql`gtin IN (${Prisma.join(gtins)})`);
  const exact = Prisma.sql`(${Prisma.join(exactConds, " OR ")})`;

  const filters = filterSql(opts);
  const cols = Prisma.sql`id, stock, "supplierProductName", "updatedAt"`;
  const branches: Prisma.Sql[] = [
    Prisma.sql`SELECT ${cols}, 1 AS exact_hit FROM "SupplierVariant" WHERE ${exact} ${filters}`,
  ];
  if (tokens.length && canUseNameSearch(tokens)) {
    const nameAll = Prisma.join(
      tokens.map((t) =>
        needsDigitBoundary(t)
          ? Prisma.sql`${CATALOG_SEARCH_DOC_SQL} ~ ${`(^|[^0-9])${t}`}`
          : Prisma.sql`${CATALOG_SEARCH_DOC_SQL} LIKE ${`%${t}%`}`
      ),
      " AND "
    );
    // Common words ("air force 1") hit 100k+ StockX size rows; rank a bounded sample.
    branches.push(
      Prisma.sql`(SELECT ${cols}, 0 AS exact_hit FROM "SupplierVariant" WHERE ${nameAll} ${filters} LIMIT ${NAME_MATCH_CAP})`
    );
  }

  return Prisma.sql`
    SELECT id FROM (
      SELECT DISTINCT ON (id) * FROM (${Prisma.join(branches, " UNION ALL ")}) u
      ORDER BY id, exact_hit DESC
    ) m
    ORDER BY exact_hit DESC,
             (coalesce(stock, 0) > 0) DESC,
             length(coalesce("supplierProductName", '')) ASC,
             "updatedAt" DESC
    LIMIT ${opts.limit}
    OFFSET ${opts.offset ?? 0}
  `;
}

const NAME_MATCH_CAP = 3000;

type RawQueryClient = {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
  $transaction<T>(fn: (tx: RawQueryClient & { $executeRawUnsafe(sql: string): Promise<number> }) => Promise<T>): Promise<T>;
};

export async function searchCatalogVariantIds(
  db: unknown,
  q: string,
  opts: CatalogSearchOptions & { timeoutMs?: number }
): Promise<string[]> {
  const sql = buildCatalogSearchSql(q, opts);
  if (!sql) return [];
  const client = db as RawQueryClient;
  if (!opts.timeoutMs) {
    const rows = await client.$queryRaw<Array<{ id: string }>>(sql);
    return rows.map((r) => r.id);
  }
  const timeoutMs = Math.max(100, Math.floor(opts.timeoutMs));
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${timeoutMs}`);
    const rows = await tx.$queryRaw<Array<{ id: string }>>(sql);
    return rows.map((r) => r.id);
  });
}

/** Keep DB order from the id search after a findMany({ where: { id: { in } } }). */
export function orderByIds<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
}
