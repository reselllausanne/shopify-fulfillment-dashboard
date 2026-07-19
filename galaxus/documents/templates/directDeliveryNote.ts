import type { DeliveryNoteData, OrderLine } from "../types";
import { escapeHtml, formatDate } from "./format";
import {
  getDeliveryNoteCalibriDataUri,
  getDeliveryNoteHeaderImageDataUri,
} from "./deliveryNoteHeaderImage";

const PAGE_WIDTH_PT = 595.32;
const PAGE_HEIGHT_PT = 841.92;
const HEADER_WIDTH_PT = 594.8;
const HEADER_HEIGHT_PT = 158.45;
const ITEMS_PER_PAGE = 10;
const ITEM_START_Y_PT = 344.58;
const ITEM_ROW_HEIGHT_PT = 33.3;

function positionedText(
  text: string,
  x: number,
  y: number,
  className = "standard",
  extraStyle = ""
): string {
  return `<div class="positioned ${className}" style="left:${x}pt;top:${y}pt;${extraStyle}">${escapeHtml(text)}</div>`;
}

function readDimension(line: OrderLine, key: "height" | "width" | "length" | "weight"): string {
  const value = line[key];
  return String(value ?? "").trim();
}

function renderItem(line: OrderLine, rowIndex: number): string {
  const y = ITEM_START_Y_PT + rowIndex * ITEM_ROW_HEIGHT_PT;
  const dimensions = [
    ["Height:", readDimension(line, "height")],
    ["Width:", readDimension(line, "width")],
    ["Length:", readDimension(line, "length")],
    ["Weight:", readDimension(line, "weight")],
  ] as const;

  return `
    ${positionedText(line.description, 50.4, y)}
    ${dimensions
      .map(
        ([label, value], index) =>
          positionedText(label, 317.76, y + index * 6.84) +
          (value ? positionedText(value, 341.1, y + index * 6.84) : "")
      )
      .join("")}
    ${positionedText(line.articleNumber ?? "", 399.9, y)}
    ${positionedText(String(line.quantity), 447.72, y)}
    <div class="separator" style="top:${y + 32.04}pt"></div>
  `;
}

function renderMetadata(data: DeliveryNoteData): string {
  const deliveryDate = data.createdAt ?? data.groups[0]?.deliveryDate;
  const orderReference =
    data.orderReference?.trim() || data.groups[0]?.orderNumber?.trim() || "";
  const yourReference = data.yourReference?.trim() || "";
  const rows = [
    ["Date", formatDate(deliveryDate), 217.8],
    ["Order", orderReference, 225.18],
    ["Reference person", data.referencePerson?.trim() ?? "", 232.5],
    ["Your reference", yourReference, 239.34],
    ["Buyer Phone Number", data.buyerPhone?.trim() ?? "", 246.18],
    ["VAT No.", data.buyerVatId?.trim() || "CHE-109.049.266 MWST", 253.56],
    ["Delivery option", data.deliveryOption?.trim() || "Shipping", 260.88],
  ] as const;

  return rows
    .map(
      ([label, value, y]) =>
        positionedText(label, 50.4, y) + positionedText(value, 135.42, y)
    )
    .join("");
}

function renderRecipient(data: DeliveryNoteData): string {
  const countryCode = data.buyerCountryCode?.trim();
  const postalCity = [
    countryCode ? `${countryCode}-${data.buyer.postalCode}` : data.buyer.postalCode,
    data.buyer.city,
  ]
    .filter(Boolean)
    .join(" ");
  const lines = [
    data.buyer.name,
    data.buyer.line2,
    data.buyer.line1,
    data.buyerPostalBox,
    postalCity,
    data.buyer.country,
  ].filter((line): line is string => Boolean(line?.trim()));

  return lines
    .map((line, index) => positionedText(line, 304.08, 217 + index * 9.78, "recipient"))
    .join("");
}

function renderTableHead(): string {
  return `
    ${positionedText("Description", 50.4, 333.1, "table-head")}
    ${positionedText("Dimensions", 317.76, 333.1, "table-head")}
    ${positionedText("Article number", 399.9, 333.1, "table-head")}
    ${positionedText("Amount", 447.72, 333.1, "table-head")}
    <div class="header-separator"></div>
  `;
}

function renderLegalBlock(): string {
  return `
    ${positionedText("Delivery", 50.4, 717.48)}
    <div class="positioned legal-text" style="left:126.78pt;top:717.48pt;width:419.16pt;">
      Upon receiving your product, please make sure it is correct and complete and check it for damage. Any deficiencies need to be reported<br>
      within five calendar days from collection resp. delivery date via your personal customer account in the online shop.
    </div>
    ${positionedText("General", 50.4, 731.16)}
    ${positionedText("Our general terms and conditions apply.", 126.78, 731.16)}
  `;
}

function renderPage(options: {
  data: DeliveryNoteData;
  lines: OrderLine[];
  pageNumber: number;
  pageCount: number;
  headerImageDataUri: string | null;
  isLastPage: boolean;
}): string {
  const { data, lines, pageNumber, pageCount, headerImageDataUri, isLastPage } = options;

  return `
    <section class="dn-page">
      ${
        headerImageDataUri
          ? `<img class="header-underlay" src="${headerImageDataUri}" alt="">`
          : ""
      }
      ${positionedText("Digitec Galaxus AG", 50.4, 120)}
      ${positionedText("Pfingstweidstrasse 60b", 50.4, 129.84)}
      ${positionedText("CH-8005 Zürich", 50.4, 139.68)}
      ${positionedText("For questions and help:", 135.78, 120)}
      ${positionedText("helpcenter.galaxus.ch", 135.78, 129.84)}

      ${positionedText("Delivery note", 50.4, 197.74, "title")}
      ${renderMetadata(data)}
      ${renderRecipient(data)}
      ${renderTableHead()}
      ${lines.map((line, index) => renderItem(line, index)).join("")}

      ${isLastPage ? renderLegalBlock() : ""}
      ${positionedText("Page", 49.62, 789.7, "pagination")}
      ${positionedText(`${pageNumber} of ${pageCount}`, 85.8, 789.7, "pagination")}
    </section>
  `;
}

export function renderDirectDeliveryNoteHtml(data: DeliveryNoteData): string {
  const headerImageDataUri = getDeliveryNoteHeaderImageDataUri();
  const calibriDataUri = getDeliveryNoteCalibriDataUri();
  const lines = data.groups.flatMap((group) => group.lines);
  const pages: OrderLine[][] = [];

  for (let index = 0; index < lines.length; index += ITEMS_PER_PAGE) {
    pages.push(lines.slice(index, index + ITEMS_PER_PAGE));
  }
  if (pages.length === 0) pages.push([]);

  const styles = `
    @font-face {
      font-family: "Calibri Embedded";
      src: ${calibriDataUri ? `url("${calibriDataUri}") format("truetype")` : "local(\"Calibri\")"};
      font-weight: 400;
      font-style: normal;
    }
    @page {
      size: ${PAGE_WIDTH_PT}pt ${PAGE_HEIGHT_PT}pt;
      margin: 0;
    }
    html, body {
      width: ${PAGE_WIDTH_PT}pt;
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      font-family: "Calibri Embedded", Calibri, sans-serif;
      font-weight: 400;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    * { box-sizing: border-box; }
    .dn-page {
      position: relative;
      width: ${PAGE_WIDTH_PT}pt;
      height: ${PAGE_HEIGHT_PT}pt;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: #fff;
      break-after: page;
      page-break-after: always;
    }
    .dn-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    .header-underlay {
      position: absolute;
      z-index: 0;
      left: 0;
      top: 0;
      width: ${HEADER_WIDTH_PT}pt;
      height: ${HEADER_HEIGHT_PT}pt;
      margin: 0;
      padding: 0;
      display: block;
    }
    .positioned {
      position: absolute;
      z-index: 1;
      margin: 0;
      padding: 0;
      border: 0;
      font-weight: 400;
      color: #000;
      white-space: nowrap;
    }
    .standard {
      font-size: 7.02pt;
      line-height: 7.02pt;
    }
    .title {
      font-size: 10.02pt;
      line-height: 10.02pt;
    }
    .recipient {
      font-size: 10.02pt;
      line-height: 10.02pt;
    }
    .table-head {
      font-size: 5.52pt;
      line-height: 5.52pt;
    }
    .pagination {
      font-size: 7.5pt;
      line-height: 7.5pt;
    }
    .legal-text {
      font-size: 7.02pt;
      line-height: 6.84pt;
      white-space: nowrap;
    }
    .header-separator,
    .separator {
      position: absolute;
      z-index: 1;
      left: 50.4pt;
      width: 495.54pt;
      background: #000;
    }
    .header-separator {
      top: 343.08pt;
      height: 0.48pt;
    }
    .separator {
      height: 0.24pt;
    }
  `;

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>${styles}</style>
      </head>
      <body>
        ${pages
          .map((pageLines, index) =>
            renderPage({
              data,
              lines: pageLines,
              pageNumber: index + 1,
              pageCount: pages.length,
              headerImageDataUri,
              isLastPage: index === pages.length - 1,
            })
          )
          .join("")}
      </body>
    </html>
  `;
}
