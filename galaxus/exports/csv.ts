type CsvValue = string | number | boolean | null | undefined;

export function escapeCsvValue(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: Array<Record<string, CsvValue>>): string {
  const lines = [headers.map(escapeCsvValue).join(",")];
  for (const row of rows) {
    const line = headers.map((header) => escapeCsvValue(row[header]));
    lines.push(line.join(","));
  }
  return lines.join("\n");
}
