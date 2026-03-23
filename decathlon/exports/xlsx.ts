import * as XLSX from "xlsx";
import type { DecathlonExportFilePayload } from "./types";

export function buildXlsxBuffer(file: DecathlonExportFilePayload): Buffer {
  const sheet = XLSX.utils.json_to_sheet(file.rows, {
    header: file.headers,
    skipHeader: false,
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "data");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}
