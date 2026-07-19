export type FeedExportRow = Record<string, string>;

export type FeedValidationIssue = {
  feed: "master" | "stock" | "specs";
  row: number;
  column?: string;
  message: string;
  value?: string;
  providerKey?: string;
  gtin?: string;
};

const MASTER_REQUIRED_HEADERS = [
  "ProviderKey",
  "Gtin",
  "ManufacturerKey",
  "BrandName",
  "ProductCategory",
  "ProductTitle_de",
  "LongDescription_de",
  "MainImageUrl",
];

const MASTER_IMAGE_HEADERS = [
  "MainImageUrl",
  "ImageUrl_1",
  "ImageUrl_2",
  "ImageUrl_3",
  "ImageUrl_4",
  "ImageUrl_5",
  "ImageUrl_6",
  "ImageUrl_7",
  "ImageUrl_8",
];

function isAsciiPrintable(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidGtin(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  if (![8, 12, 13, 14].includes(value.length)) return false;
  const digits = value.split("").map((d) => Number(d));
  const checkDigit = digits.pop() ?? 0;
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    sum += digits[i] * weight;
    weight = weight === 3 ? 1 : 3;
  }
  const calculated = (10 - (sum % 10)) % 10;
  return calculated === checkDigit;
}

export function validateMasterRows(rows: FeedExportRow[]): FeedValidationIssue[] {
  const issues: FeedValidationIssue[] = [];
  const providerKeyValues = new Map<string, number>();
  const gtinValues = new Map<string, number>();
  const manufacturerValues = new Map<string, number>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const getValue = (column: string) => row[column]?.trim() ?? "";
    const providerKey = getValue("ProviderKey");
    if (!providerKey) {
      issues.push({ feed: "master", row: rowNumber, column: "ProviderKey", message: "ProviderKey is empty" });
    } else {
      if (!isAsciiPrintable(providerKey)) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column: "ProviderKey",
          message: "ProviderKey contains non-ASCII characters",
          value: providerKey,
        });
      }
      if (providerKey.length > 100) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column: "ProviderKey",
          message: "ProviderKey exceeds 100 characters",
          value: providerKey,
        });
      }
      const existing = providerKeyValues.get(providerKey);
      if (existing) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column: "ProviderKey",
          message: `Duplicate ProviderKey (also row ${existing})`,
          value: providerKey,
        });
      } else {
        providerKeyValues.set(providerKey, rowNumber);
      }
    }

    const gtin = getValue("Gtin");
    if (!gtin) {
      issues.push({ feed: "master", row: rowNumber, column: "Gtin", message: "Gtin is empty" });
    } else {
      const existing = gtinValues.get(gtin);
      if (existing) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column: "Gtin",
          message: `Duplicate Gtin (also row ${existing})`,
          value: gtin,
        });
      } else {
        gtinValues.set(gtin, rowNumber);
      }
      if (!isValidGtin(gtin)) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column: "Gtin",
          message: "Gtin is invalid or has a wrong check digit",
          value: gtin,
        });
      }
    }

    const manufacturerKey = getValue("ManufacturerKey");
    if (!manufacturerKey) {
      issues.push({
        feed: "master",
        row: rowNumber,
        column: "ManufacturerKey",
        message: "ManufacturerKey is empty",
      });
    } else {
      if (manufacturerKey.length < 4 || manufacturerKey.length > 50) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column: "ManufacturerKey",
          message: "ManufacturerKey length must be 4–50",
          value: manufacturerKey,
        });
      }
      const existing = manufacturerValues.get(manufacturerKey);
      if (existing) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column: "ManufacturerKey",
          message: `Duplicate ManufacturerKey (also row ${existing})`,
          value: manufacturerKey,
        });
      } else {
        manufacturerValues.set(manufacturerKey, rowNumber);
      }
    }

    const brand = getValue("BrandName");
    if (!brand) {
      issues.push({ feed: "master", row: rowNumber, column: "BrandName", message: "BrandName is empty" });
    }

    const category = getValue("ProductCategory");
    if (!category) {
      issues.push({
        feed: "master",
        row: rowNumber,
        column: "ProductCategory",
        message: "ProductCategory is empty",
      });
    } else if (category.length > 200) {
      issues.push({
        feed: "master",
        row: rowNumber,
        column: "ProductCategory",
        message: "ProductCategory exceeds 200 characters",
        value: category,
      });
    }

    const title = getValue("ProductTitle_de");
    if (!title) {
      issues.push({
        feed: "master",
        row: rowNumber,
        column: "ProductTitle_de",
        message: "ProductTitle_de is empty",
      });
    } else if (title.length > 100) {
      issues.push({
        feed: "master",
        row: rowNumber,
        column: "ProductTitle_de",
        message: "ProductTitle_de exceeds 100 characters",
        value: title,
      });
    } else if (/[™®©]/.test(title)) {
      issues.push({
        feed: "master",
        row: rowNumber,
        column: "ProductTitle_de",
        message: "ProductTitle_de contains trademark symbols",
        value: title,
      });
    }

    const description = getValue("LongDescription_de");
    if (description.length > 4000) {
      issues.push({
        feed: "master",
        row: rowNumber,
        column: "LongDescription_de",
        message: "LongDescription_de exceeds 4000 characters",
      });
    }

    for (const column of MASTER_IMAGE_HEADERS) {
      const value = getValue(column);
      if (!value) {
        if (column === "MainImageUrl") {
          issues.push({
            feed: "master",
            row: rowNumber,
            column,
            message: "MainImageUrl is empty",
          });
        }
        continue;
      }
      if (value.length > 300) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column,
          message: "Image URL exceeds 300 characters",
          value,
        });
      }
      if (!isValidUrl(value)) {
        issues.push({
          feed: "master",
          row: rowNumber,
          column,
          message: "Image URL is not a valid absolute URL",
          value,
        });
      }
    }
  });

  for (const required of MASTER_REQUIRED_HEADERS) {
    const hasColumn = rows.some((row) => required in row);
    if (!hasColumn) {
      issues.push({
        feed: "master",
        row: 1,
        column: required,
        message: "Missing mandatory header",
      });
    }
  }

  return issues;
}

export function validateSpecsRows(rows: FeedExportRow[]): FeedValidationIssue[] {
  const issues: FeedValidationIssue[] = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const providerKey = row.ProviderKey?.trim() ?? "";
    if (!providerKey) {
      issues.push({ feed: "specs", row: rowNumber, column: "ProviderKey", message: "ProviderKey is empty" });
    } else if (!isAsciiPrintable(providerKey)) {
      issues.push({
        feed: "specs",
        row: rowNumber,
        column: "ProviderKey",
        message: "ProviderKey contains non-ASCII characters",
        value: providerKey,
      });
    }
    const specKey = row.SpecificationKey?.trim() ?? "";
    if (!specKey) {
      issues.push({
        feed: "specs",
        row: rowNumber,
        column: "SpecificationKey",
        message: "SpecificationKey is empty",
      });
    }
    const specValue = row.SpecificationValue?.trim() ?? "";
    if (!specValue) {
      issues.push({
        feed: "specs",
        row: rowNumber,
        column: "SpecificationValue",
        message: "SpecificationValue is empty",
      });
    }
  });
  return issues;
}

export function groupFeedValidationIssues(issues: FeedValidationIssue[]) {
  const map = new Map<string, { count: number; samples: string[] }>();
  for (const issue of issues) {
    const key = issue.message;
    const entry = map.get(key) ?? { count: 0, samples: [] };
    entry.count += 1;
    const sample = issue.providerKey || issue.gtin || issue.value || "";
    if (sample && entry.samples.length < 10) {
      entry.samples.push(sample);
    }
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([message, data]) => ({ message, count: data.count, samples: data.samples }));
}

export function attachIssueContext(issues: FeedValidationIssue[], rows: FeedExportRow[]) {
  return issues.map((issue) => {
    const rowIndex = Math.max(0, issue.row - 2);
    const row = rows[rowIndex] ?? {};
    const providerKey = String(row.ProviderKey ?? "").trim();
    const gtin = String(row.Gtin ?? "").trim();
    return { ...issue, providerKey: providerKey || undefined, gtin: gtin || undefined };
  });
}

export function buildMasterSpecsValidationReport(
  masterRows: FeedExportRow[],
  specsRows: FeedExportRow[]
) {
  const masterIssues = validateMasterRows(masterRows);
  const specsIssues = validateSpecsRows(specsRows);
  const masterIssuesWithContext = attachIssueContext(masterIssues, masterRows);
  const specsIssuesWithContext = attachIssueContext(specsIssues, specsRows);
  return {
    summary: {
      master: { totalRows: masterRows.length, totalIssues: masterIssues.length },
      stock: { totalRows: 0, totalIssues: 0 },
      specs: { totalRows: specsRows.length, totalIssues: specsIssues.length },
    },
    grouped: {
      master: groupFeedValidationIssues(masterIssuesWithContext),
      stock: [],
      specs: groupFeedValidationIssues(specsIssuesWithContext),
    },
    issues: {
      master: masterIssuesWithContext,
      stock: [],
      specs: specsIssuesWithContext,
    },
  };
}

export function countCriticalGtinIssues(report: {
  grouped?: { master?: Array<{ message: string; count: number }>; specs?: Array<{ message: string; count: number }> };
}): number {
  const grouped = [...(report?.grouped?.master ?? []), ...(report?.grouped?.specs ?? [])];
  return grouped.reduce((sum, issue) => {
    const message = String(issue?.message ?? "").toLowerCase();
    const isCritical =
      message.includes("gtin is empty") ||
      message.includes("gtin is invalid") ||
      message.includes("wrong check digit");
    return isCritical ? sum + Number(issue?.count ?? 0) : sum;
  }, 0);
}

const CRITICAL_GTIN_MESSAGE_PATTERNS = [
  "gtin is empty",
  "gtin is invalid",
  "wrong check digit",
];

export function collectCriticalGtinProviderKeys(report: {
  issues?: { master?: FeedValidationIssue[]; specs?: FeedValidationIssue[] };
}): Set<string> {
  const blocked = new Set<string>();
  const all = [...(report?.issues?.master ?? []), ...(report?.issues?.specs ?? [])];
  for (const issue of all) {
    const message = String(issue?.message ?? "").toLowerCase();
    if (!CRITICAL_GTIN_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern))) continue;
    const providerKey = String(issue?.providerKey ?? "").trim();
    if (providerKey) blocked.add(providerKey);
  }
  return blocked;
}

/** Drop CSV rows whose first column (ProviderKey) is in the blocked set. Preserves header. */
export function filterCsvByProviderKeys(csv: string, blockedKeys: Set<string>): {
  filteredCsv: string;
  omittedRows: number;
} {
  if (!csv || blockedKeys.size === 0) return { filteredCsv: csv ?? "", omittedRows: 0 };
  const lines = csv.split("\n");
  if (lines.length === 0) return { filteredCsv: csv, omittedRows: 0 };
  const out: string[] = [lines[0]];
  let omitted = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === "") {
      out.push(line);
      continue;
    }
    const commaIdx = line.indexOf(",");
    const firstCol = commaIdx === -1 ? line : line.slice(0, commaIdx);
    const unquoted = firstCol.replace(/^"|"$/g, "").trim();
    if (blockedKeys.has(unquoted)) {
      omitted += 1;
      continue;
    }
    out.push(line);
  }
  return { filteredCsv: out.join("\n"), omittedRows: omitted };
}
