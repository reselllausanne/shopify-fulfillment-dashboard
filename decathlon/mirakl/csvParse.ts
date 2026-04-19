export function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  const semicolons = (header.match(/;/g) ?? []).length;
  const commas = (header.match(/,/g) ?? []).length;
  return semicolons >= commas ? ";" : ",";
}

export function parseDelimitedCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        value += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      value = "";
      if (row.length > 1 || row[0]?.trim()) {
        rows.push(row);
      }
      row = [];
      continue;
    }
    value += char;
  }
  row.push(value);
  if (row.length > 1 || row[0]?.trim()) {
    rows.push(row);
  }
  if (rows.length && rows[0].length) {
    rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  }
  return rows;
}
