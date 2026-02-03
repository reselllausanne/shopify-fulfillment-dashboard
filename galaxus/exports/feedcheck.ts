import fs from "fs/promises";
import path from "node:path";

type Issue = {
  row: number;
  column?: string;
  message: string;
  value?: string;
};

type Report = {
  file: string;
  totalRows: number;
  issues: Issue[];
};

const REQUIRED_HEADERS = [
  "ProviderKey",
  "Gtin",
  "ManufacturerKey",
  "BrandName",
  "ProductCategory",
  "ProductTitle_de",
  "LongDescription_de",
  "MainImageUrl",
];

const IMAGE_HEADERS = [
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

function parseArgs() {
  const args = process.argv.slice(2);
  const fileArgIndex = args.indexOf("--file");
  const outArgIndex = args.indexOf("--out");
  const delimiterIndex = args.indexOf("--delimiter");
  const file = fileArgIndex >= 0 ? args[fileArgIndex + 1] : args[0];
  const out = outArgIndex >= 0 ? args[outArgIndex + 1] : undefined;
  const delimiter = delimiterIndex >= 0 ? args[delimiterIndex + 1] : ",";
  if (!file) {
    throw new Error('Missing file path. Use: --file "/path/to/file.csv"');
  }
  return { file, out, delimiter };
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function parseCsv(content: string, delimiter: string): string[][] {
  const lines = content.split(/\r?\n/).filter((line) => line.length);
  return lines.map((line) => parseCsvLine(line, delimiter));
}

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

function isValidGtin(value: string): boolean {
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

function addIssue(issues: Issue[], row: number, column: string | undefined, message: string, value?: string) {
  issues.push({ row, column, message, value });
}

export async function runFeedcheck() {
  const { file, out, delimiter } = parseArgs();
  const raw = await fs.readFile(file, "utf-8");
  const rows = parseCsv(raw, delimiter);
  const issues: Issue[] = [];

  if (rows.length === 0) {
    throw new Error("CSV is empty.");
  }

  const headers = rows[0];
  const headerSet = new Set<string>();
  for (const header of headers) {
    if (!header || header.trim().length === 0) {
      addIssue(issues, 1, undefined, "Empty header");
      continue;
    }
    if (header.includes("\n")) {
      addIssue(issues, 1, header, "Header contains line break");
    }
    if (headerSet.has(header)) {
      addIssue(issues, 1, header, "Duplicate header");
    }
    headerSet.add(header);
  }

  for (const required of REQUIRED_HEADERS) {
    if (!headerSet.has(required)) {
      addIssue(issues, 1, required, "Missing mandatory header");
    }
  }

  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const providerKeyValues = new Map<string, number>();
  const gtinValues = new Map<string, number>();
  const manufacturerValues = new Map<string, number>();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const rowNumber = i + 1;
    if (row.length !== headers.length) {
      addIssue(issues, rowNumber, undefined, `Column count mismatch (expected ${headers.length}, got ${row.length})`);
      continue;
    }

    const getValue = (column: string) => {
      const idx = headerIndex.get(column);
      if (idx === undefined) return "";
      return row[idx]?.trim() ?? "";
    };

    const providerKey = getValue("ProviderKey");
    if (!providerKey) {
      addIssue(issues, rowNumber, "ProviderKey", "ProviderKey is empty");
    } else {
      if (!isAsciiPrintable(providerKey)) {
        addIssue(issues, rowNumber, "ProviderKey", "ProviderKey contains non-ASCII characters", providerKey);
      }
      if (providerKey.length > 100) {
        addIssue(issues, rowNumber, "ProviderKey", "ProviderKey exceeds 100 characters", providerKey);
      }
      const existing = providerKeyValues.get(providerKey);
      if (existing) {
        addIssue(issues, rowNumber, "ProviderKey", `Duplicate ProviderKey (also row ${existing})`, providerKey);
      } else {
        providerKeyValues.set(providerKey, rowNumber);
      }
    }

    const gtin = getValue("Gtin");
    if (!gtin) {
      addIssue(issues, rowNumber, "Gtin", "Gtin is empty");
    } else {
      const existing = gtinValues.get(gtin);
      if (existing) {
        addIssue(issues, rowNumber, "Gtin", `Duplicate Gtin (also row ${existing})`, gtin);
      } else {
        gtinValues.set(gtin, rowNumber);
      }
      if (!isValidGtin(gtin)) {
        addIssue(issues, rowNumber, "Gtin", "Gtin is invalid or has a wrong check digit", gtin);
      }
    }

    const manufacturerKey = getValue("ManufacturerKey");
    if (!manufacturerKey) {
      addIssue(issues, rowNumber, "ManufacturerKey", "ManufacturerKey is empty");
    } else {
      if (manufacturerKey.length < 4 || manufacturerKey.length > 50) {
        addIssue(issues, rowNumber, "ManufacturerKey", "ManufacturerKey length must be 4–50", manufacturerKey);
      }
      const existing = manufacturerValues.get(manufacturerKey);
      if (existing) {
        addIssue(issues, rowNumber, "ManufacturerKey", `Duplicate ManufacturerKey (also row ${existing})`, manufacturerKey);
      } else {
        manufacturerValues.set(manufacturerKey, rowNumber);
      }
    }

    const brand = getValue("BrandName");
    if (!brand) {
      addIssue(issues, rowNumber, "BrandName", "BrandName is empty");
    }

    const category = getValue("ProductCategory");
    if (!category) {
      addIssue(issues, rowNumber, "ProductCategory", "ProductCategory is empty");
    } else if (category.length > 200) {
      addIssue(issues, rowNumber, "ProductCategory", "ProductCategory exceeds 200 characters", category);
    }

    const title = getValue("ProductTitle_de");
    if (!title) {
      addIssue(issues, rowNumber, "ProductTitle_de", "ProductTitle_de is empty");
    } else if (title.length > 100) {
      addIssue(issues, rowNumber, "ProductTitle_de", "ProductTitle_de exceeds 100 characters", title);
    } else if (/[™®©]/.test(title)) {
      addIssue(issues, rowNumber, "ProductTitle_de", "ProductTitle_de contains trademark symbols", title);
    }

    const description = getValue("LongDescription_de");
    if (description.length > 4000) {
      addIssue(issues, rowNumber, "LongDescription_de", "LongDescription_de exceeds 4000 characters");
    }

    for (const column of IMAGE_HEADERS) {
      const value = getValue(column);
      if (!value) {
        if (column === "MainImageUrl") {
          addIssue(issues, rowNumber, column, "MainImageUrl is empty");
        }
        continue;
      }
      if (value.length > 300) {
        addIssue(issues, rowNumber, column, "Image URL exceeds 300 characters", value);
      }
      if (!isValidUrl(value)) {
        addIssue(issues, rowNumber, column, "Image URL is not a valid absolute URL", value);
      }
    }
  }

  const report: Report = {
    file: path.resolve(file),
    totalRows: rows.length - 1,
    issues,
  };

  const outputFile = out ?? `${file}.report.json`;
  await fs.writeFile(outputFile, JSON.stringify(report, null, 2));

  const summary = {
    totalRows: report.totalRows,
    totalIssues: report.issues.length,
  };

  console.log(JSON.stringify({ summary, outputFile }, null, 2));
}

if (require.main === module) {
  runFeedcheck().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
